const TABLE_NAME = "Unfulfilled Orders Log";

export const setOfferingStartedTimestamp = {
  name: "setOfferingStartedTimestamp",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Offering Started?",
    "Offering Started Timestamp",
  ],

  async shouldRun(record) {
    const f = record.fields;

    const started = !!f["Offering Started?"];
    const alreadySet = !!f["Offering Started Timestamp"];

    return started && !alreadySet;
  },

  async run(record, ctx) {
    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Offering Started Timestamp": new Date().toISOString(),
    });

    console.log(
      `✅ Offering Started Timestamp set for ${record.id}`
    );
  },
};
