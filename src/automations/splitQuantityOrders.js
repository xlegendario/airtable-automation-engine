import { getNumber } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";

const FIELDS_TO_COPY = [
  "Shopify Order Number",
  "Product Name",
  "Shopify Product Name",
  "Match Risk Level",
  "SKU (Soft)",
  "Size",
  "Brand",
  "Selling Price",
  "Order Date",
  "Fulfillment Status",
  "Order Source",
  "Payment Status",
  "Shopify Order ID",
  "Shopify Product ID",
  "Shopify Variant ID",
  "Client",
  "SKU Master Link",
  "Store Listings",
  "Notes",
  "Picture",
  "Fulfillment Sent?",
];

export const splitQuantityOrders = {
  name: "splitQuantityOrders",
  tableName: TABLE_NAME,
  eventTypes: ["created", "changed"],

  async shouldRun(record) {
    const quantity = getNumber(record.fields["Quantity"]);

    return quantity > 1;
  },

  async run(record, ctx) {
    const quantity = getNumber(record.fields["Quantity"]);

    if (!quantity || quantity <= 1) return;

    // First set original to 1 so it won't trigger again
    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      Quantity: 1,
    });

    const fieldsToCreate = {};

    for (const fieldName of FIELDS_TO_COPY) {
      if (record.fields[fieldName] !== undefined) {
        fieldsToCreate[fieldName] = record.fields[fieldName];
      }
    }

    fieldsToCreate.Quantity = 1;

    for (let i = 0; i < quantity - 1; i++) {
      await ctx.airtable.createRecord(TABLE_NAME, fieldsToCreate);
    }

    console.log(
      `✅ Split ${record.id} quantity ${quantity} into ${quantity} records`
    );
  },
};
