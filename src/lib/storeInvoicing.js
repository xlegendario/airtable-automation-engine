/*
 * Fulfilment and invoicing of a store order, the parts that are decisions.
 *
 * Taken over one to one from the Make scenarios "Phase 7: Send Fulfillment +
 * Create Invoice & Journal" (the main one, "Without Fulfillment" and
 * "Madonnina"), which Dario has run this way for a year. The VAT rules and the
 * journal entries are deliberately NOT improved on: they are his bookkeeping,
 * and they are right.
 *
 * Kept free of any API call so every rule can be tested on its own.
 */

// Rompslomp ids, as in the Make scenarios.
export const ROMPSLOMP = {
  companyId: "1296508534",
  revenueAccountId: 589136361,
  revenueAccountPath: "profit.revenue.sneakers_custom",
  stockAccountId: 1981496874,
  stockAccountPath: "activa.current_assets.voorraad_scout_custom",
  // Kosten • Sneakers & Streetwear | Commercieel (VAT stock) and | Marge.
  costAccountPath: "profit.costs.sneakers_custom",
  marginCostAccountPath: "profit.costs.sneakers_marge_custom",
  marginTemplateId: 322464949
};

/*
 * Which invoice an order gets.
 *
 * `vatType` is the order's "VAT Type": the purchase VAT type of the unit, as
 * a lookup. The country decides between a Dutch invoice and a reverse-charge
 * ("verlegd") one. Five routes in Make, the same five here:
 *
 *   Margin                     margin invoice, own template
 *   VAT0,  store not NL        VAT0 (verlegd), the store's VAT number on it
 *   VAT0,  store in NL         VAT21
 *   VAT21, client in NL        VAT21
 *   VAT21, client not NL       VAT0 (verlegd)
 *
 * Make read the store's country for VAT0 (Merchants "Country") and the order's
 * "Client Country" lookup for VAT21. Both are passed in and used exactly so.
 *
 * The journal entry ("Voorraadcorrectie") moves the purchase price from stock
 * to cost: the Margin route books on cost account 1537847149 with the unit's
 * Final Purchase Price, the others on 306471935 - the VAT21 routes with the
 * price ex. VAT, the VAT0 routes with Final Purchase Price.
 */
export function invoicePlan({ vatType, storeCountry, clientCountry }) {
  const vat = String(vatType || "").trim();
  const storeIsNl = String(storeCountry || "").trim() === "Netherlands";
  const clientIsNl = String(clientCountry || "").trim() === "Netherlands";

  const dutch = { vatTypeId: 701184043, label: "VAT21", withVatNumber: false };
  const reverse = { vatTypeId: 775036437, label: "VAT0", withVatNumber: true };

  if (vat === "Margin") {
    return {
      route: "Margin",
      label: "Margin",
      vatTypeId: 688369464,
      templateId: ROMPSLOMP.marginTemplateId,
      withVatNumber: false,
      lineAccount: false,
      costAccountId: 1537847149,
      costAccountPath: ROMPSLOMP.marginCostAccountPath,
      costAmountField: "Final Purchase Price"
    };
  }

  if (vat === "VAT0") {
    const base = storeIsNl ? dutch : reverse;
    return {
      route: storeIsNl ? "VAT0, store in NL" : "VAT0, store not NL",
      ...base,
      templateId: null,
      lineAccount: true,
      costAccountId: 306471935,
      costAmountField: "Final Purchase Price"
    };
  }

  if (vat === "VAT21") {
    const base = clientIsNl ? dutch : reverse;
    return {
      route: clientIsNl ? "VAT21, client in NL" : "VAT21, client not NL",
      ...base,
      templateId: null,
      lineAccount: true,
      costAccountId: 306471935,
      costAmountField: "Final Purchase Price (ex. VAT)"
    };
  }

  return null;
}

// Invoices are due in 7 days, always (Dario, 22-09-2026) - sent with the
// invoice so it never depends on Rompslomp's company setting, and dated in
// Dutch time so one made just after midnight is not a day off.
export const PAYMENT_DAYS = 7;

