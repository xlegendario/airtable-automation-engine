import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const DISABLE_URL = "https://discord-deal-bot.onrender.com/quick-deal/disable";

export const disableClaimDealButtons = {
  name: "disableClaimDealButtons",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Claim Message ID",
    "Claim Deal Buttons Disabled",
    "Fulfillment Status",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const claimMessageId = getFirstValue(f["Claim Message ID"]);
    const alreadyDisabled = !!f["Claim Deal Buttons Disabled"];
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
      !!claimMessageId &&
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
      throw new Error(`Disable quick deal failed: ${res.status} ${res.statusText} ${text}`);
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Claim Deal Buttons Disabled": true,
    });

    console.log(`✅ Claim deal buttons disabled for ${record.id}`);
  },
};
