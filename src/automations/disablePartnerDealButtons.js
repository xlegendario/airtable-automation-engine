import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const DISABLE_URL = "https://partner-deal-bot.onrender.com/partner-deal/disable";

export const disablePartnerDealButtons = {
  name: "disablePartnerDealButtons",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Partner Deal Message ID",
    "Partner Deal Buttons Disabled",
    "Fulfillment Status",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const partnerMessageId = getFirstValue(f["Partner Deal Message ID"]);
    const alreadyDisabled = !!f["Partner Deal Buttons Disabled"];
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
      !!partnerMessageId &&
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
        `Disable partner deal failed: ${res.status} ${res.statusText} ${text}`
      );
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Partner Deal Buttons Disabled": true,
    });

    console.log(`✅ Partner deal buttons disabled for ${record.id}`);
  },
};
