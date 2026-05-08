import "dotenv/config";
import express from "express";
import { automations } from "./automationRegistry.js";
import { getWebhookPayloads, getRecord, updateRecord, listRecords } from "./lib/airtable.js";

const app = express();
app.use(express.json());

let cursor = Number(process.env.AIRTABLE_CURSOR || 1);
let isProcessing = false;

const airtable = {
  getRecord,
  updateRecord,
  listRecords,
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

    for (const tableChange of Object.values(changedTables)) {
      const createdRecords = tableChange.createdRecordsById || {};
      const changedRecords = tableChange.changedRecordsById || {};

      for (const recordId of Object.keys(createdRecords)) {
        await processRecord(recordId, "created");
      }

      for (const recordId of Object.keys(changedRecords)) {
        await processRecord(recordId, "changed");
      }
    }
  }

  cursor = data.cursor;
  console.log(`✅ Cursor updated to ${cursor}`);
}

async function processRecord(recordId, eventType) {
  for (const automation of automations) {
    if (
      automation.eventTypes &&
      !automation.eventTypes.includes(eventType)
    ) {
      continue;
    }

    const record = await airtable.getRecord(automation.tableName, recordId);

    if (await automation.shouldRun(record)) {
      await automation.run(record, { airtable, eventType });
    }
  }
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
