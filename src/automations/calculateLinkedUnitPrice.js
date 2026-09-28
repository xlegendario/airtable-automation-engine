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
  watchFields: [
    "Linked Inventory Unit",
    "Fulfillment Status",
    "Offer Accepted?",
    "Offer To Store",
    "Custom Offer",
    "Offer VAT Type",
    "Client Country",
    "Lowest Offer",
    "Final Outsource Buying Price",
    "Final Outsource Buying Price (VAT 0%)",
    "Target Buying Price",
    "Maximum Buying Price",
  ],

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

    /*
      CHANGED - "Requested Label" was missing, and that was a race a seller
      could win.

      Confirm Deal or Process Deal sets the status, this automation is queued
      on that change, and the seller presses Request Label in Discord a second
      later. That moves the order to "Requested Label", which was not on this
      list, so the run bailed out and Final Buying Price was never written.
      Rompslomp then could not send an invoice, because there was no price on
      it. Seen on the Quick Deals and want-to-buy channels, where the seller
      is already sitting in the channel watching for the button.

      Adding it turns the change that used to kill this into the change that
      triggers it: "Fulfillment Status" is a watched field, so the move to
      "Requested Label" is itself an event, and this then runs on it.

      Nothing runs twice. linked_unit_price_calculated_at is written with the
      price and is checked right here.
    */
    return (
      hasLinkedRecord(linkedInventoryUnit) &&
      [
        "Outsource",
        "Claim Processing",
        "Confirmed",
        "Requested Label",
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

    const storeName = getFirstValue(f["Store Name"]).toUpperCase();
    /*
     * Stores whose price is already settled before a consignor is asked.
     *
     * CHANGED - Woovin joins the list. A marketplace buyer has paid before
     * we go looking for the pair, so the price on the order is the price,
     * and deriving one from whichever consignor accepts would quote a
     * number we were never paid.
     *
     * Hypeneedz for the same reason: the order carries the purchase price
     * they pay us, set when the pair was listed.
     */
    const isForcedOfferToStoreStore =
      storeName === "SNEAKERASK" ||
      storeName === "WOOVIN" ||
      storeName === "HYPENEEDZ" ||
      storeName === "APLUG.PL";

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

    /*
     * A) A marketplace order carries its own price, accepted offer or not.
     *
     * CHANGED - this sat inside "Offer Accepted?" and so only ever ran for a
     * negotiated deal. A Claim Deal has no offer to accept: somebody takes
     * the payout as it stands, Confirm Deal makes the unit, and this dropped
     * through to the ordinary sum below - which needs Target and Maximum
     * Buying Price, and a marketplace order has neither, because nothing was
     * ever negotiated. Three attempts later it wrote "Missing Target/Max"
     * into Notes and stopped, leaving the order on "Claim Processing" with no
     * Final Buying Price and no invoice behind it. ORD-026465 (Woovin) sat
     * there until it was moved by hand.
     *
     * The price was on the order the whole time. Offer To Store first and
     * Custom Offer behind it, the order of preference this branch always had
     * for these stores.
     */
    if (isForcedOfferToStoreStore) {
      const settledPrice = offerToStore ?? customOffer;

      if (settledPrice != null) {
        const finalPrice = applyVatConversionIfNeeded(settledPrice);

        await updateAllocated(order, unitId, finalPrice, ctx, {
          notes: `Forced: ${storeName} sets its own price → used ${
            offerToStore != null ? "Offer To Store" : "Custom Offer"
          }.`,
        });

        return;
      }
    }

    if (offerAccepted) {
      // B) Custom Offer wins
      // FIXED — this used to prefer offerToStore (the "Offer To Store"
      // FORMULA field, which rounds to the nearest €2.50) over the
      // literally-agreed customOffer whenever both existed. The
      // negotiation system only ever guarantees whole-euro prices, not
      // ones that land on a €2.50 grid, so a genuinely agreed price
      // like €384 could silently become €385 here — the actual money
      // moved didn't match what was negotiated. Now uses the literal
      // agreed price first; Offer To Store is still the fallback when
      // there's no Custom Offer at all (a still-fresh, never-
      // negotiated offer). Branch A (SneakerAsk/APLUG.PL forced
      // stores) and Branch C (Lowest Offer comparison) are deliberately
      // untouched — this only affects how an already-accepted,
      // negotiated deal's final price is chosen.
      if (customOffer != null) {
        const basePrice = customOffer;
        const finalPrice = applyVatConversionIfNeeded(basePrice);

        await updateAllocated(order, unitId, finalPrice, ctx, {
          notes:
            "Final price set from accepted Custom Offer (literal agreed price, not the rounded Offer To Store).",
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

    // Normal calculation with retry/refetch
    let success = false;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`🔄 Pricing attempt ${attempt}`);
    
      const freshOrder = await ctx.airtable.getRecord(
        "Unfulfilled Orders Log",
        order.id
      );
    
      const freshFields = freshOrder.fields;
    
      const targetPrice = getNumber(freshFields["Target Buying Price"]);
      const maxPrice = getNumber(freshFields["Maximum Buying Price"]);
    
      const freshUnit = await ctx.airtable.getRecord(
        "Inventory Units",
        unitId
      );
    
      const uf = freshUnit.fields;
    
      const ideal = getNumber(uf["Ideal Selling Price"]);
      const min = getNumber(uf["Minimum Selling Price"]);
      const cost = getNumber(uf["Purchase Price"]);
    
      if (
        ideal == null ||
        min == null ||
        cost == null ||
        targetPrice == null ||
        maxPrice == null
      ) {
        if (attempt < 3) {
          console.log("⚠️ Missing price fields, retrying...");
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
    
        /*
         * No stamp on a failure, so a later change gets another go.
         *
         * linked_unit_price_calculated_at is what keeps this from running
         * twice, and writing it here kept it from ever running again -
         * shouldRun demands the field be empty. An order that failed once was
         * frozen, even after somebody filled in the very price it said was
         * missing. Only a run that wrote a price is done.
         */
        await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
          Notes:
            "❌ Could not calculate final price. Missing Target/Max/Ideal/Min/Purchase price.",
        });
    
        return;
      }
    
      let candidate = null;
    
      if (targetPrice >= ideal) {
        candidate = Math.min(targetPrice, maxPrice);
      }
    
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
    
      if (candidate === null) {
        if (maxPrice >= ideal) {
          candidate = (maxPrice + ideal) / 2;
        } else if (maxPrice >= min) {
          candidate = (maxPrice + min) / 2;
        }
      }
    
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
    
      if (attempt < 3) {
        console.log("⚠️ Invalid candidate price, retrying...");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    
    if (!success) {
      // Same reasoning as above: a price that does not add up today may add
      // up once somebody corrects it, and a stamp here would hide that.
      await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
        Notes:
          "❌ Could not calculate a valid final price after 3 attempts. Check Target/Max vs Ideal/Min.",
      });
    
    console.log("❌ Failed after 3 attempts.");
    }
  },
};

/*
 * The price, and the status only if it has not already moved on.
 *
 * CHANGED - this always set "Allocated". Now that a late run is possible at
 * all (see shouldRun), writing that unconditionally would drag an order that
 * has already asked for a label back a step, and the label request would look
 * like it never happened.
 *
 * So the status is only advanced from the ones that come before it. The price
 * is written either way, because that is the whole reason for running.
 */
const STATUSES_BEFORE_ALLOCATED = [
  "Outsource",
  "Claim Processing",
  "Confirmed",
  "StockX Processing",
  "GOAT Processing",
];

async function updateAllocated(order, unitId, finalPrice, ctx, { notes }) {
  const currentStatus = getSelectName(order.fields["Fulfillment Status"]);
  const mayAdvance = STATUSES_BEFORE_ALLOCATED.includes(currentStatus);

  if (!mayAdvance) {
    console.log(
      `Order ${order.id} is already at "${currentStatus}", so only the price is written.`
    );
  }

  await ctx.airtable.updateRecord("Unfulfilled Orders Log", order.id, {
    ...(mayAdvance ? { "Fulfillment Status": "Allocated" } : {}),
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
