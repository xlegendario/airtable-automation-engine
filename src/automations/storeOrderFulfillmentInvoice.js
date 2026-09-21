/*
 * Phase 7 for store orders: the store's Shopify, the invoice and the journal.
 *
 * Replaces the three Make scenarios "Phase 7: Send Fulfillment + Create
 * Invoice & Journal" (main, "Without Fulfillment", "Madonnina"). What differed
 * between them is now a setting per store in Merchants:
 *
 *   Invoice Automation         Make (or empty): this does nothing - Make still
 *                              runs the store. Engine (test): every lookup is
 *                              done and what would happen is logged, nothing
 *                              is written. Engine: this runs the store.
 *   Shopify Fulfillment Mode   None / Move to our location / Fulfill /
 *                              Fulfill, pick-up moved to us (Madonnina).
 *   Invoice Mode               Send invoice / Self-billing (APLUG invoices
 *                              itself; nothing is sent, the order waits for a
 *                              collective invoice) / No invoice.
 *   Rompslomp Contact ID       filled in the first time.
 *
 * Two things Make did not do, and why:
 *
 *   - Every step is written to the order as soon as it is done (Fulfillment
 *     Sent?, Rompslomp Invoice ID, Invoice Number, Journal Entry ID, Invoice
 *     Sent At), and a step already on the order is skipped. Make ticked
 *     Fulfillment Sent? before the invoice existed, so a failed invoice was
 *     never tried again - and nothing recorded which invoice belonged to an
 *     order, which is what a Cancel button needs.
 *   - A step that fails stops the ones after it and says why in Invoice
 *     Error. Tick Retry Invoice to run it again from where it stopped.
 */
import { getFirstValue, getLinkedId, getNumber, getSelectName } from "../lib/helpers.js";
import {
  invoicePlan,
  salesInvoiceBody,
  journalEntryBody,
  invoiceMail,
  pickContact,
  pickFulfillmentLine,
  isPrivateOrder,
  isMarketplaceConsignment
} from "../lib/storeInvoicing.js";
import { rompslompApi, sendMail, shopifyApi } from "../lib/invoiceServices.js";

const TABLE_NAME = "Unfulfilled Orders Log";

// The statuses Make's trigger watched: from the moment we have the pair.
const STATUSES = ["Allocated", "Awaiting Label", "Requested Label", "Ready to Ship", "Fulfilled", "Change Supplier"];

async function shopifyStep({ f, merchant, mode, live, log }) {
  const shop = shopifyApi(merchant);
  const orderId = f["Shopify Order ID"];
  const variantId = f["Shopify Variant ID"];
  const location = merchant.locationId;

  if (!orderId || !variantId) throw new Error("the order has no Shopify Order ID or Shopify Variant ID");
  if (!location) throw new Error(`${merchant.storeName} has no Shopify Location ID`);

  const fulfillmentOrders = await shop.fulfillmentOrders(orderId);
  const pick = pickFulfillmentLine(fulfillmentOrders, {
    shopifyOrderId: orderId,
    variantId,
    requireAction: mode === "Move to our location" ? "create_fulfillment" : ""
  });

  // Already fulfilled by the store, or closed: there is nothing left to do.
  if (!pick) {
    log("Shopify: nothing open for this variant - already done by the store");
    return;
  }

  const foId = pick.fulfillmentOrder.id;
  const lineId = pick.line.id;
  const moveHere = mode === "Move to our location" || (mode === "Fulfill, pick-up moved to us" && pick.pickup);

  if (moveHere) {
    // Moved on an earlier attempt: Shopify refuses a move to where it is.
    if (String(pick.fulfillmentOrder.assigned_location_id) === String(location)) {
      log("Shopify: already at our location");
      return;
    }

    // The move is refused when our location has none of the item; Make set
    // it to 1 first. Untracked stock has no level and needs nothing.
    const available = await shop.availableAt(pick.line.inventory_item_id, location);

    if (available !== null && available <= 0) {
      log(`Shopify: set stock at our location to 1 (was ${available})`);
      if (live) await shop.setAvailable(pick.line.inventory_item_id, location, 1);
    }

    log(`Shopify: move line ${lineId} of fulfillment order ${foId} to our location`);
    if (live) await shop.move(foId, lineId, location);

    if (pick.pickup) {
      log("Shopify: mark ready for pick-up");
      if (live) await shop.preparedForPickup(foId);
    }

    return;
  }

  log(`Shopify: fulfil line ${lineId} of fulfillment order ${foId} from our location`);
  if (live) await shop.fulfill(foId, lineId, location);
}

