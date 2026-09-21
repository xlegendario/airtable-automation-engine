/*
 * The three outside services a store order's invoice goes through:
 * Rompslomp (invoice, journal entry, PDF), SendGrid (the mail) and the
 * store's own Shopify (the fulfilment). Thin wrappers; the decisions live in
 * storeInvoicing.js.
 *
 * Needs ROMPSLOMP_API_TOKEN and SENDGRID_API_KEY on this service - the same
 * token and key the Make scenarios use. ROMPSLOMP_COMPANY_ID defaults to the
 * company those scenarios book in.
 */
import { ROMPSLOMP } from "./storeInvoicing.js";

const SHOPIFY_API_VERSION = "2025-07";

async function readBody(res) {
  const text = await res.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function call(url, options, what) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const body = await readBody(res);

  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${what} failed: ${res.status} ${String(detail).slice(0, 400)}`);
  }

  return body;
}

/* ---------------- Rompslomp ---------------- */

function rompslomp(path, { method = "GET", body, accept = "application/json" } = {}) {
  const token = process.env.ROMPSLOMP_API_TOKEN;
  if (!token) throw new Error("ROMPSLOMP_API_TOKEN is not set on this service.");

  const company = process.env.ROMPSLOMP_COMPANY_ID || ROMPSLOMP.companyId;

  return fetch(`https://api.rompslomp.nl/api/v1/companies/${company}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: accept },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
}

async function rompslompJson(path, options, what) {
  const res = await rompslomp(path, options);
  const body = await readBody(res);

  if (!res.ok) {
    throw new Error(`Rompslomp ${what} failed: ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }

  return body;
}

export const rompslompApi = {
  async searchCustomers(name) {
    const q = new URLSearchParams({ selection: "customers", "search[q]": name, page: "1", per_page: "100" });
    const data = await rompslompJson(`/contacts?${q}`, {}, "contact search");
    return data?.contacts || [];
  },

  async getContact(id) {
    const data = await rompslompJson(`/contacts/${id}`, {}, "contact lookup");
    return data?.contact || null;
  },

  async findInvoiceByReference(reference) {
    const q = new URLSearchParams({ "search[api_reference]": reference, per_page: "5" });
    const data = await rompslompJson(`/sales_invoices?${q}`, {}, "invoice search");
    return (data?.sales_invoices || []).find((inv) => inv.api_reference === reference) || null;
  },

  async createInvoice(body) {
    const data = await rompslompJson("/sales_invoices", { method: "POST", body }, "invoice");
    return data?.sales_invoice;
  },

  async publishInvoice(id) {
    const data = await rompslompJson(`/sales_invoices/${id}`, { method: "PATCH", body: { sales_invoice: { _publish: true } } }, "publish");
    return data?.sales_invoice;
  },

  async getInvoice(id) {
    const data = await rompslompJson(`/sales_invoices/${id}`, {}, "invoice lookup");
    return data?.sales_invoice;
  },

  async createJournalEntry(body) {
    const data = await rompslompJson("/journal_entries", { method: "POST", body }, "journal entry");
    return data?.journal_entry;
  },

  async invoicePdfBase64(id) {
    const res = await rompslomp(`/sales_invoices/${id}/pdf`, { accept: "application/pdf" });
    if (!res.ok) throw new Error(`Rompslomp PDF failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
};

/* ---------------- SendGrid ---------------- */

export async function sendMail(message) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set on this service.");

  await call(
    "https://api.sendgrid.com/v3/mail/send",
    { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(message) },
    "SendGrid mail"
  );
}

/* ---------------- Shopify ---------------- */

export function shopifyApi(merchant) {
  const base = String(merchant.shopifyUrl || "").replace(/\/$/, "");
  const token = merchant.shopifyToken;

  if (!base || !token) throw new Error(`${merchant.storeName} has no Shopify Store URL or Shopify Token.`);

  const headers = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  const rest = (path, options = {}, what = path) =>
    call(`${base}/admin/api/${SHOPIFY_API_VERSION}${path}`, { headers, ...options }, `Shopify ${what}`);

  return {
    async fulfillmentOrders(orderId) {
      const data = await rest(`/orders/${orderId}/fulfillment_orders.json`, {}, "fulfillment orders");
      return data?.fulfillment_orders || [];
    },

    // Marks the line fulfilled, from our location. What the main scenario did.
    fulfill(fulfillmentOrderId, lineId, locationId) {
      return rest("/fulfillments.json", {
        method: "POST",
        body: JSON.stringify({
          fulfillment: {
            message: "Auto-fulfilled by system.",
            notify_customer: false,
            tracking_info: { number: null, url: null },
            line_items_by_fulfillment_order: [
              { fulfillment_order_id: fulfillmentOrderId, fulfillment_order_line_items: [{ id: lineId, quantity: 1 }] }
            ],
            location_id: locationId
          }
        })
      }, "fulfillment");
    },

    async availableAt(inventoryItemId, locationId) {
      const data = await rest(`/inventory_levels.json?inventory_item_ids=${inventoryItemId}&location_ids=${locationId}`, {}, "inventory level");
      const level = (data?.inventory_levels || [])[0];
      return level ? Number(level.available) : null;
    },

    setAvailable(inventoryItemId, locationId, available) {
      return rest("/inventory_levels/set.json", {
        method: "POST",
        body: JSON.stringify({ location_id: Number(locationId), inventory_item_id: Number(inventoryItemId), available })
      }, "inventory set");
    },

    // Moves the line to our location; the store marks it fulfilled itself.
    move(fulfillmentOrderId, lineId, locationId) {
      return rest(`/fulfillment_orders/${fulfillmentOrderId}/move.json`, {
        method: "POST",
        body: JSON.stringify({ fulfillment_order: { new_location_id: Number(locationId), fulfillment_order_line_items: [{ id: lineId, quantity: 1 }] } })
      }, "move");
    },

    async preparedForPickup(fulfillmentOrderId) {
      const data = await call(`${base}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query:
            "mutation fulfillmentOrderLineItemsPreparedForPickup($input: FulfillmentOrderLineItemsPreparedForPickupInput!) " +
            "{ fulfillmentOrderLineItemsPreparedForPickup(input: $input) { userErrors { field message } } }",
          variables: { input: { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: `gid://shopify/FulfillmentOrder/${fulfillmentOrderId}` }] } }
        })
      }, "Shopify pick-up ready");

      const errors = data?.data?.fulfillmentOrderLineItemsPreparedForPickup?.userErrors || data?.errors || [];
      if (errors.length) throw new Error(`Shopify pick-up ready: ${JSON.stringify(errors).slice(0, 300)}`);
    }
  };
}
