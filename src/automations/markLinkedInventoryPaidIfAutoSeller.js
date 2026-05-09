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
    const linkedInventoryUnit = record.fields["Linked Inventory Unit"];

    return (
      Array.isArray(linkedInventoryUnit) &&
      linkedInventoryUnit.length > 0 &&
      !!linkedInventoryUnit[0]?.id
    );
  },

  async run(record, ctx) {
    const linkedInventoryUnit = record.fields["Linked Inventory Unit"];
    const inventoryUnitId = linkedInventoryUnit[0].id;

    const unit = await ctx.airtable.getRecord(
      INVENTORY_TABLE_NAME,
      inventoryUnitId
    );

    const sellerIdName = getFirstValue(unit.fields["Seller ID Name"]);
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
      console.log(
        `⏭️ Inventory Unit ${inventoryUnitId} already Paid`
      );
      return;
    }

    await ctx.airtable.updateRecord(INVENTORY_TABLE_NAME, inventoryUnitId, {
      "Payment Status": { name: "Paid" },
    });

    console.log(
      `✅ Inventory Unit ${inventoryUnitId} marked Paid for auto-paid seller ${sellerIdName}`
    );
  },
};
