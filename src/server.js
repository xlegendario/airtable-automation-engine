import "dotenv/config";
import express from "express";
import { automations } from "./automationRegistry.js";
import {
  getWebhookPayloads,
  getRecord,
  updateRecord,
  listRecords,
  createRecord,
  getAutomationState,
  setAutomationState,
} from "./lib/airtable.js";

const app = express();
app.use(express.json());

let cursor = null;
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

function hasRelevantAutomationForChange(tableName, eventType, changedFieldNames) {
  return automations.some((automation) => {
    if (automation.tableName !== tableName) return false;

    if (
      automation.eventTypes &&
      !automation.eventTypes.includes(eventType)
    ) {
      return false;
    }

    if (eventType === "created") return true;

    if (!automation.watchFields?.length) return true;

    return automation.watchFields.some((fieldName) =>
      changedFieldNames.includes(fieldName)
    );
  });
}

async function loadCursor() {
  const state = await getAutomationState("airtable_cursor");
  cursor = String(state?.fields?.Value || "1");

  console.log(`📍 Loaded Airtable cursor: ${cursor}`);
}

async function saveCursor(newCursor) {
  cursor = String(newCursor);

  await setAutomationState("airtable_cursor", cursor);

  console.log(`💾 Saved Airtable cursor: ${cursor}`);
}

async function processWebhookPayloads() {
  const data = await getWebhookPayloads(cursor);

  console.log("Webhook payload debug", {
    oldCursor: cursor,
    newCursor: data.cursor,
    payloadCount: data.payloads?.length || 0,
  });

  for (const payload of data.payloads || []) {
    const changedTables = payload.changedTablesById || {};

    for (const [tableId, tableChange] of Object.entries(changedTables)) {
      const tableInfo = await getTableInfoById(tableId);

      let createdRecords = {
        ...(tableChange.createdRecordsById || {}),
      };
      
      let changedRecords = {
        ...(tableChange.changedRecordsById || {}),
      };
      
      for (const viewChange of Object.values(tableChange.changedViewsById || {})) {
        Object.assign(
          createdRecords,
          viewChange.createdRecordsById || {}
        );
      
        Object.assign(
          changedRecords,
          viewChange.changedRecordsById || {}
        );
      }

      for (const recordId of Object.keys(createdRecords)) {
        await processRecord(
          recordId,
          "created",
          tableInfo?.name,
          null
        );
      }

      for (const [recordId, recordChange] of Object.entries(changedRecords)) {
        const changedFieldNames = await getChangedFieldNames(
          tableId,
          recordChange
        );

        const relevant = hasRelevantAutomationForChange(
          tableInfo?.name,
          "changed",
          changedFieldNames
        );

        if (!relevant) {
          console.log(
            `⏭️ Skipping record ${recordId}; irrelevant fields changed: ${changedFieldNames.join(", ")}`
          );
          continue;
        }

        await processRecord(
          recordId,
          "changed",
          tableInfo?.name,
          changedFieldNames
        );
      }
    }
  }

  await saveCursor(data.cursor);
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

    console.log("About to get record", {
      automation: automation.name,
      automationTableName: automation.tableName,
      changedTableName,
      recordId,
      eventType,
      changedFieldNames,
    });
    
    let record;

    try {
      record = await airtable.getRecord(automation.tableName, recordId);
    } catch (err) {
      console.error(`⚠️ Could not fetch record ${recordId} for ${automation.name}, skipping`, err.message);
      continue;
    }
    
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

const port = process.env.PORT || 3000;

app.listen(port, async () => {
  await loadCursor();
  console.log(`Automation engine listening on port ${port}`);
});
