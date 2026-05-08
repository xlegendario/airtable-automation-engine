const AIRTABLE_API = "https://api.airtable.com/v0";

export async function getWebhookPayloads(cursor = 1) {
  const url =
    `${AIRTABLE_API}/bases/${process.env.AIRTABLE_BASE_ID}` +
    `/webhooks/${process.env.AIRTABLE_WEBHOOK_ID}/payloads` +
    `?cursor=${cursor}&limit=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Airtable payload fetch failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function getRecord(tableName, recordId) {
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Airtable getRecord failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function updateRecord(tableName, recordId, fields) {
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}/${recordId}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    throw new Error(`Airtable updateRecord failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
