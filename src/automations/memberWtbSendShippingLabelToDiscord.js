const TABLE_NAME = "Member WTBs";
const WEBHOOK_URL = "https://kickz-caviar-portal.onrender.com/api/member-wtb/send-label-to-discord";

export const memberWtbSendShippingLabelToDiscord = {
  name: "memberWtbSendShippingLabelToDiscord",
  tableName: TABLE_NAME,
  eventTypes: ["changed"],

  watchFields: [
    "Shipping Label",
    "Shipping Label Permanent URL",
    "Tracking Number",
    "Label Sent To Discord?",
    "WTB Created Channel ID",
    "Seller Deal Update Channel ID"
  ],

  async shouldRun(record) {
    const f = record.fields;

    return (
      !!f["Shipping Label"] &&
      !!f["Shipping Label Permanent URL"] &&
      !!f["Tracking Number"] &&
      !f["Label Sent To Discord?"]
    );
  },

  async run(record, ctx) {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recordId: record.id
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.log("Webhook failed response:", data);
      throw new Error(data.details || data.error || "Webhook failed");
    }

    await ctx.airtable.updateRecord(TABLE_NAME, record.id, {
      "Label Sent To Discord?": true
    });

    console.log(`✅ Member WTB shipping label sent to Discord for ${record.id}`);
  }
};
