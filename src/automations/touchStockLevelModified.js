const TABLE_NAME = "Stock Levels";

export const touchStockLevelModified = {
  name: "touchStockLevelModified",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: ["In Stock?"],

  async shouldRun(record) {
    return true;
  },

  async run(record, ctx) {
    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Trigger Modified": new Date().toISOString(),
    });

    console.log(`✅ Trigger Modified touched for stock level ${record.id}`);
  },
};
