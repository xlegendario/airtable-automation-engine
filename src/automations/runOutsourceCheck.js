const TABLE_NAME = "Unfulfilled Orders Log";
const OUTSOURCE_URL = "https://outsource-engine.onrender.com/outsource/check";

export const runOutsourceCheck = {
  name: "runOutsourceCheck",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Ready for Outsource",
    "StockX Price Check Status",
    "GOAT Price Check Status",
    "Fulfillment Status",
    "Delivery",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const fulfillmentStatus = getStatusName(f["Fulfillment Status"]);
    const readyForOutsource = Number(f["Ready for Outsource"]) === 1;
    const stockxDone = getStatusName(f["StockX Price Check Status"]) === "Done";
    const goatDone = getStatusName(f["GOAT Price Check Status"]) === "Done";
    const startedAt = f["Sourcing Checked At"];

    if (fulfillmentStatus !== "Outsource") {
      return false;
    }

    /*
      Express (17-11-2026): the customer paid for 48 hours, and StockX,
      Dewu and GOAT never make that. While Delivery says Express the order
      stays with the consignor and the sellers (Quick Deal, Snapshot), and
      no platform price is checked or bought.

      "Delivery" is watched, so the moment someone sets it to Standard -
      by hand now, by the "48h won't work" button later - this order comes
      back through here and the normal platform check runs.
    */
    if (getStatusName(f["Delivery"]) === "Express") {
      return false;
    }

    return (
      (readyForOutsource && !startedAt) ||
      (startedAt && (stockxDone || goatDone))
    );
  },

  async run(record, ctx) {
    const f = record.fields;

    const readyForOutsource = Number(f["Ready for Outsource"]) === 1;
    const startedAt = f["Sourcing Checked At"];

    if (readyForOutsource && !startedAt) {
      await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
        "Most Valid Sourcing": null,
        "GOAT Checked Price": null,
        "StockX Checked Price": null,
        "Dewu Checked Price": null,
        "GOAT Price Check Status": null,
        "StockX Price Check Status": null,
        "Sourcing Checked At": new Date().toISOString(),
      });

      console.log(`✅ Sourcing fields reset for ${record.id}`);
    }

    const res = await fetch(OUTSOURCE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: record.id,
      }),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.success) {
      throw new Error(
        `Outsource Engine failed: ${result.error || res.statusText}`
      );
    }

    console.log("✅ Outsource Engine result:", result);
  },
};

function getStatusName(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.name) return value.name;
  return null;
}
