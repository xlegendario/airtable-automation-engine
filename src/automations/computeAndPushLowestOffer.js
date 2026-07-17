import { getFirstValue, getNumber, getSelectName } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";

// "Estimated Fulfillment Time" depends on "Source", which only gets
// filled in AFTER acceptance (once there's a Linked Inventory Unit /
// Linked Seller ID) — so at offer-request time it's always empty.
// Hardcode a reasonable estimate per Partner/Seller instead.
const ESTIMATED_TIME_SELLER = "24 - 72 hours";
const ESTIMATED_TIME_PARTNER = "within 10-12 business days";

function getEstimatedTimeText(isPartner) {
  return isPartner ? ESTIMATED_TIME_PARTNER : ESTIMATED_TIME_SELLER;
}

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

      const estimatedTimeText = getEstimatedTimeText(isPartner);
      if (estimatedTimeText) {
        updates["Estimated Time"] = estimatedTimeText;
      }

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
  const sellerVatType = getFirstValue(f["Lowest Offer VAT Type"]);
  const country = getFirstValue(f["Client Country"]);
  const isNL = country === "Netherlands";

  let amount;
  let threshold;
  let outputVatType;

  if (sellerVatType === "Margin") {
    amount = getNumber(f["Lowest Seller Offer"]);
    threshold = getNumber(f["Final Outsource Buying Price"]);
    outputVatType = "Margin";
  } else if (sellerVatType === "VAT0") {
    amount = isNL
      ? getNumber(f["Lowest Seller Offer (Normalized)"])
      : getNumber(f["Lowest Seller Offer"]);
    threshold = isNL
      ? getNumber(f["Final Outsource Buying Price"])
      : getNumber(f["Final Outsource Buying Price (VAT 0%)"]);
    // Store-facing VAT type follows the CLIENT's country, not the
    // seller's own VAT type — NL clients always see VAT21, non-NL
    // clients always see VAT0 (confirmed against scenario 1: this
    // relabeling is consistent across all 4 branches there).
    outputVatType = isNL ? "VAT21" : "VAT0";
  } else if (sellerVatType === "VAT21") {
    amount = isNL
      ? getNumber(f["Lowest Seller Offer"])
      : getNumber(f["Lowest Seller Offer (VAT excl.)"]);
    threshold = isNL
      ? getNumber(f["Final Outsource Buying Price"])
      : getNumber(f["Final Outsource Buying Price (VAT 0%)"]);
    outputVatType = isNL ? "VAT21" : "VAT0";
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
    vatType: outputVatType,
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
