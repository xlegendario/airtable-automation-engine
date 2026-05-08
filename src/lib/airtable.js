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

export async function listRecords(tableName, params = {}) {
  const allRecords = [];
  let offset;

  do {
    const url = new URL(
      `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`
    );

    if (params.fields) {
      for (const field of params.fields) {
        url.searchParams.append("fields[]", field);
      }
    }

    if (params.filterByFormula) {
      url.searchParams.set("filterByFormula", params.filterByFormula);
    }

    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Airtable listRecords failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    allRecords.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return allRecords;
}

export async function createRecord(tableName, fields) {
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    throw new Error(`Airtable createRecord failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function getAutomationState(name) {
  const records = await listRecords("Automation State", {
    filterByFormula: `{Name} = "${name}"`,
  });

  return records[0] || null;
}

export async function setAutomationState(name, value) {
  const existing = await getAutomationState(name);

  if (!existing) {
    throw new Error(`Automation State record not found: ${name}`);
  }

  return updateRecord("Automation State", existing.id, {
    Value: String(value),
  });
}
