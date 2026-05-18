import { getFirstValue, getNumber } from "../lib/helpers.js";

const TABLE_NAME = "Unfulfilled Orders Log";
const WEBHOOK_URL = "https://airtable-discord-updates.onrender.com";

export const sendOfferRequestWebhook = {
  name: "sendOfferRequestWebhook",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Offer VAT Type",
    "Offer To Store",
    "Offer Sent?",
    "Estimated Time",
    "offer_request_webhook_key",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const offerVatType = getFirstValue(f["Offer VAT Type"]);
    const offerToStore = getNumber(f["Offer To Store"]);
    const estimatedTime = getNumber(f["Estimated Time"]);
    const offerSent = !!f["Offer Sent?"];

    const currentKey = buildOfferWebhookKey({
      offerVatType,
      offerToStore,
      estimatedTime,
    });

    const lastKey = getFirstValue(f["offer_request_webhook_key"]);

    return (
      !!offerVatType &&
      offerToStore != null &&
      offerSent === true &&
      currentKey !== lastKey
    );
  },

  async run(record, ctx) {
    const f = record.fields;

    const offerVatType = getFirstValue(f["Offer VAT Type"]);
    const offerToStore = getNumber(f["Offer To Store"]);
    const estimatedTime = getNumber(f["Estimated Time"]);

    if (offerToStore == null) {
      throw new Error(`Offer To Store invalid/empty for ${record.id}`);
    }

    const offerKey = buildOfferWebhookKey({
      offerVatType,
      offerToStore,
      estimatedTime,
    });

    const payload = {
      trigger_type: "offer-requests",

      store_name: getFirstValue(f["Store Name"]),
      shopify_order_number: getFirstValue(f["Shopify Order Number"]),
      product_name:
        getFirstValue(f["Shopify Product Name"]) ||
        getFirstValue(f["Product Name"]),
      size: getFirstValue(f["Size"]),
      sku:
        getFirstValue(f["SKU"]) ||
        getFirstValue(f["SKU Soft"]),

      record_id: record.id,

      lowest_offer_label: offerVatType,
      lowest_offer: String(offerToStore),
      lowest_offer_value: offerToStore,

      selling_price:
        getFirstValue(f["Shopify Selling Price"]) ||
        getFirstValue(f["Selling Price"]),
    };

    if (estimatedTime != null) {
      payload.estimated_time = estimatedTime;
    }

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => "");

    if (!res.ok) {
      throw new Error(`Offer request webhook failed: ${res.status} ${text}`);
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      offer_request_webhook_key: offerKey,
    });

    console.log(`✅ Offer request webhook sent for ${record.id}`);
  },
};

function buildOfferWebhookKey({ offerVatType, offerToStore, estimatedTime }) {
  return [
    offerVatType || "",
    offerToStore != null ? String(offerToStore) : "",
    estimatedTime != null ? String(estimatedTime) : "",
  ].join("|");
}
