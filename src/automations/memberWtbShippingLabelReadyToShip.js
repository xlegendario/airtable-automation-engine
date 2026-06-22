import { getSelectName, hasLinkedRecord } from "../lib/helpers.js";

const TABLE_NAME = "Member WTBs";

export const memberWtbShippingLabelReadyToShip = {
  name: "memberWtbShippingLabelReadyToShip",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],
  watchFields: [
    "Shipping Label",
    "Fulfillment Status",
    "Linked Inventory Unit"
  ],

  async shouldRun(record) {
    const f = record.fields;
    const status = getSelectName(f["Fulfillment Status"]);

    return (
      !!f["Shipping Label"] &&
      ["Allocated", "Label Requested"].includes(status)
    );
  },

  async run(record, ctx) {
    const f = record.fields;

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Fulfillment Status": "Ready to Ship"
    });

    const linkedInventory = f["Linked Inventory Unit"];

    if (hasLinkedRecord(linkedInventory)) {
      for (const linked of linkedInventory) {
        await ctx.airtable.updateRecord("Inventory Units", linked.id, {
          "Availability Status": "Sold"
        });
      }
    }

    console.log(`✅ Member WTB label processed for ${record.id}`);
  }
};
