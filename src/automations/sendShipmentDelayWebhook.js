import { getFirstValue } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const WEBHOOK_URL = "https://airtable-discord-updates.onrender.com/";

export const sendShipmentDelayWebhook = {
  name: "sendShipmentDelayWebhook",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Shipment Delay Trigger",
    "Shipping Status",
    "Source",
    "Linked Seller ID",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const delayTrigger = getFirstValue(f["Shipment Delay Trigger"]);
    const shippingStatus = getFirstValue(f["Shipping Status"]);

    const isStillPending =
      !shippingStatus ||
      shippingStatus === "Pending";

    const isWarning =
      delayTrigger === "delay-warning" &&
      !f["Shipment Delay Warning Sent At"];

    const isPenalty =
      delayTrigger === "delay-penalty" &&
      !f["Shipment Delay Penalty Sent At"];

    return (
      isStillPending &&
      (
        isWarning ||
        isPenalty
      )
    );
  },

  async run(record) {
    const f = record.fields;

    const delayTrigger = getFirstValue(f["Shipment Delay Trigger"]);
    const isPenalty = delayTrigger === "delay-penalty";

    const payload = {
      trigger_type: isPenalty
        ? "shipment-delay-penalty"
        : "shipment-delay-warning",

      delay_stage: isPenalty
        ? "penalty"
        : "warning",

      penalty_amount: 10,

      shopify_order_number: getFirstValue(f["Shopify Order Number"]),
      order_id: getFirstValue(f["Order ID"]),

      linked_seller_id: getFirstValue(f["Linked Seller ID"]),
      seller_id: getFirstValue(f["Seller ID"]),

      store_name: getFirstValue(f["Store Name"]),
      source: getFirstValue(f["Source"]),

      product_name: getFirstValue(f["Product Name"]),
      size: getFirstValue(f["Size"]),
      sku: getFirstValue(f["SKU"]),

      tracking_url: getFirstValue(f["Tracking URL"]),

      claimed_channel_id: getFirstValue(f["Claimed Channel ID"]),
      wtb_created_channel_id: getFirstValue(f["WTB Created Channel ID"]),
      consignment_created_channel_id: getFirstValue(f["Consignment Created Channel ID"]),

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
