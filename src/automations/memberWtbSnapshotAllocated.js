import { getSelectName, hasLinkedRecord } from "../lib/helpers.js";

const TABLE_NAME = "Member WTBs";

const KICKZ_CAVIAR_PORTAL_BASE_URL =
  process.env.KICKZ_CAVIAR_PORTAL_BASE_URL || "https://kickzcaviar.com";

/*
 * Move a claimed snapshot on to Allocated once the seller has confirmed it.
 *
 * An order has this done for it by calculateLinkedUnitPrice, which works out
 * what the store pays and moves the record on in the same breath. A want-to-buy
 * has no such step, because until snapshots there was no way for an outside
 * seller to supply one - it came out of our own stock, or from a consignor, and
 * both of those routes set the status themselves in the portal.
 *
 * So a claimed snapshot sat at Claim Processing forever: the unit existed, the
 * seller had confirmed, and nothing was watching. The deal was invisible in the
 * dashboard and the label could not be requested, because that flow starts from
 * Allocated.
 *
 * No price is written here. Max Price was tried and was wrong: it is the
 * ceiling the buyer set, not the number he agreed to, and on a want-to-buy
 * that went through an offer round the two are far apart. The price the buyer
 * owes is known at the moment the snapshot is created, not at the moment it is
 * claimed, so it belongs on the record from that side.
 */
export const memberWtbSnapshotAllocated = {
  name: "memberWtbSnapshotAllocated",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],
  watchFields: [
    "Fulfillment Status",
    "Snapshot Status",
    "Claimed Seller Confirmed?",
    "Linked Inventory Unit"
  ],

  async shouldRun(record) {
    const f = record.fields;

    /*
     * All four have to hold, and each rules out a different way of getting
     * this wrong: a want-to-buy filled from stock (no claimed snapshot), a
     * seller who has claimed but not yet pressed Process Deal, a deal already
     * moved on by hand, and a confirmation whose unit has not landed yet
     * because the scenario that creates it is still running.
     */
    return (
      getSelectName(f["Fulfillment Status"]) === "Claim Processing" &&
      getSelectName(f["Snapshot Status"]) === "Claimed" &&
      f["Claimed Seller Confirmed?"] === true &&
      hasLinkedRecord(f["Linked Inventory Unit"])
    );
  },

  async run(record, ctx) {
    const f = record.fields;

    const updates = {
      "Fulfillment Status": "Allocated",
      /*
       * Confirmed as well, and not only for tidiness. The buying tabs read
       * this, the invoice price is worked out from it, and the payment link
       * the buyer needs hangs off the same step. Allocated on its own left
       * the deal done but unpayable.
       */
      "Purchase Status": "Confirmed"
    };

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, updates);

    /*
     * And ask the portal for the payment link.
     *
     * The routes that fill a want-to-buy from stock run this themselves the
     * moment they confirm the purchase, but a snapshot is struck in Discord
     * and its unit is created by a scenario, so it never passes through any
     * of them. Without this the deal reads as done and the buyer has nothing
     * to pay against.
     */
    const res = await fetch(
      `${KICKZ_CAVIAR_PORTAL_BASE_URL.replace(/\/$/, "")}/api/internal/member-wtb-payment-gate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_wtb_record_id: record.id })
      }
    );

    if (!res.ok) {
      throw new Error(
        `Member WTB payment gate failed: ${res.status} ${await res.text()}`
      );
    }

    console.log(`✅ Member WTB snapshot allocated for ${record.id}`);
  }
};
