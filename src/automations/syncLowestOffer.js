const TABLE_NAME = "Unfulfilled Orders Log";
const BOT_URL = "https://discord-wtb-bot.onrender.com/sync-lowest";

export const syncLowestOffer = {
  name: "syncLowestOffer",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Current Lowest Offer",
  ],

  async shouldRun(record) {
    return true;
  },

  async run(record) {
    const res = await fetch(BOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: record.id,
      }),
    });

    const text = await res.text().catch(() => "");

    if (!res.ok) {
      throw new Error(`sync-lowest failed: ${res.status} ${text}`);
    }

    console.log(`✅ Synced lowest offer for ${record.id}`);
  },
};
