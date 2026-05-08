import "dotenv/config";
import express from "express";
import { automations } from "./automationRegistry.js";
import { getWebhookPayloads, getRecord, updateRecord } from "./lib/airtable.js";

const app = express();
app.use(express.json());

let cursor = Number(process.env.AIRTABLE_CURSOR || 1);
let isProcessing = false;

const airtable = {
  getRecord,
  updateRecord,
};

app.get("/", (req, res) => {
  res.send("Airtable automation engine running");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  if (isProcessing) return;

  isProcessing = true;

  try {
    await processWebhookPayloads();
  } catch (err) {
    console.error("❌ Webhook processing failed:", err);
  } finally {
    isProcessing = false;
  }
});

async function processWebhookPayloads() {
  const data = await getWebhookPayloads(cursor);

  for (const payload of data.payloads || []) {
    const changedTables = payload.changedTablesById || {};

    for (const [tableId, tableChange] of Object.entries(changedTables)) {
      const createdRecords = tableChange.createdRecordsById || {};

      for (const recordId of Object.keys(createdRecords)) {
        await processCreatedRecord(recordId);
      }
    }
  }

  cursor = data.cursor;
  console.log(`✅ Cursor updated to ${cursor}`);
}

async function processCreatedRecord(recordId) {
  for (const automation of automations) {
    const record = await airtable.getRecord(automation.tableName, recordId);

    if (await automation.shouldRun(record)) {
      await automation.run(record, { airtable });
    }
  }
}

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Automation engine listening on port ${port}`);
});
