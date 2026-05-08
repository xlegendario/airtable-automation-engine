import { getFirstValue } from "../lib/helpers.js";

export const unfulfilledOrderCreated = {
  name: "unfulfilledOrderCreated",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["created"],

  async shouldRun(record) {
    const storeName = getFirstValue(record.fields["Store Name"]);

    return (
      storeName !== "APLUG.PL" &&
      storeName !== "SneakerAsk" &&
      !record.fields["external_discord_sent_at"]
    );
  },

  async run(record, ctx) {
    const fields = record.fields;

    const storeName = getFirstValue(fields["Store Name"]);

    const finalSku =
      getFirstValue(fields["SKU"]) ||
      getFirstValue(fields["SKU Soft"]);

    const productName = getFirstValue(
      fields["Shopify Product Name"]
    );

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

    await ctx.airtable.updateRecord(this.tableName, record.id, {
      external_discord_sent_at: new Date().toISOString(),
    });

    console.log(`✅ Sent Discord update for ${record.id}`);
  },
};