async function invoiceStep({ record, f, merchant, live, log, save, airtable }) {
  const plan = invoicePlan({
    vatType: getFirstValue(f["VAT Type"]),
    storeCountry: merchant.country,
    clientCountry: getFirstValue(f["Client Country"])
  });

  if (!plan) throw new Error(`no invoice route for VAT Type "${getFirstValue(f["VAT Type"])}"`);

  const price = getNumber(f["Final Buying Price"]);
  if (!(price > 0)) throw new Error("the order has no Final Buying Price");

  const unitId = getLinkedId(f["Linked Inventory Unit"]);
  const unit = await airtable.getRecord("Inventory Units", unitId);
  const rawCost = getNumber(unit.fields[plan.costAmountField]);
  if (!Number.isFinite(rawCost)) throw new Error(`the unit has no ${plan.costAmountField}`);

  // The ex. VAT field is a formula (128.099173...); booked in cents.
  const cost = Math.round(rawCost * 100) / 100;

  if (!merchant.invoiceEmail) throw new Error(`${merchant.storeName} has no Invoice Email`);

  let contact = merchant.contactId ? await rompslompApi.getContact(merchant.contactId) : null;

  if (!contact) {
    contact = pickContact(await rompslompApi.searchCustomers(merchant.storeName), merchant.storeName);
    if (!contact) throw new Error(`no Rompslomp customer found for "${merchant.storeName}"`);

    log(`Rompslomp: contact ${contact.id} (${contact.company_name || contact.name})`);
    if (live) await airtable.updateRecord("Merchants", merchant.id, { "Rompslomp Contact ID": String(contact.id) });
  }

  log(`Invoice: ${plan.route}, € ${price}, cost € ${cost} on ${plan.costAccountId}, to ${merchant.invoiceEmail}`);

  if (!live) return;

  let invoiceId = f["Rompslomp Invoice ID"];

  if (!invoiceId) {
    // Made on an earlier attempt whose id never reached Airtable.
    const existing = await rompslompApi.findInvoiceByReference(record.id);

    const created = existing || await rompslompApi.createInvoice(salesInvoiceBody({
      plan,
      contact,
      apiReference: record.id,
      order: { orderId: f["Order ID"], productName: f["Product Name"], size: f["Size"], finalBuyingPrice: price }
    }));

    invoiceId = String(created.id);
    await save({ "Rompslomp Invoice ID": invoiceId, ...(existing?.invoice_number ? { "Rompslomp Invoice Number": String(existing.invoice_number) } : {}) });
  }

  let invoice = null;

  if (!f["Rompslomp Invoice Number"]) {
    invoice = await rompslompApi.publishInvoice(invoiceId);
    await save({ "Rompslomp Invoice Number": String(invoice.invoice_number) });
  }

  if (!f["Rompslomp Journal Entry ID"]) {
    invoice = invoice || (await rompslompApi.getInvoice(invoiceId));
    const entry = await rompslompApi.createJournalEntry(journalEntryBody({ plan, invoice, amount: cost }));
    await save({ "Rompslomp Journal Entry ID": String(entry.id) });
  }

  if (!f["Invoice Sent At"]) {
    const pdf = await rompslompApi.invoicePdfBase64(invoiceId);

    await sendMail(invoiceMail({
      plan,
      storeName: merchant.storeName,
      shopifyOrderNumber: f["Shopify Order Number"],
      to: merchant.invoiceEmail,
      pdfBase64: pdf
    }));

    await save({ "Invoice Sent At": new Date().toISOString() });
  }
}

