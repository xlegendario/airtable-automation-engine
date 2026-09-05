import { getFirstValue } from "../lib/helpers.js";

export const unfulfilledOrderCreated = {
  name: "unfulfilledOrderCreated",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["created"],

  async shouldRun(record) {
    return !record.fields["external_discord_sent_at"];
  },

  async run(record, ctx) {
    const fields = record.fields;

    const storeName = getFirstValue(fields["Store Name"]);

    // Woovin added: a marketplace order needs no "new order" announcement
    // in Discord, because nobody has to be told to go and buy it - the
    // consignment service asks the consignors directly.
    const skipNewOrderDiscord =
      storeName === "APLUG.PL" ||
      storeName === "SneakerAsk" ||
      storeName === "Woovin";

    const finalSku =
      getFirstValue(fields["SKU"]) ||
      getFirstValue(fields["SKU Soft"]);

    const productName = getFirstValue(
      fields["Shopify Product Name"]
    );

    if (!skipNewOrderDiscord) {
      const payload = {
        trigger_type: "new-order",
        store_name: storeName,
        shopify_order_number: fields["Shopify Order Number"],
        product_name: productName,
        size: fields["Size"],
        sku: finalSku,
        record_id: record.id,
      };

      const res = await fetch(
        "https://airtable-discord-updates.onrender.com",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        throw new Error(
          `Discord endpoint failed: ${res.status} ${await res.text()}`
        );
      }
    }

    await ctx.airtable.updateRecord(this.tableName, record.id, {
      external_discord_sent_at: new Date().toISOString(),
      "Automation Engine Enabled": true,
    });

    console.log(
      skipNewOrderDiscord
        ? `✅ Automation enabled for ${record.id}; new-order Discord skipped for ${storeName}`
        : `✅ Sent Discord update and enabled automation for ${record.id}`
    );
  },
};
