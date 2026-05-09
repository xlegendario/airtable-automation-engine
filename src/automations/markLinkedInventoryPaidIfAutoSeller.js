import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const INVENTORY_TABLE_NAME = "Inventory Units";

const AUTO_PAID_SELLERS = [
  "SE-00309",
  "SE-00537",
  "SE-00467",
  "SE-00560",
  "SE-00469",
  "SE-00281",
];

export const markLinkedInventoryPaidIfAutoSeller = {
  name: "markLinkedInventoryPaidIfAutoSeller",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Linked Inventory Unit",
  ],

  async shouldRun(record) {
    const inventoryUnitId = getLinkedRecordId(
      record.fields["Linked Inventory Unit"]
    );

    return !!inventoryUnitId;
  },

  async run(record, ctx) {
    const inventoryUnitId = getLinkedRecordId(
      record.fields["Linked Inventory Unit"]
    );

    if (!inventoryUnitId) {
      return;
    }

    const unit = await ctx.airtable.getRecord(
      INVENTORY_TABLE_NAME,
      inventoryUnitId
    );

    const sellerIdName = getFirstValue(unit.fields["Seller ID (Lookup)"]);
    const currentPaymentStatus = getFirstValue(unit.fields["Payment Status"]);

    const isAutoPaidSeller = AUTO_PAID_SELLERS.some((sellerId) =>
      sellerIdName.includes(sellerId)
    );

    if (!isAutoPaidSeller) {
      console.log(
        `⏭️ Inventory Unit ${inventoryUnitId} seller ${sellerIdName || "unknown"} is not auto-paid`
      );
      return;
    }

    if (currentPaymentStatus === "Paid") {
      console.log(`⏭️ Inventory Unit ${inventoryUnitId} already Paid`);
      return;
    }

    await ctx.airtable.updateRecord(INVENTORY_TABLE_NAME, inventoryUnitId, {
      "Payment Status": "Paid",
    });

    console.log(
      `✅ Inventory Unit ${inventoryUnitId} marked Paid for auto-paid seller ${sellerIdName}`
    );
  },
};

function getLinkedRecordId(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const first = value[0];

  if (typeof first === "string") {
    return first;
  }

  if (first && typeof first === "object" && first.id) {
    return first.id;
  }

  return null;
}
