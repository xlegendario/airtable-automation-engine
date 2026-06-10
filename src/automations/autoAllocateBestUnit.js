import {
  getFirstValue,
  getSelectName,
  getNumber,
  getLinkedId,
  hasLinkedRecord,
  parseVatFraction,
} from "../lib/helpers.js";

const RETURN_SERVICE_WEBHOOK_URL = "https://hook.eu2.make.com/nnrdb2gn605shmf7yvc56sl0wnr1np2d";
const CONSIGNMENT_WEBHOOK_URL = "https://hook.eu2.make.com/3eu7vi2nfgngstc98sclpul3r1gskiyy";
const PARTNER_STOCK_WEBHOOK_URL = "https://kickzcaviar.com/api/consignment/offers/create";
const LOJIQ_WMS_BASE_URL = process.env.LOJIQ_WMS_BASE_URL;
const KICKZ_CAVIAR_PORTAL_BASE_URL =
  process.env.KICKZ_CAVIAR_PORTAL_BASE_URL || "https://kickzcaviar.com";

export const autoAllocateBestUnit = {
  name: "autoAllocateBestUnit",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["created", "changed"],
  watchFields: [
    "Fulfillment Status",
    "Match Risk Level",
    "Linked Inventory Unit",
    "SKU",
    "SKU (Soft)",
    "Size",
    "Client",
    "Target Buying Price",
    "Maximum Buying Price",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const linkedInventoryUnit = f["Linked Inventory Unit"];
    const fulfillmentStatus = getSelectName(f["Fulfillment Status"]);
    const riskLevel = getSelectName(f["Match Risk Level"]);

    console.log("autoAllocateBestUnit debug", {
      recordId: record.id,
      fulfillmentStatus,
      linkedInventoryUnit,
      hasLinked: hasLinkedRecord(linkedInventoryUnit),
      riskLevel,
      attempted: f["auto_allocate_attempted_at"],
    });

    return (
      !hasLinkedRecord(linkedInventoryUnit) &&
      ["Pending", "Outsource"].includes(fulfillmentStatus) &&
      riskLevel === "Low" &&
      !f["auto_allocate_attempted_at"]
    );
  },

  async run(order, ctx) {
    const f = order.fields;

    const orderSKU = getFirstValue(f["SKU"]).toUpperCase();
    const orderSoftSKU = getFirstValue(f["SKU (Soft)"]).toUpperCase();
    const orderSize = getFirstValue(f["Size"]);

    const targetPrice = getNumber(f["Target Buying Price"]);
    const maxPrice = getNumber(f["Maximum Buying Price"]);

    const clientRef = f["Client"];
    const clientId = getLinkedId(clientRef);

    const storeName = getFirstValue(f["Store Name"]);
    const autoOfferAccept = getFirstValue(f["Auto Offer Accept?"]);
    const isAutoOfferAccept = autoOfferAccept === "Yes";

    const clientVatRateFraction = parseVatFraction(getFirstValue(f["Client VAT Rate"]));
    const clientVatRatePercent =
      clientVatRateFraction == null ? null : clientVatRateFraction * 100;

    const clientCountry = getFirstValue(f["Client Country"]);
    const clientSellerId = getFirstValue(f["Client Seller ID"]);
    const orderIdField = getFirstValue(f["Order ID"]);
    
    if ((!orderSKU && !orderSoftSKU) || !orderSize || !clientId) {
      console.log("⚠️ Auto allocate skipped: missing data", {
        recordId: order.id,
        orderSKU,
        orderSoftSKU,
        orderSize,
        clientId,
      });
    
      return;
    }

    const inventoryFormula = buildInventoryMatchFormula(
      orderSKU,
      orderSoftSKU,
      orderSize
    );
    
    console.log("Inventory match formula", inventoryFormula);
    
    const matchingUnits = await ctx.airtable.listRecords("Inventory Units", {
      filterByFormula: inventoryFormula,
    });

    const returnServiceMatches = matchingUnits.filter(
      (unit) => getSelectName(unit.fields["Type"]) === "Return Service"
    );

    const sameSellerReturnMatch = returnServiceMatches.find((unit) => {
      const unitSellerId = getFirstValue(unit.fields["Seller ID"]);
      return clientSellerId && unitSellerId && clientSellerId === unitSellerId;
    });

    if (sameSellerReturnMatch) {
      const purchasePrice = getNumber(sameSellerReturnMatch.fields["Purchase Price"]);
      const vatType = getSelectName(sameSellerReturnMatch.fields["VAT Type"]);
      const offer = calcReturnServiceOffer(purchasePrice, vatType, maxPrice);

      await ctx.airtable.updateRecord(this.tableName, order.id, {
        "Linked Inventory Unit": [{ id: sameSellerReturnMatch.id }],
        "Fulfillment Status": "Allocated",
        "Final Buying Price": offer,
        Notes: "Allocated directly to matching Return Service seller item",
        auto_allocate_attempted_at: new Date().toISOString(),
      });

      await ctx.airtable.updateRecord("Inventory Units", sameSellerReturnMatch.id, {
        "Availability Status": "Reserved",
        "Selling Price": offer,
        "Selling Method": "Plug & Play",
      });
      
      await requestLabelForAutoAllocatedInventory(order.id);
      
      return;
    }

    const standardMatchingUnits = matchingUnits.filter(
      (unit) => getSelectName(unit.fields["Type"]) !== "Return Service"
    );

    let bestUnit = null;
    let bestFinalPrice = null;
    let bestProfit = -Infinity;

    for (const unit of standardMatchingUnits) {
      const uf = unit.fields;

      const ideal = getNumber(uf["Ideal Selling Price"]);
      const min = getNumber(uf["Minimum Selling Price"]);
      const cost = getNumber(uf["Purchase Price"]);
      const vatType = getSelectName(uf["VAT Type"]);
      const type = getSelectName(uf["Type"]);

      if (ideal == null || min == null) continue;

      const isConsignmentLike =
        type === "Consignment" || type === "Partner Consignment";

      if (cost == null && !isConsignmentLike) continue;
      if (isConsignmentLike && !(typeof cost === "number" && cost > 0)) continue;

      const isVAT0 = /vat\s*0|0%\s*vat|vat0/i.test(vatType || "");
      const isVAT21 = /vat\s*21|21%\s*vat|vat21/i.test(vatType || "");
      const needsNet = isVAT0 || isVAT21;
      const grossFactor = needsNet ? 1.21 : 1;

      const adjustedIdealGross = ideal * grossFactor;
      const adjustedMinGross = min * grossFactor;

      let finalPriceGross = null;

      if (targetPrice != null) {
        if (targetPrice >= adjustedIdealGross) {
          finalPriceGross = targetPrice;
        } else if (targetPrice >= adjustedMinGross) {
          finalPriceGross = (targetPrice + adjustedIdealGross) / 2;
        }
      }

      if (finalPriceGross === null && maxPrice != null) {
        if (maxPrice >= adjustedIdealGross) {
          finalPriceGross = (maxPrice + adjustedIdealGross) / 2;
        } else if (maxPrice >= adjustedMinGross) {
          finalPriceGross = (maxPrice + adjustedMinGross) / 2;
        }
      }

      if (finalPriceGross === null) continue;
      if (maxPrice != null && finalPriceGross > maxPrice) continue;

      const finalPriceNet = needsNet
        ? finalPriceGross / grossFactor
        : finalPriceGross;

      const profit = finalPriceNet - cost;

      if (profit > bestProfit) {
        bestUnit = unit;
        bestFinalPrice = finalPriceNet;
        bestProfit = profit;
      }
    }

    if (bestUnit) {
      bestFinalPrice = Math.round(bestFinalPrice * 100) / 100;

      await ctx.airtable.updateRecord(this.tableName, order.id, {
        "Linked Inventory Unit": [{ id: bestUnit.id }],
        "Fulfillment Status": "Allocated",
        "Final Buying Price": bestFinalPrice,
        Notes: "Allocated from inventory based on best profit (stored net)",
        auto_allocate_attempted_at: new Date().toISOString(),
      });

      const typeName = getSelectName(bestUnit.fields["Type"]);

      const invUpdate = {
        "Availability Status": "Reserved",
        "Selling Price": bestFinalPrice,
        "Selling Method": "Plug & Play",
      };

      if (typeName === "Consignment" || typeName === "Partner Consignment") {
        const hardCost = getNumber(bestUnit.fields["Purchase Price"]);

        invUpdate["Payment Note"] =
          typeof hardCost === "number" ? `€${hardCost.toFixed(2)}` : "(unknown)";
        invUpdate["Payment Status"] = "To Pay";
        invUpdate["Purchase Date"] = new Date().toISOString();

        if (typeName === "Consignment") {
          const itemId = getFirstValue(bestUnit.fields["Item ID"]);

          if (itemId.startsWith("CS") && isAutoOfferAccept) {
            await postWebhook(CONSIGNMENT_WEBHOOK_URL, {
              orderId: order.id,
              orderCustomId: orderIdField,
              inventoryUnitId: bestUnit.id,
              itemId,
              sku: orderSKU || orderSoftSKU || null,
              size: orderSize || null,
              sellerId: getFirstValue(bestUnit.fields["Seller ID"]),
              finalBuyingPrice: bestFinalPrice,
              clientVatRate: clientVatRateFraction,
              clientVatRatePercent,
              clientCountry,
              storeName,
              created_at_iso: new Date().toISOString(),
            });
          }
        }
      }

      await ctx.airtable.updateRecord("Inventory Units", bestUnit.id, invUpdate);

      await requestLabelForAutoAllocatedInventory(order.id);
      
      return;
    }

    await handleOutsourceFallback({
      order,
      ctx,
      skuCandidate: orderSKU || orderSoftSKU,
      orderSize,
      targetPrice,
      maxPrice,
      clientRef,
      clientVatRateFraction,
      clientVatRatePercent,
      clientCountry,
      storeName,
      orderIdField,
      isAutoOfferAccept,
    });
  },
};

