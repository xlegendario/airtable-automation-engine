import "dotenv/config";
import express from "express";
import { automations } from "./automationRegistry.js";
import {
  getWebhookPayloads,
  getRecord,
  updateRecord,
  listRecords,
  createRecord,
} from "./lib/airtable.js";

const app = express();
app.use(express.json());

let cursor = Number(process.env.AIRTABLE_CURSOR || 1);
let isProcessing = false;

const airtable = {
  getRecord,
  updateRecord,
  listRecords,
  createRecord,
};

app.get("/", (req, res) => {
  res.send("Airtable automation engine running");
});

app.post("/webhook", async (req, res) => {
  console.log("📩 Airtable webhook received", new Date().toISOString());

  res.sendStatus(200);

  if (isProcessing) {
    console.log("⏳ Already processing, skipping");
    return;
  }

  isProcessing = true;

  try {
    await processWebhookPayloads();
  } catch (err) {
    console.error("❌ Webhook processing failed:", err);
  } finally {
    isProcessing = false;
  }
});

let baseSchemaCache = null;

async function getBaseSchema() {
  if (baseSchemaCache) return baseSchemaCache;

  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`,
    {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to load Airtable schema: ${res.status} ${await res.text()}`);
  }

  baseSchemaCache = await res.json();
  return baseSchemaCache;
}

async function getTableInfoById(tableId) {
  const schema = await getBaseSchema();
  return schema.tables.find((table) => table.id === tableId);
}

function extractChangedFieldIds(recordChange) {
  const ids = new Set();

  const sources = [
    recordChange?.current?.cellValuesByFieldId,
    recordChange?.previous?.cellValuesByFieldId,
    recordChange?.changedFieldsById,
    recordChange?.changedCellValuesByFieldId,
  ];

  for (const source of sources) {
    if (source && typeof source === "object") {
      for (const fieldId of Object.keys(source)) {
        ids.add(fieldId);
      }
    }
  }

  return [...ids];
}

async function getChangedFieldNames(tableId, recordChange) {
  const table = await getTableInfoById(tableId);
  if (!table) return [];

  const fieldNameById = new Map(
    table.fields.map((field) => [field.id, field.name])
  );

  return extractChangedFieldIds(recordChange)
    .map((fieldId) => fieldNameById.get(fieldId) || fieldId);
}

async function processWebhookPayloads() {
  const data = await getWebhookPayloads(cursor);

  for (const payload of data.payloads || []) {
    const changedTables = payload.changedTablesById || {};

    for (const tableChange of Object.values(changedTables)) {
      const createdRecords = tableChange.createdRecordsById || {};
      const changedRecords = tableChange.changedRecordsById || {};

      for (const recordId of Object.keys(createdRecords)) {
        const tableInfo = await getTableInfoById(tableId);
      
        await processRecord(
          recordId,
          "created",
          tableInfo?.name,
          null
        );
      }

      for (const [recordId, recordChange] of Object.entries(changedRecords)) {
        const tableInfo = await getTableInfoById(tableId);
        const changedFieldNames = await getChangedFieldNames(tableId, recordChange);
      
        await processRecord(
          recordId,
          "changed",
          tableInfo?.name,
          changedFieldNames
        );
      }
    }
  }

  cursor = data.cursor;
  console.log(`✅ Cursor updated to ${cursor}`);
}

async function processRecord(recordId, eventType, changedTableName, changedFieldNames) {
  console.log(`🔎 Processing record ${recordId} eventType=${eventType}`);

  if (changedFieldNames?.length) {
    console.log(`🧩 Changed fields: ${changedFieldNames.join(", ")}`);
  }

  for (const automation of automations) {
    if (changedTableName && automation.tableName !== changedTableName) {
      continue;
    }

    if (
      automation.eventTypes &&
      !automation.eventTypes.includes(eventType)
    ) {
      continue;
    }

    if (
      eventType === "changed" &&
      automation.watchFields?.length &&
      changedFieldNames?.length
    ) {
      const relevantChange = automation.watchFields.some((fieldName) =>
        changedFieldNames.includes(fieldName)
      );

      if (!relevantChange) {
        console.log(`⏭️ Skipping automation: ${automation.name}`);
        continue;
      }
    }

    console.log(`➡️ Checking automation: ${automation.name}`);

    const record = await airtable.getRecord(automation.tableName, recordId);
    const shouldRun = await automation.shouldRun(record);

    console.log(`   shouldRun=${shouldRun}`);

    if (shouldRun) {
      console.log(`🚀 Running automation: ${automation.name}`);

      try {
        await automation.run(record, { airtable, eventType });
      } catch (err) {
        console.error(`❌ Automation failed: ${automation.name}`, err);
      }
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
