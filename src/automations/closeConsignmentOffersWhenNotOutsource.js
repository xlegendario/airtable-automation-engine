import { getSelectName } from "../lib/helpers.js";

const KICKZ_CAVIAR_PORTAL_BASE_URL =
  process.env.KICKZ_CAVIAR_PORTAL_BASE_URL || "https://kickzcaviar.com";

const CLOSE_CONSIGNMENT_OFFERS_URL =
  `${KICKZ_CAVIAR_PORTAL_BASE_URL}/api/consignment/offers/close-for-source`;

async function postPortalWebhook(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kc-secret": process.env.AIRTABLE_WEBHOOK_SECRET || "",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Portal webhook failed: ${res.status} ${await res.text()}`);
  }
}

function shouldCloseForStatus(status) {
  return Boolean(status) && status !== "Outsource";
}

export const closeOrderConsignmentOffersWhenNotOutsource = {
  name: "closeOrderConsignmentOffersWhenNotOutsource",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["changed"],
  watchFields: ["Fulfillment Status"],

  async shouldRun(record) {
    const status = getSelectName(record.fields["Fulfillment Status"]);
    return shouldCloseForStatus(status);
  },

  async run(record) {
    await postPortalWebhook(CLOSE_CONSIGNMENT_OFFERS_URL, {
      source_type: "order",
      record_id: record.id,
    });
  },
};

export const closeMemberWtbConsignmentOffersWhenNotOutsource = {
  name: "closeMemberWtbConsignmentOffersWhenNotOutsource",
  tableName: "Member WTBs",
  eventTypes: ["changed"],
  watchFields: ["Fulfillment Status"],

  async shouldRun(record) {
    const status = getSelectName(record.fields["Fulfillment Status"]);
    return shouldCloseForStatus(status);
  },

  async run(record) {
    await postPortalWebhook(CLOSE_CONSIGNMENT_OFFERS_URL, {
      source_type: "member_wtb",
      record_id: record.id,
    });
  },
};
