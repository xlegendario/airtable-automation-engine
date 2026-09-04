import { getSelectName, hasLinkedRecord } from "../lib/helpers.js";

const TABLE_NAME = "Member WTBs";

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
 * Prices are deliberately left alone. What the buyer pays is already worked out
 * by the offer machinery on the want-to-buy, and what we pay the seller is on
 * the unit. Neither needs a second opinion here.
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
    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Fulfillment Status": "Allocated"
    });

    console.log(`✅ Member WTB snapshot allocated for ${record.id}`);
  }
};
