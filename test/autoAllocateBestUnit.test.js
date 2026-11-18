import test from "node:test";
import assert from "node:assert/strict";

// The module reads KICKZ_CAVIAR_PORTAL_BASE_URL when it loads, so set it first and
// import afterwards. fetch is replaced so the label request goes nowhere.
process.env.KICKZ_CAVIAR_PORTAL_BASE_URL = "https://portal.test";

const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  return { ok: true, status: 200, text: async () => "" };
};

const { autoAllocateBestUnit, getDumpAsk } = await import(
  "../src/automations/autoAllocateBestUnit.js"
);

const NOW = new Date("2026-11-18T12:00:00Z");

test("getDumpAsk: Custom Selling Price when one is set", () => {
  const base = { "Custom Selling Price": 120 };
  assert.equal(getDumpAsk(base, NOW), 120);
  assert.equal(getDumpAsk({ ...base, "Dump Until": "2026-11-18" }, NOW), 120);
  assert.equal(getDumpAsk({ ...base, "Dump Until": "2026-12-01" }, NOW), 120);
});

test("getDumpAsk: null with no price, or past Dump Until", () => {
  assert.equal(getDumpAsk({}, NOW), null);
  assert.equal(getDumpAsk({ "Custom Selling Price": 0 }, NOW), null);
  assert.equal(
    getDumpAsk({ "Custom Selling Price": 120, "Dump Until": "2026-11-17" }, NOW),
    null
  );
});

test("dump unit is allocated to an order priced from the sale ask", async () => {
  fetchCalls.length = 0;

  const dumpUnit = {
    id: "recDUMP",
    fields: {
      Type: "Inventory",
      "VAT Type": "Margin",
      "Purchase Price": 90,
      "Ideal Selling Price": 200,
      "Minimum Selling Price": 180,
      "Custom Selling Price": 120,
    },
  };

  const updates = [];
  const ctx = {
    airtable: {
      listRecords: async () => [dumpUnit],
      updateRecord: async (table, id, fields) => {
        updates.push({ table, id, fields });
      },
    },
  };

  const order = {
    id: "recORDER",
    fields: {
      SKU: "DD1391-100",
      Size: "42",
      Client: ["recCLIENT"],
      "Target Buying Price": 120,
      "Maximum Buying Price": 130,
    },
  };

  await autoAllocateBestUnit.run(order, ctx);

  const orderUpdate = updates.find((u) => u.table === "Unfulfilled Orders Log");
  assert.ok(orderUpdate, "order was allocated");
  assert.deepEqual(orderUpdate.fields["Linked Inventory Unit"], ["recDUMP"]);
  assert.equal(orderUpdate.fields["Fulfillment Status"], "Allocated");
  assert.equal(orderUpdate.fields["Final Buying Price"], 120);

  const unitUpdate = updates.find((u) => u.table === "Inventory Units");
  assert.equal(unitUpdate.id, "recDUMP");
  assert.equal(unitUpdate.fields["Availability Status"], "Reserved");
  assert.equal(unitUpdate.fields["Selling Price"], 120);
  assert.equal(unitUpdate.fields["Selling Method"], "Plug & Play");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://portal.test/api/consignment/request-label");
  assert.deepEqual(fetchCalls[0].body, { order_record_id: "recORDER" });
});
