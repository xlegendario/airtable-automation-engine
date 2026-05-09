import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Inventory Units";

const AUTO_PAID_SELLERS = [
  "SE-00309",
  "SE-00537",
  "SE-00467",
  "SE-00560",
  "SE-00469",
  "SE-00281",
];

export const markInventoryPaidForAutoPaidSellers = {
  name: "markInventoryPaidForAutoPaidSellers",
  tableName: TABLE_NAME,
  eventTypes: ["created"],

  async shouldRun(record) {
    const sellerIdName = getFirstValue(record.fields["Seller ID Name"]);

    return AUTO_PAID_SELLERS.some((sellerId) =>
      sellerIdName.includes(sellerId)
    );
  },

  async run(record, ctx) {
    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Payment Status": { name: "Paid" },
    });

    console.log(`✅ Payment Status set to Paid for ${record.id}`);
  },
};
