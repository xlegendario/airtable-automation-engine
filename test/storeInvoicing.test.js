import test from "node:test";
import assert from "node:assert/strict";

import {
  invoicePlan,
  salesInvoiceBody,
  journalEntryBody,
  invoiceMail,
  pickContact,
  pickFulfillmentLine,
  isPrivateOrder,
  isMarketplaceConsignment
} from "../src/lib/storeInvoicing.js";

// The five routes of the Make scenario, each with the ids it used.

test("Margin: margin VAT type, own template, cost 1537847149 at full purchase price", () => {
  const plan = invoicePlan({ vatType: "Margin", storeCountry: "Italy", clientCountry: "Italy" });
  assert.equal(plan.vatTypeId, 688369464);
  assert.equal(plan.templateId, 322464949);
  assert.equal(plan.withVatNumber, false);
  assert.equal(plan.lineAccount, false);
  assert.equal(plan.costAccountId, 1537847149);
  assert.equal(plan.costAmountField, "Final Purchase Price");
  assert.equal(plan.label, "Margin");
});

test("VAT0 to a store outside NL: reverse charge with the store's VAT number", () => {
  const plan = invoicePlan({ vatType: "VAT0", storeCountry: "Poland", clientCountry: "Poland" });
  assert.equal(plan.vatTypeId, 775036437);
  assert.equal(plan.withVatNumber, true);
  assert.equal(plan.label, "VAT0");
  assert.equal(plan.costAmountField, "Final Purchase Price");
});

test("VAT0 to a Dutch store: a VAT21 invoice", () => {
  const plan = invoicePlan({ vatType: "VAT0", storeCountry: "Netherlands", clientCountry: "Netherlands" });
  assert.equal(plan.vatTypeId, 701184043);
  assert.equal(plan.withVatNumber, false);
  assert.equal(plan.label, "VAT21");
  assert.equal(plan.costAmountField, "Final Purchase Price");
});

test("VAT21 to a Dutch client: VAT21, cost ex. VAT", () => {
  const plan = invoicePlan({ vatType: "VAT21", storeCountry: "Netherlands", clientCountry: "Netherlands" });
  assert.equal(plan.vatTypeId, 701184043);
  assert.equal(plan.label, "VAT21");
  assert.equal(plan.costAccountId, 306471935);
  assert.equal(plan.costAmountField, "Final Purchase Price (ex. VAT)");
});

test("VAT21 to a client outside NL: reverse charge, cost ex. VAT", () => {
  const plan = invoicePlan({ vatType: "VAT21", storeCountry: "Germany", clientCountry: "Germany" });
  assert.equal(plan.vatTypeId, 775036437);
  assert.equal(plan.withVatNumber, true);
  assert.equal(plan.label, "VAT0");
  assert.equal(plan.costAmountField, "Final Purchase Price (ex. VAT)");
});

test("VAT0 follows the store's country, VAT21 the order's client country - as Make read them", () => {
  assert.equal(invoicePlan({ vatType: "VAT0", storeCountry: "Netherlands", clientCountry: "Belgium" }).vatTypeId, 701184043);
  assert.equal(invoicePlan({ vatType: "VAT21", storeCountry: "Netherlands", clientCountry: "Belgium" }).vatTypeId, 775036437);
});

test("an unknown VAT type gets no invoice", () => {
  assert.equal(invoicePlan({ vatType: "", storeCountry: "Netherlands" }), null);
});

