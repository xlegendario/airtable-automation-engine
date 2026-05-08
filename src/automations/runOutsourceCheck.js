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
  ],

  async shouldRun(record) {
    const f = record.fields;

    const readyForOutsource = Number(f["Ready for Outsource"]) === 1;
    const fulfillmentStatus =
      typeof f["Fulfillment Status"] === "string"
        ? f["Fulfillment Status"]
        : f["Fulfillment Status"]?.name;

    const stockxDone =
      getStatusName(f["StockX Price Check Status"]) === "Done";

    const goatDone =
      getStatusName(f["GOAT Price Check Status"]) === "Done";

    return (
      readyForOutsource ||
      (
        fulfillmentStatus === "Outsource" &&
        (stockxDone || goatDone)
      )
    );
  },

  async run(record, ctx) {
    const f = record.fields;

    const readyForOutsource = Number(f["Ready for Outsource"]) === 1;

    if (readyForOutsource) {
      await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
        "Most Valid Sourcing": null,
        "GOAT Checked Price": null,
        "StockX Checked Price": null,
        "Dewu Checked Price": null,
        "GOAT Price Check Status": null,
        "StockX Price Check Status": null,
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
