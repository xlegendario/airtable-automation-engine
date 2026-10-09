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
    const estimatedTime = getFirstValue(f["Estimated Time"]) || null;
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
    const estimatedTime = getFirstValue(f["Estimated Time"]) || null;

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
      order_id: getFirstValue(f["Order ID"]),
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

    /*
     * Whether the store may counter this one at all.
     *
     * A supplier with an API sells from a published list at a fixed price and
     * answers through that API, not by pressing a button. Kickz Caviar
     * refuses a counter on such an offer either way; this is so the embed
     * does not carry a button that can only be told no.
     */
    if (await lowestOfferIsApiSupplier(f, ctx)) {
      payload.no_counter = true;
    }

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

/*
 * Is the seller behind the winning offer one that answers through an API?
 *
 * Asked by the Seller ID the order already carries, so no second link has to
 * be followed. Five minutes of cache: switching the field on for a seller is
 * a deliberate act and nobody waits on it to the second.
 *
 * Anything that goes wrong reads as "no", which leaves the embed exactly as
 * it was before this existed - a button too many is better than an offer the
 * store cannot answer.
 */
const supplierApiBySellerId = new Map();

async function lowestOfferIsApiSupplier(f, ctx) {
  const sellerId = getFirstValue(f["Lowest Offer Seller ID"]);

  if (!sellerId) return false;

  const key = String(sellerId).trim();
  const cached = supplierApiBySellerId.get(key);

  if (cached && Date.now() - cached.at < 300000) return cached.api;

  const rows = await ctx.airtable
    .listRecords("Sellers Database", {
      filterByFormula: `{Seller ID} = "${key.replace(/"/g, '')}"`,
    })
    .catch(() => []);

  const api = !!getFirstValue(rows[0]?.fields?.["Supplier API"]);

  supplierApiBySellerId.set(key, { at: Date.now(), api });

  return api;
}

function buildOfferWebhookKey({ offerVatType, offerToStore, estimatedTime }) {
  return [
    offerVatType || "",
    offerToStore != null ? String(offerToStore) : "",
    estimatedTime != null ? String(estimatedTime) : "",
  ].join("|");
}
