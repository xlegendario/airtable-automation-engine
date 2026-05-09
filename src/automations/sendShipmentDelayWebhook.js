import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const WEBHOOK_URL = "https://airtable-discord-updates.onrender.com/";

const BLOCKED_SELLERS = [
  "SE-00781",
  "SE-00683",
  "SE-00455",
];

export const sendShipmentDelayWebhook = {
  name: "sendShipmentDelayWebhook",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Days Since Fulfillment",
    "Source",
    "Linked Seller ID",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const days = Number(f["Days Since Fulfillment"]);
    const source = getFirstValue(f["Source"]);
    const sellerId = getFirstValue(f["Linked Seller ID"]);

    const sellerAllowed = !BLOCKED_SELLERS.includes(sellerId);

    const isInStockDelay =
      days === 2 &&
      source === "In Stock";

    const isEuOutsourceDelay =
      days === 3 &&
      source === "EU Outsource";

    const isMarketplaceDelay =
      days === 9 &&
      source === "Marketplace";

    return (
      sellerAllowed &&
      (
        isInStockDelay ||
        isEuOutsourceDelay ||
        isMarketplaceDelay
      )
    );
  },

  async run(record) {
    const f = record.fields;

    const payload = {
      trigger_type: "shipment-delay",

      shopify_order_number: getFirstValue(f["Shopify Order Number"]),
      order_id: getFirstValue(f["Order ID"]),
      linked_seller_id: getFirstValue(f["Linked Seller ID"]),

      product_name: getFirstValue(f["Product Name"]),
      size: getFirstValue(f["Size"]),
      sku: getFirstValue(f["SKU"]),

      record_id: record.id,
    };

    const resp = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text().catch(() => "");

    if (!resp.ok) {
      throw new Error(
        `Shipment delay webhook failed (${resp.status}): ${text}`
      );
    }

    console.log("✅ shipment-delay webhook sent:", payload);
  },
};