export const storeOrderFulfillmentInvoice = {
  name: "storeOrderFulfillmentInvoice",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],
  watchFields: ["Fulfillment Status", "Linked Inventory Unit", "Retry Invoice"],

  async shouldRun(record) {
    const f = record.fields;

    if (!STATUSES.includes(getSelectName(f["Fulfillment Status"]))) return false;
    if (!getLinkedId(f["Client"]) || !getLinkedId(f["Linked Inventory Unit"])) return false;

    // Done: Shopify handled and the invoice mailed. Self-billing and
    // no-invoice stores never get Invoice Sent At, so the merchant decides
    // in run() - a cheap read, and only on the statuses above.
    return !(f["Fulfillment Sent?"] && f["Invoice Sent At"]);
  },

  async run(record, ctx) {
    const f = record.fields;
    const orderLabel = f["Order ID"] || record.id;

    const m = (await ctx.airtable.getRecord("Merchants", getLinkedId(f["Client"]))).fields || {};
    const automation = getSelectName(m["Invoice Automation"]) || "Make";

    if (automation === "Make") return;

    const live = automation === "Engine";
    const log = (message) => console.log(`🧾 ${orderLabel}${live ? "" : " [test]"}: ${message}`);

    const merchant = {
      id: getLinkedId(f["Client"]),
      storeName: String(m["Store Name"] || "").trim(),
      country: getSelectName(m["Country"]) || "",
      invoiceEmail: String(m["Invoice Email"] || "").trim(),
      contactId: String(m["Rompslomp Contact ID"] || "").trim(),
      shopifyUrl: m["Shopify Store URL"],
      shopifyToken: m["Shopify Token"],
      locationId: String(m["Shopify Location ID"] || "").trim()
    };

    const fulfillmentMode = getSelectName(m["Shopify Fulfillment Mode"]) || "None";
    const invoiceMode = getSelectName(m["Invoice Mode"]) || "No invoice";
    const consignment = isMarketplaceConsignment(getSelectName(f["Order Source"]));

    /*
      Invoiced by Make before this store moved over.

      Make ticked Fulfillment Sent? and kept nothing else, so such an order
      reaches this with the box ticked and no invoice of ours on it - and would
      be invoiced a second time on its next status change. This run ticks the
      box itself only on the way to its own invoice, and a failure of ours
      always leaves Invoice Error behind, so the combination below is Make's.
      Retry Invoice overrides it, for the rare case it is not.
    */
    const handledByMake =
      Boolean(f["Fulfillment Sent?"]) &&
      !f["Rompslomp Invoice ID"] &&
      !f["Invoice Error"] &&
      !f["Retry Invoice"];

    const save = async (fields) => {
      if (!live) return;
      await ctx.airtable.updateRecord(TABLE_NAME, record.id, fields);
      Object.assign(f, fields);
    };

    try {
      if (!f["Fulfillment Sent?"] && !consignment) {
        if (isPrivateOrder(f["Shopify Order Number"])) {
          log("Shopify: private order, no Shopify step");
          await save({ "Fulfillment Sent?": true });
        } else if (fulfillmentMode !== "None") {
          await shopifyStep({ f, merchant, mode: fulfillmentMode, live, log });
          await save({ "Fulfillment Sent?": true });
        }
      }

      if (consignment || invoiceMode === "No invoice") {
        log(`Invoice: none (${consignment ? "marketplace consignment" : "No invoice"})`);
      } else if (invoiceMode === "Self-billing") {
        log("Invoice: none - self-billing store, waits for the collective invoice");
      } else if (handledByMake) {
        log("Invoice: none - already invoiced by Make");
      } else if (!f["Invoice Sent At"]) {
        await invoiceStep({ record, f, merchant, live, log, save, airtable: ctx.airtable });
      }

      if (f["Invoice Error"] || f["Retry Invoice"]) {
        await save({ "Invoice Error": "", ...(f["Retry Invoice"] ? { "Retry Invoice": false } : {}) });
      }
    } catch (err) {
      console.error(`❌ ${orderLabel}${live ? "" : " [test]"}: ${err.message}`);
      // Retry Invoice is only unticked when it was ticked: writing it is a
      // change the engine watches, and would run this again straight away.
      await save({
        "Invoice Error": `${new Date().toISOString().slice(0, 16)} ${err.message}`,
        ...(f["Retry Invoice"] ? { "Retry Invoice": false } : {})
      });
    }
  }
};
