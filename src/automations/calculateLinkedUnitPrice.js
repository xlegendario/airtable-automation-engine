import {
  getFirstValue,
  getSelectName,
  getNumber,
  getLinkedId,
  hasLinkedRecord,
} from "../lib/helpers.js";

const EPS = 0.01;

export const calculateLinkedUnitPrice = {
  name: "calculateLinkedUnitPrice",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["changed"],

  async shouldRun(record) {
    const f = record.fields;

    const linkedInventoryUnit = f["Linked Inventory Unit"];
    const fulfillmentStatus = getSelectName(f["Fulfillment Status"]);

    console.log("calculateLinkedUnitPrice debug", {
      recordId: record.id,
      linkedInventoryUnit,
      hasLinked: hasLinkedRecord(linkedInventoryUnit),
      fulfillmentStatus,
      calculatedAt: f["linked_unit_price_calculated_at"],
    });

    return (
      hasLinkedRecord(linkedInventoryUnit) &&
      [
        "Outsource",
        "Claim Processing",
        "Confirmed",
        "StockX Processing",
        "GOAT Processing",
      ].includes(fulfillmentStatus) &&
      !f["linked_unit_price_calculated_at"]
    );
  },

  async run(order, ctx) {
    const f = order.fields;

    const unitId = getLinkedId(f["Linked Inventory Unit"]);

    if (!unitId) {
      console.log("❌ No linked Inventory Unit found.");
      return;
    }

    const unit = await ctx.airtable.getRecord("Inventory Units", unitId);

    if (!unit) {
      console.log("❌ Linked Inventory Unit could not be found.");
      return;
    }

    const offerAccepted = !!f["Offer Accepted?"];

    if (offerAccepted) {
      const storeName = getFirstValue(f["Store Name"]).toUpperCase();
      const isForcedOfferToStoreStore =
        storeName === "SNEAKERASK" || storeName === "APLUG.PL";

      const offerToStore = toNumber(f["Offer To Store"]);
      const customOffer = toNumber(f["Custom Offer"]);

      const offerVatTypeName = getSelectName(f["Offer VAT Type"]);
      const offerVatTypeNorm = normVatType(offerVatTypeName);

      const clientCountry = getFirstValue(f["Client Country"]);
      const clientCountryNorm = normCountry(clientCountry);

      const applyVatConversionIfNeeded = (price) => {
        let netPrice = price;

        if (
          clientCountryNorm.includes("netherland") &&
          offerVatTypeNorm === "VAT21"
        ) {
          netPrice = price / 1.21;
        }

        return round2(netPrice);
      };

      // A) SneakerAsk / APLUG.PL always use Offer To Store
      if (isForcedOfferToStoreStore && offerToStore != null) {
        const finalPrice = applyVatConversionIfNeeded(offerToStore);

        await updateAllocated(order, unitId, finalPrice, ctx, {
          notes:
            "Forced: Store is SneakerAsk/APLUG.PL and Offer Accepted → used Offer To Store.",
        });

        return;
      }

      // B) Custom Offer wins
      if (customOffer != null) {
        const basePrice = offerToStore != null ? offerToStore : customOffer;
        const finalPrice = applyVatConversionIfNeeded(basePrice);

        await updateAllocated(order, unitId, finalPrice, ctx, {
          notes:
            "Final price set from accepted Custom Offer (Offer To Store preferred, else Custom Offer).",
        });

        return;
      }

      // C) Lowest Offer comparison
      const lowestOffer = toNumber(f["Lowest Offer"]);

      let comparisonPrice = null;

      if (offerVatTypeNorm === "VAT0") {
        comparisonPrice = toNumber(f["Final Outsource Buying Price (VAT 0%)"]);
      } else if (
        offerVatTypeNorm === "VAT21" ||
        offerVatTypeNorm === "MARGIN"
      ) {
        comparisonPrice = toNumber(f["Final Outsource Buying Price"]);
      }

      const shouldOverrideWithOffer =
        lowestOffer != null &&
        comparisonPrice != null &&
        lowestOffer > comparisonPrice + EPS;

      if (shouldOverrideWithOffer && offerToStore != null) {
        const finalPrice = applyVatConversionIfNeeded(offerToStore);

        await updateAllocated(order, unitId, finalPrice, ctx, {
          notes:
            "Final price set from accepted offer (Offer To Store) after Lowest Offer vs Outsource comparison.",
        });

        return;
      }
    }

    // Normal calculation with retry/refetch (matches Airtable automation behavior)
    let success = false;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`🔄 Pricing attempt ${attempt}`);
    
      // Re-fetch fresh order each attempt
      const freshOrder = await ctx.airtable.getRecord(
        "Unfulfilled Orders Log",
        order.id
      );
    
      const freshFields = freshOrder.fields;
    
      const targetPrice = getNumber(freshFields["Target Buying Price"]);
      const maxPrice = getNumber(freshFields["Maximum Buying Price"]);
    
      // Re-fetch fresh inventory unit too
      const freshUnit = await ctx.airtable.getRecord(
        "Inventory Units",
        unitId
      );
    
      const uf = freshUnit.fields;
    
      const ideal = getNumber(uf["Ideal Selling Price"]);
      const min = getNumber(uf["Minimum Selling Price"]);
      const cost = getNumber(uf["Purchase Price"]);
    
      console.log("pricing debug", {
        targetPrice,
        maxPrice,
        ideal,
        min,
        cost,
      });
    
      if (
        ideal == null ||
        min == null ||
        cost == null ||
        targetPrice == null ||
        maxPrice == null
      ) {
        console.log("⚠️ Missing fields, retrying...");
    
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
    
        await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
          Notes:
            "❌ Could not calculate final price. Missing Target/Max/Ideal/Min/Purchase price.",
          linked_unit_price_calculated_at: new Date().toISOString(),
        });
    
        return;
      }
    
      let candidate = null;
    
      // 1) If target at/above ideal → use target capped to max
      if (targetPrice >= ideal) {
        candidate = Math.min(targetPrice, maxPrice);
      }
    
      // 2) If target between min and ideal
      if (candidate === null && targetPrice >= min) {
        let mid = (targetPrice + ideal) / 2;
    
        if (mid > maxPrice + EPS) {
          if (maxPrice >= ideal) {
            mid = (maxPrice + ideal) / 2;
          } else if (maxPrice >= min) {
            mid = (maxPrice + min) / 2;
          } else {
            mid = null;
          }
        }
    
        candidate = mid;
      }
    
      // 3) Fallback using max price
      if (candidate === null) {
        if (maxPrice >= ideal) {
          candidate = (maxPrice + ideal) / 2;
        } else if (maxPrice >= min) {
          candidate = (maxPrice + min) / 2;
        }
      }
    
      // 4) Validate
      if (
        candidate != null &&
        candidate <= maxPrice + EPS &&
        candidate + EPS >= min
      ) {
        const finalPrice = round2(candidate);
    
        await updateAllocated(order, unitId, finalPrice, ctx, {
          notes: "Final price calculated from linked inventory unit",
        });
    
        console.log("✅ Records updated successfully.");
    
        success = true;
        break;
      }
    
      console.log("⚠️ Invalid candidate price, retrying...");
    
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    
    if (!success) {
      await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
        Notes:
          "❌ Could not calculate a valid final price after 3 attempts. Check Target/Max vs Ideal/Min.",
        linked_unit_price_calculated_at: new Date().toISOString(),
      });
    
      console.log("❌ Failed after 3 attempts.");
    }

    console.log("❌ Failed to calculate valid final price.");
  },
};

async function updateAllocated(order, unitId, finalPrice, ctx, { notes }) {
  await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
    "Fulfillment Status": "Allocated",
    "Final Buying Price": finalPrice,
    Notes: notes,
    linked_unit_price_calculated_at: new Date().toISOString(),
  });

  await ctx.airtable.updateRecord("Inventory Units", unitId, {
    "Selling Price": finalPrice,
    "Selling Method": "Plug & Play",
  });
}

function toNumber(v) {
  if (typeof v === "number") return v;

  if (Array.isArray(v) && v.length) {
    return toNumber(v[0]);
  }

  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normCountry(v) {
  return String(v || "").trim().toLowerCase();
}

function normVatType(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "")
    .replace("%", "")
    .toUpperCase();
}
