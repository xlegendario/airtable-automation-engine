import { getFirstValue } from "../lib/helpers.js";

export const unfulfilledOrderAllocated = {
  name: "unfulfilledOrderAllocated",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["changed"],

  async shouldRun(record) {
    const fields = record.fields;
  
    const fulfillmentStatus = getFirstValue(fields["Fulfillment Status"]);
    const linkedInventoryUnit = fields["Linked Inventory Unit"];
    const source = fields["Source"];
  
    const calculatedAt = fields["linked_unit_price_calculated_at"];
    const autoAttemptedAt = fields["auto_allocate_attempted_at"];
  
    return (
      fulfillmentStatus === "Allocated" &&
      linkedInventoryUnit &&
      source &&
      !fields["allocated_update_sent_at"] &&
      (calculatedAt || autoAttemptedAt)
    );
  },

  async run(record, ctx) {
    const fields = record.fields;

    const storeName = getFirstValue(fields["Store Name"]);

    const finalSku =
      getFirstValue(fields["SKU"]) ||
      getFirstValue(fields["SKU Soft"]);

    const finalSource = getFirstValue(fields["Source"]);

    const payload = {
      trigger_type: "allocated-update",
      store_name: storeName,
      shopify_order_number: fields["Shopify Order Number"],
      product_name: getFirstValue(fields["Shopify Product Name"]),
      size: fields["Size"],
      sku: finalSku,
      source: finalSource,
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
        `Allocated update webhook failed: ${res.status} ${await res.text()}`
      );
    }

    await ctx.airtable.updateRecord(this.tableName, record.id, {
      allocated_update_sent_at: new Date().toISOString(),
    });

    console.log(`✅ Allocated update sent for ${record.id}`);
  },
};
