import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const DISABLE_URL = "https://discord-wtb-bot.onrender.com/seller-offer/disable";

export const disableSellerOfferButtons = {
  name: "disableSellerOfferButtons",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Seller Offer Message ID",
    "Seller Offer Buttons Disabled",
    "Fulfillment Status",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const sellerOfferMessageId = getFirstValue(f["Seller Offer Message ID"]);
    const alreadyDisabled = !!f["Seller Offer Buttons Disabled"];
    const fulfillmentStatus = getFirstValue(f["Fulfillment Status"]);

    const allowedStatuses = [
      "Store Fulfilled",
      "Cancelled",
      "Fulfilled",
      "Ready to Ship",
      "Awaiting Label",
      "Allocated",
    ];

    return (
      !!sellerOfferMessageId &&
      !alreadyDisabled &&
      allowedStatuses.includes(fulfillmentStatus)
    );
  },

  async run(record, ctx) {
    const res = await fetch(DISABLE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recordId: record.id,
      }),
    });

    const text = await res.text().catch(() => "");

    if (!res.ok) {
      throw new Error(
        `Disable seller offer failed: ${res.status} ${res.statusText} ${text}`
      );
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Seller Offer Buttons Disabled": true,
    });

    console.log(`✅ Seller offer buttons disabled for ${record.id}`);
  },
};