test("the invoice body matches what Make posted", () => {
  const plan = invoicePlan({ vatType: "VAT0", storeCountry: "Italy" });
  const body = salesInvoiceBody({
    plan,
    contact: { id: 42, vat_number: "IT123" },
    apiReference: "recABC",
    order: { orderId: "ORD-1", productName: "Jordan 4", size: "42", finalBuyingPrice: 190 }
  }).sales_invoice;

  assert.equal(body.contact_id, 42);
  assert.equal(body.vat_number, "IT123");
  assert.equal(body.description, "ORD-1");
  assert.equal(body.api_reference, "recABC");
  assert.equal(body.template_id, null);
  assert.deepEqual(body.invoice_lines, [{
    description: "Jordan 4",
    extended_description: "42",
    price_per_unit: "190",
    vat_rate: "",
    vat_type_id: 775036437,
    quantity: "1.0",
    account_id: 589136361,
    account_path: "profit.revenue.sneakers_custom"
  }]);

  const margin = salesInvoiceBody({ plan: invoicePlan({ vatType: "Margin" }), contact: { id: 1, vat_number: "X" }, order: {} }).sales_invoice;
  assert.equal(margin.vat_number, null);
  assert.equal(margin.template_id, 322464949);
  assert.equal(margin.invoice_lines[0].account_id, undefined);
});

test("the journal entry moves the cost out of stock", () => {
  const plan = invoicePlan({ vatType: "VAT21", clientCountry: "Netherlands" });
  const entry = journalEntryBody({ plan, invoice: { invoice_number: "2026-0412", date: "2026-09-21" }, amount: 99.17 }).journal_entry;

  assert.equal(entry.description, "Voorraadcorrectie 2026-0412");
  assert.equal(entry.date, "2026-09-21");
  assert.deepEqual(entry.lines.map((l) => [l.account_id, l.debit_amount, l.credit_amount]), [
    [306471935, "99.17", null],
    [1981496874, null, "99.17"]
  ]);
});

test("the mail has Make's subject and attachment name", () => {
  const mail = invoiceMail({ plan: { label: "VAT0" }, storeName: "Uniquekicks", shopifyOrderNumber: "#1001", to: "a@b.nl", pdfBase64: "UEQ=" });
  assert.equal(mail.personalizations[0].subject, "Your VAT0 Invoice For Order ##1001");
  assert.equal(mail.attachments[0].filename, "Purchase Invoice #1001.pdf");
  assert.equal(mail.from.email, "info@kickzcaviar.nl");
});

test("the exact store name wins over the first search result", () => {
  const contacts = [{ id: 1, company_name: "Kicks Amsterdam Outlet" }, { id: 2, company_name: "Kicks Amsterdam" }];
  assert.equal(pickContact(contacts, "Kicks Amsterdam").id, 2);
  assert.equal(pickContact(contacts, "Unknown").id, 1);
  assert.equal(pickContact([], "Anything"), null);
});

test("the Shopify line is our variant on an open fulfillment order", () => {
  const fos = [
    { id: 10, order_id: 5, status: "closed", line_items: [{ id: 100, variant_id: 7, fulfillable_quantity: 1 }] },
    { id: 11, order_id: 5, status: "open", supported_actions: ["move"], delivery_method: { method_type: "shipping" },
      line_items: [{ id: 110, variant_id: 8, fulfillable_quantity: 1 }, { id: 111, variant_id: 7, fulfillable_quantity: 0 }] },
    { id: 12, order_id: 5, status: "open", supported_actions: ["create_fulfillment"], delivery_method: { method_type: "pick-up" },
      line_items: [{ id: 120, variant_id: 7, fulfillable_quantity: 1 }] }
  ];

  const pick = pickFulfillmentLine(fos, { shopifyOrderId: "5", variantId: "7" });
  assert.equal(pick.fulfillmentOrder.id, 12);
  assert.equal(pick.line.id, 120);
  assert.equal(pick.pickup, true);

  assert.equal(pickFulfillmentLine(fos, { shopifyOrderId: 5, variantId: 8, requireAction: "create_fulfillment" }), null);
  assert.equal(pickFulfillmentLine(fos, { shopifyOrderId: 6, variantId: 7 }), null);
});

test("private orders and marketplace consignment are recognised", () => {
  assert.equal(isPrivateOrder("Private 12"), true);
  assert.equal(isPrivateOrder("#1044"), false);
  assert.equal(isMarketplaceConsignment("bol Consignment"), true);
  assert.equal(isMarketplaceConsignment("SneakerAsk Consignment"), true);
  assert.equal(isMarketplaceConsignment("Shopify"), false);
});
