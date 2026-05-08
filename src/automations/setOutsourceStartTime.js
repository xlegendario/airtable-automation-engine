import { getSelectName } from "../lib/helpers.js";

export const setOutsourceStartTime = {
  name: "setOutsourceStartTime",
  tableName: "Unfulfilled Orders Log",
  eventTypes: ["changed"],
  watchFields: [
    "Fulfillment Status",
  ],

  async shouldRun(record) {
    const fulfillmentStatus = getSelectName(
      record.fields["Fulfillment Status"]
    );

    return (
      fulfillmentStatus === "Outsource" &&
      !record.fields["Outsource Start Time"]
    );
  },

  async run(record, ctx) {
    await ctx.airtable.updateRecord(
      "Unfulfilled Orders Log",
      record.id,
      {
        "Outsource Start Time": new Date().toISOString(),
      }
    );

    console.log(
      `✅ Outsource Start Time set for ${record.id}`
    );
  },
};