async function handleOutsourceFallback({
  order,
  ctx,
  skuCandidate,
  orderSize,
  targetPrice,
  maxPrice,
  clientRef,
  clientVatRateFraction,
  clientVatRatePercent,
  clientCountry,
  storeName,
  orderIdField,
  isAutoOfferAccept,
}) {
  let partnerHasStock = false;

  if (skuCandidate && orderSize) {
    const stockKeyToFind = `${String(skuCandidate).trim()}-${String(orderSize).trim()}`;
    const stockFormula = `{Stock Counter Key} = "${escapeFormulaString(stockKeyToFind)}"`;

    console.log("Stock Levels match formula", stockFormula);
    
    const stockLevels = await ctx.airtable.listRecords("Stock Levels", {
      filterByFormula: stockFormula,
    });
    
    const match = stockLevels[0];

    if (match) {
      const partnerLevel = getNumber(match.fields["Partner Stock Level"]);
      partnerHasStock = typeof partnerLevel === "number" && partnerLevel > 0;

      if (partnerHasStock) {
        if (isAutoOfferAccept) {
          await postWebhook(PARTNER_STOCK_WEBHOOK_URL, {
            order_record_id: order.id,
            order_id: orderIdField,
            sku: skuCandidate,
            size: String(orderSize),
            maximum_buying_price: maxPrice ?? null,
          });
        } else {
          const preOffer = await calculateConsignmentPreOffer({
            orderRecordId: order.id,
            sku: skuCandidate,
            size: String(orderSize)
          });
      
          await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
            "Custom Offer": preOffer.custom_offer,
            "Offer VAT Type": preOffer.offer_vat_type,
            "Estimated Time": preOffer.estimated_time,
            "Offer Sent?": true,
            "Consignment Pre-Offer?": true,
            "Consignment Offer Price": preOffer.consignment_offer_price,
            Notes:
              `Partner stock found. Store pre-offer sent based on consignment stock. ` +
              `Best seller: ${preOffer.best_inventory?.seller_id || "-"} / ` +
              `${preOffer.best_inventory?.vat_type || "-"} / ` +
              `€${Number(preOffer.best_inventory?.seller_price || 0).toFixed(2)}.`,
            auto_allocate_attempted_at: new Date().toISOString(),
          });
      
          return;
        }
      }
    }
  }

  await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
    "Fulfillment Status": "Outsource",
    Notes: partnerHasStock
      ? "No in-house match. Partner stock > 0 found."
      : "No in-house match and no partner stock available or Partner Stock Level ≤ 0.",
    auto_allocate_attempted_at: new Date().toISOString(),
  });
}

