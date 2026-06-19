const TABLE_NAME = "Unfulfilled Orders Log";
const WEBHOOK_URL = "https://lojiq-wms.onrender.com/send-label-to-channel";

export const sendShippingLabelToDiscord = {
  name: "sendShippingLabelToDiscord",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Shipping Label",
    "Label Sent To Discord?",
    "Claimed Channel ID",
    "WTB Created Channel ID",
  ],

  async shouldRun(record) {
    const f = record.fields;
  
    const hasShippingLabel = !!f["Shipping Label"];
    const alreadySent = !!f["Label Sent To Discord?"];
  
    return hasShippingLabel && !alreadySent;
  },

  async run(record, ctx) {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recordId: record.id,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.log("Webhook failed response:", data);
      throw new Error(data.details || data.error || "Webhook failed");
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Label Sent To Discord?": true,
    });

    console.log(`✅ Shipping label sent to Discord for ${record.id}`);
  },
};
