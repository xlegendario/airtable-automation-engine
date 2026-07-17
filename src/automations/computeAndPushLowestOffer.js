import { getFirstValue, getNumber, getSelectName } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";

// Same estimate-per-source values Make scenario 1 used to write.
// TODO: confirm with Dario whether these should instead come from
// "Estimated Fulfillment Time" (which already varies by fulfillment
// method) rather than being fixed per Partner/Seller.
const ESTIMATED_DAYS_SELLER = 2;
const ESTIMATED_DAYS_PARTNER = 7;

export const computeAndPushLowestOffer = {
  name: "computeAndPushLowestOffer",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Lowest Seller Offer",
    "Lowest Seller Offer (Normalized)",
    "Lowest Seller Offer (VAT excl.)",
    "Lowest Partner Offer",
    "Partner or Seller", // re-fires after setPartnerOrSeller updates this
    "Consignment Pre-Offer?",
    "Consignment Offer Price",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const status = getSelectName(f["Fulfillment Status"]);
    if (status !== "Outsource" && status !== "Claim Processing") return false;

    return computeQualifyingOffer(f) != null;
  },

  async run(record, ctx) {
    const f = record.fields;

    const offer = computeQualifyingOffer(f);

    if (!offer) {
      console.log(`ℹ️ No qualifying offer to process for ${record.id}`);
      return;
    }

    const { amount, vatType, threshold, beatsConsignment, isPartner } = offer;

    const updates = {};

    // Seller beats an existing consignment pre-offer: clear it and treat
    // this like a normal seller offer from here on (same as scenario 1
    // "Seller beats consignment" branches).
    if (beatsConsignment) {
      updates["Consignment Pre-Offer?"] = false;
      updates["Consignment Offer Price"] = null;
      updates["Consignment Offer Triggered?"] = false;
    }

    const autoAcceptEnabled = isAutoAcceptEnabled(f);
    const qualifiesForAutoAccept =
      autoAcceptEnabled && threshold != null && amount <= threshold;

    if (qualifiesForAutoAccept) {
      updates["Fulfillment Status"] = "Confirmed";
      updates["Offer Accepted?"] = true;
      updates["Offer Sent?"] = false;
      updates["Offer Notes"] = isPartner
        ? "Offer Accepted From Partner Offers"
        : "Offer Accepted From Seller Offers";
    } else {
      updates["Lowest Offer"] = amount;
      updates["Offer VAT Type"] = vatType;
      updates["Estimated Time"] = isPartner
        ? ESTIMATED_DAYS_PARTNER
        : ESTIMATED_DAYS_SELLER;
      updates["Offer Accepted?"] = false;
      updates["Offer Sent?"] = true;
      updates["Offer Notes"] = isPartner
        ? "Offer Send From Partner Offers"
        : "Offer Send From Seller Offers";
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, updates);

    console.log(
      `✅ computeAndPushLowestOffer for ${record.id}: ${
        qualifiesForAutoAccept ? "auto-confirmed" : "forwarded to store"
      } (${vatType}, €${amount})`
    );
  },
};

/**
 * Mirrors the exact branching logic from Make scenario 1
 * ("Phase 12.1: Parse Lowest Offer To Offer Stores").
 *
 * Returns null if there's nothing to process yet (e.g. no offers, or
 * missing required fields), otherwise:
 *   { amount, vatType, threshold, beatsConsignment, isPartner }
 */
function computeQualifyingOffer(f) {
  const partnerOrSeller = getSelectName(f["Partner or Seller"]);
  if (!partnerOrSeller) return null;

  const consignmentPreOffer = !!getFirstValue(f["Consignment Pre-Offer?"]);
  const consignmentOfferPrice = getNumber(f["Consignment Offer Price"]);

  if (partnerOrSeller === "Partner") {
    const amount = getNumber(f["Lowest Partner Offer"]);
    if (amount == null) return null;

    const threshold = getNumber(f["Final Outsource Buying Price"]);
    const beatsConsignment =
      consignmentPreOffer &&
      consignmentOfferPrice != null &&
      amount < consignmentOfferPrice;

    return {
      amount,
      vatType: "Margin", // partner offers are always Margin
      threshold,
      beatsConsignment,
      isPartner: true,
    };
  }

  // partnerOrSeller === "Seller"
  const vatType = getFirstValue(f["Lowest Offer VAT Type"]);
  const country = getFirstValue(f["Client Country"]);
  const isNL = country === "Netherlands";

  let amount;
  let threshold;

  if (vatType === "Margin") {
    amount = getNumber(f["Lowest Seller Offer"]);
    threshold = getNumber(f["Final Outsource Buying Price"]);
  } else if (vatType === "VAT0") {
    amount = isNL
      ? getNumber(f["Lowest Seller Offer (Normalized)"])
      : getNumber(f["Lowest Seller Offer"]);
    threshold = isNL
      ? getNumber(f["Final Outsource Buying Price"])
      : getNumber(f["Final Outsource Buying Price (VAT 0%)"]);
  } else if (vatType === "VAT21") {
    amount = isNL
      ? getNumber(f["Lowest Seller Offer"])
      : getNumber(f["Lowest Seller Offer (VAT excl.)"]);
    threshold = isNL
      ? getNumber(f["Final Outsource Buying Price"])
      : getNumber(f["Final Outsource Buying Price (VAT 0%)"]);
  } else {
    return null;
  }

  if (amount == null) return null;

  const beatsConsignment =
    consignmentPreOffer &&
    consignmentOfferPrice != null &&
    amount < consignmentOfferPrice;

  return {
    amount,
    vatType,
    threshold,
    beatsConsignment,
    isPartner: false,
  };
}

function isAutoAcceptEnabled(f) {
  const value = f["Auto Offer Accept?"];
  if (Array.isArray(value)) return value[0] === true;
  return value === true;
}