export function invoiceDates(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(now);
  const due = new Date(`${today}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + PAYMENT_DAYS);
  return { date: today, due_date: due.toISOString().slice(0, 10) };
}

// The sales invoice body Make posted, for one order - plus the 7-day term.
export function salesInvoiceBody({ plan, order, contact, apiReference = null, now = new Date() }) {
  const line = {
    description: String(order.productName || ""),
    extended_description: String(order.size || ""),
    price_per_unit: String(order.finalBuyingPrice),
    vat_rate: "",
    vat_type_id: plan.vatTypeId,
    quantity: "1.0"
  };

  if (plan.lineAccount) {
    line.account_id = ROMPSLOMP.revenueAccountId;
    line.account_path = ROMPSLOMP.revenueAccountPath;
  }

  return {
    sales_invoice: {
      ...invoiceDates(now),
      payment_method: "pay_transfer",
      description: String(order.orderId || ""),
      contact_id: contact.id,
      currency: "eur",
      currency_exchange_rate: "1.0",
      template_id: plan.templateId,
      vat_number: plan.withVatNumber ? contact.vat_number || null : null,
      // The order's record id: unique per company in Rompslomp, so a second
      // attempt at the same order is refused rather than invoiced twice.
      api_reference: apiReference,
      payment_reference: null,
      sale_type: "supply",
      distance_sale: false,
      invoice_lines: [line]
    }
  };
}

export function journalEntryBody({ plan, invoice, amount }) {
  return {
    journal_entry: {
      description: `Voorraadcorrectie ${invoice.invoice_number}`,
      date: invoice.date,
      lines: [
        {
          // The id decides in Rompslomp; the path is sent to match it. Make
          // sent the Commercieel path with the Marge id - harmless, but wrong.
          account_id: plan.costAccountId,
          account_path: plan.costAccountPath || ROMPSLOMP.costAccountPath,
          debit_amount: String(amount),
          credit_amount: null
        },
        {
          account_id: ROMPSLOMP.stockAccountId,
          account_path: ROMPSLOMP.stockAccountPath,
          debit_amount: null,
          credit_amount: String(amount)
        }
      ]
    }
  };
}

export function invoiceMail({ plan, storeName, shopifyOrderNumber, to, pdfBase64 }) {
  return {
    personalizations: [{ to: [{ email: to }], subject: `Your ${plan.label} Invoice For Order #${shopifyOrderNumber}` }],
    from: { email: "info@kickzcaviar.nl", name: "Kickz Caviar" },
    content: [
      {
        type: "text/plain",
        value:
          `Dear ${storeName},\n\nPlease find your invoice attached for your reference.\n` +
          "If you have any questions, feel free to contact us.\n\nThank you for your business.\n\nKind regards,\nKickz Caviar"
      }
    ],
    attachments: [
      {
        content: pdfBase64,
        type: "application/pdf",
        filename: `Purchase Invoice ${shopifyOrderNumber}.pdf`,
        disposition: "attachment"
      }
    ]
  };
}

/*
 * The store's contact among Rompslomp's search results.
 *
 * Make took whatever came first for a search on the store name, so a store
 * whose name is part of another's could be invoiced as the other. An exact
 * name wins here; only when there is none does the first result stand, as
 * before. The id is then stored on the merchant and never searched again.
 */
export function pickContact(contacts, storeName) {
  const list = Array.isArray(contacts) ? contacts : [];
  const wanted = String(storeName || "").trim().toLowerCase();
  const name = (c) => String(c?.company_name || c?.name || "").trim().toLowerCase();

  return list.find((c) => name(c) === wanted) || list[0] || null;
}

/*
 * The line on the store's Shopify order that is this pair.
 *
 * Same test as Make's "Filter Items": the fulfillment order belongs to the
 * order, is not closed or cancelled, and the line is our variant with
 * something left to fulfil. Make acted on every match; this takes the first,
 * because one record is one pair and a second match is another record's.
 */
export function pickFulfillmentLine(fulfillmentOrders, { shopifyOrderId, variantId, requireAction = "" }) {
  for (const fo of fulfillmentOrders || []) {
    if (String(fo.order_id) !== String(shopifyOrderId)) continue;
    if (["closed", "cancelled"].includes(String(fo.status))) continue;
    if (requireAction && !(fo.supported_actions || []).includes(requireAction)) continue;

    for (const line of fo.line_items || []) {
      if (String(line.variant_id) === String(variantId) && Number(line.fulfillable_quantity) > 0) {
        return { fulfillmentOrder: fo, line, pickup: fo?.delivery_method?.method_type === "pick-up" };
      }
    }
  }

  return null;
}

// Private orders have no Shopify order; Make skipped the Shopify steps for them.
export const isPrivateOrder = (shopifyOrderNumber) => String(shopifyOrderNumber || "").includes("Private");

// Marketplace consignment sales are invoiced elsewhere (Make excluded them).
export const isMarketplaceConsignment = (orderSource) => /Consignment$/.test(String(orderSource || ""));
