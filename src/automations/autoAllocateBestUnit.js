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
    const orderRecordId = getRecordId(order);
  
    if (!orderRecordId) {
      throw new Error("Invalid order id");
    }
  
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

      const sameSellerReturnMatchId = getRecordId(sameSellerReturnMatch);
      
      if (!sameSellerReturnMatchId) {
        throw new Error("Invalid sameSellerReturnMatch id");
      }
      
      await ctx.airtable.updateRecord(this.tableName, orderRecordId, {
        "Linked Inventory Unit": [sameSellerReturnMatchId],
        "Fulfillment Status": "Allocated",
        "Final Buying Price": offer,
        Notes: "Allocated directly to matching Return Service seller item",
        auto_allocate_attempted_at: new Date().toISOString(),
      });

      await ctx.airtable.updateRecord("Inventory Units", sameSellerReturnMatchId, {
        "Availability Status": "Reserved",
        "Selling Price": offer,
        "Selling Method": "Plug & Play",
      });
      
      await requestLabelForAutoAllocatedInventory(orderRecordId);
      
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
    
      const bestUnitId = getRecordId(bestUnit);
    
      if (!bestUnitId) {
        throw new Error("Invalid bestUnit id");
      }
    
      await ctx.airtable.updateRecord(this.tableName, orderRecordId, {
        "Linked Inventory Unit": [bestUnitId],
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
              orderId: orderRecordId,
              orderCustomId: orderIdField,
              inventoryUnitId: bestUnitId,
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

      await ctx.airtable.updateRecord("Inventory Units", bestUnitId, invUpdate);

      await requestLabelForAutoAllocatedInventory(orderRecordId);
      
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
          // CHANGED — Route B now creates a real Seller Offer too, but
          // HELD: excluded from the Lowest Seller Offer rollups, so this
          // auto-accepting store neither sees it nor closes on it while
          // the consignor has not yet confirmed he still has the pair.
          //
          // Creating it up front rather than on his reply is deliberate:
          // the bot's undercut check reads Seller Offer records directly,
          // so a held offer still forces the next seller to come in lower.
          // Without it a seller could bid ABOVE the consignment price and
          // hand the store a worse number than what is already in stock.
          //
          // No ordering hazard here, unlike Route A: a held offer changes
          // none of the rollups, so computeAndPushLowestOffer sees nothing
          // until the hold is lifted — by which time the status below has
          // long been set.
          await createConsignmentAutoOffer({
            orderRecordId: order.id,
            sku: skuCandidate,
            size: String(orderSize),
            hold: true,
            maximumBuyingPrice: maxPrice ?? null
          });
        } else {
          // CHANGED — the consignment pre-offer is now a real Seller
          // Offer. Everything this branch used to write onto the order
          // by hand ("Lowest Offer", "Offer VAT Type", "Estimated
          // Time", "Offer Sent?") is written by computeAndPushLowestOffer
          // once that offer lands in the rollup — the same path every
          // regular seller takes. The store therefore sees the same
          // amount: "Offer To Store" applies the margin and
          // computeQualifyingOffer applies the country/VAT relabeling,
          // both from "Lowest Offer", exactly as before.
          //
          // ORDER MATTERS, and not obviously. computeAndPushLowestOffer
          // only runs when the order is already on "Outsource" (its
          // shouldRun), and "Fulfillment Status" is NOT among its
          // watchFields — so if the Seller Offer landed while this
          // order was still "Pending", that rollup event would be
          // dropped and setting "Outsource" afterwards would never
          // re-fire it. Status first means the rollup change always
          // arrives on an order that qualifies.
          await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
            "Fulfillment Status": "Outsource",
          });

          // auto_allocate_attempted_at is stamped AFTER the offer
          // exists, deliberately. If the call below throws, the order
          // stays on Outsource without the stamp, so shouldRun still
          // passes and the next event retries it. The portal endpoint
          // carries a duplicate guard, so a retry cannot produce a
          // second Seller Offer for the same stock.
          const autoOffer = await createConsignmentAutoOffer({
            orderRecordId: order.id,
            sku: skuCandidate,
            size: String(orderSize)
          });

          await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
            Notes:
              `Partner stock found. Consignment auto-offer created as a Seller Offer. ` +
              `Seller: ${autoOffer?.seller_id || "-"} / ` +
              `${autoOffer?.vat_type || "-"} / ` +
              `€${Number(autoOffer?.seller_price || 0).toFixed(2)}.`,
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

// NEW — sibling of calculateConsignmentPreOffer above. Creates the
// Seller Offer in the portal, where the Supabase client lives; this
// engine has none. calculateConsignmentPreOffer is left in place until
// the cleanup step so reverting is a one-line change.
async function createConsignmentAutoOffer({
  orderRecordId,
  sku,
  size,
  hold = false,
  maximumBuyingPrice = null
}) {
  const res = await fetch(
    `${KICKZ_CAVIAR_PORTAL_BASE_URL.replace(/\/$/, "")}/api/consignment/auto-offer/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        order_record_id: orderRecordId,
        sku,
        size,
        hold,
        maximum_buying_price: maximumBuyingPrice
      })
    }
  );

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.details ||
      data?.error ||
      `Consignment auto-offer failed: ${res.status}`
    );
  }

  return data;
}

function getRecordId(recordOrId) {
  if (!recordOrId) return null;
  if (typeof recordOrId === "string") return recordOrId;
  if (typeof recordOrId.id === "string") return recordOrId.id;
  return null;
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
