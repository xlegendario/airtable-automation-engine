import { getNumber } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";

export const setPartnerOrSeller = {
  name: "setPartnerOrSeller",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Lowest Partner Offer",
    "Lowest Seller Offer",
    "Lowest Seller Offer (Normalized)",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const partnerVal = getNumber(f["Lowest Partner Offer"]);
    const sellerVal = getNumber(f["Lowest Seller Offer (Normalized)"]);
    const currentChoice = getSelectName(f["Partner or Seller"]);

    const nextChoice = decidePartnerOrSeller(partnerVal, sellerVal);

    return currentChoice !== nextChoice;
  },

  async run(record, ctx) {
    const f = record.fields;

    const partnerVal = getNumber(f["Lowest Partner Offer"]);
    const sellerVal = getNumber(f["Lowest Seller Offer (Normalized)"]);

    const choice = decidePartnerOrSeller(partnerVal, sellerVal);

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Partner or Seller": choice ? { name: choice } : null,
    });

    console.log(
      `✅ Partner or Seller set for ${record.id}: ${choice || "cleared"}`
    );
  },
};

function decidePartnerOrSeller(partnerVal, sellerVal) {
  if (partnerVal != null && sellerVal != null) {
    return partnerVal < sellerVal ? "Partner" : "Seller";
  }

  if (partnerVal != null) return "Partner";
  if (sellerVal != null) return "Seller";

  return null;
}

function getSelectName(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.name) return value.name;
  return null;
}