function calcReturnServiceOffer(purchasePrice, vatType, maxPrice) {
  if (typeof purchasePrice !== "number") return null;
  if (typeof maxPrice !== "number") return null;

  const isVAT0 = /vat\s*0|0%\s*vat|vat0/i.test(String(vatType || ""));

  let comparisonPrice = purchasePrice;

  if (isVAT0) {
    comparisonPrice = purchasePrice * 1.21;
  }

  const maxCap = Math.max(0, maxPrice - 5);
  const internalOffer = Math.min(comparisonPrice, maxCap);

  const sellerOffer = isVAT0 ? internalOffer / 1.21 : internalOffer;

  return Math.round(sellerOffer * 100) / 100;
}

async function postWebhook(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Webhook failed: ${res.status} ${await res.text()}`);
  }
}

async function calculateConsignmentPreOffer({
  orderRecordId,
  sku,
  size
}) {
  const res = await fetch(
    `${KICKZ_CAVIAR_PORTAL_BASE_URL.replace(/\/$/, "")}/api/consignment/pre-offer/calculate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order_record_id: orderRecordId,
        sku,
        size
      })
    }
  );

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.details ||
      data?.error ||
      `Consignment pre-offer failed: ${res.status}`
    );
  }

  return data;
}

function escapeFormulaString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildInventoryMatchFormula(orderSKU, orderSoftSKU, orderSize) {
  const skuConditions = [];

  if (orderSKU) {
    skuConditions.push(`{SKU} = "${escapeFormulaString(orderSKU)}"`);
  }

  if (orderSoftSKU) {
    skuConditions.push(`{SKU} = "${escapeFormulaString(orderSoftSKU)}"`);
  }

  const skuFormula =
    skuConditions.length === 1
      ? skuConditions[0]
      : `OR(${skuConditions.join(", ")})`;

  return `AND(
    ${skuFormula},
    {Size} = "${escapeFormulaString(orderSize)}",
    {Availability Status} = "Available"
  )`;
}

async function requestLabelForAutoAllocatedInventory(recordId) {
  if (!LOJIQ_WMS_BASE_URL) {
    throw new Error("LOJIQ_WMS_BASE_URL is missing");
  }

  const res = await fetch(`${LOJIQ_WMS_BASE_URL.replace(/\/$/, "")}/api/request-label`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "auto_allocate_inventory",
      record_id: recordId,
    }),
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`Auto allocated label request failed: ${res.status} ${text}`);
  }
}
