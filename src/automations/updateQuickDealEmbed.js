import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const BOT_URL = "https://discord-deal-bot.onrender.com/quick-deal/update-embed";

export const updateQuickDealEmbed = {
  name: "updateQuickDealEmbed",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Current Payout",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const messageId = getFirstValue(f["Claim Message ID"]);

    return !!messageId;
  },

  async run(record) {
    const f = record.fields;

    const messageId = getFirstValue(f["Claim Message ID"]);

    if (!messageId) {
      console.log(`⏭️ No Claim Message ID on ${record.id}`);
      return;
    }

    const body = {
      recordId: record.id,
      messageId,
      currentPayout: getFirstValue(f["Current Payout"]),
      maxPayout: getFirstValue(f["Max Payout"]),
    };

    const res = await fetch(BOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text().catch(() => "");

    if (!res.ok) {
      throw new Error(`Bot returned ${res.status}: ${text}`);
    }

    console.log(
      `✅ Quick deal embed updated for ${record.id} message=${messageId}`
    );
  },
};
