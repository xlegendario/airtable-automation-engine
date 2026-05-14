import {
  getSelectName,
  hasLinkedRecord,
} from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";

export const shippingLabelReadyToShip = {
  name: "shippingLabelReadyToShip",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],
  watchFields: [
    "Shipping Label",
    "Fulfillment Status",
    "Linked Inventory Unit",
    "Shopify Order ID",
    "Outsourced?",
  ],

  async shouldRun(record) {
    const f = record.fields;
    const status = getSelectName(f["Fulfillment Status"]);
  
    return (
      !!f["Shipping Label"] &&
      ["Allocated", "Awaiting Label", "Requested Label"].includes(status)
    );
  },

  async run(record, ctx) {
    const f = record.fields;

    const updatesForOrders = [];
    const updatesForInventory = [];

    updatesForOrders.push({
      id: record.id,
      fields: {
        "Fulfillment Status": "Ready to Ship",
      },
    });

    const linkedInventory = f["Linked Inventory Unit"];

    if (hasLinkedRecord(linkedInventory)) {
      for (const linked of linkedInventory) {
        updatesForInventory.push({
          id: linked.id,
          fields: {
            "Availability Status": "Sold",
          },
        });
      }
    }

    const outsourced = !!f["Outsourced?"];

    if (!outsourced) {
      const shopifyOrderId = f["Shopify Order ID"];

      if (shopifyOrderId) {
        const relatedRecords = await ctx.airtable.listRecords(TABLE_NAME, {
          filterByFormula: `AND(
            {Shopify Order ID} = "${String(shopifyOrderId).replace(/"/g, '\\"')}",
            OR(
              {Fulfillment Status} = "Awaiting Label",
              {Fulfillment Status} = "Requested Label"
            ),
            NOT({Outsourced?})
          )`,
        });

        for (const related of relatedRecords) {
          if (related.id === record.id) continue;

          updatesForOrders.push({
            id: related.id,
            fields: {
              "Fulfillment Status": "Ready to Ship",
            },
          });

          const linkedInv = related.fields["Linked Inventory Unit"];

          if (hasLinkedRecord(linkedInv)) {
            for (const inv of linkedInv) {
              updatesForInventory.push({
                id: inv.id,
                fields: {
                  "Availability Status": "Sold",
                },
              });
            }
          }
        }
      }
    }

    const dedupedInventory = [
      ...new Map(
        updatesForInventory.map((update) => [update.id, update])
      ).values(),
    ];

    for (const update of updatesForOrders) {
      await ctx.airtable.updateRecord(TABLE_NAME, update.id, update.fields);
    }

    for (const update of dedupedInventory) {
      await ctx.airtable.updateRecord(
        "Inventory Units",
        update.id,
        update.fields
      );
    }

    console.log(
      `✅ Shipping label processed for ${record.id}. Orders: ${updatesForOrders.length}, Inventory: ${dedupedInventory.length}`
    );
  },
};
