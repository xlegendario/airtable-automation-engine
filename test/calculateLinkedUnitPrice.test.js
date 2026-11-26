import test from "node:test";
import assert from "node:assert/strict";

import { calculateLinkedUnitPrice } from "../src/automations/calculateLinkedUnitPrice.js";

function fakeCtx(unitFields) {
  const writes = [];

  return {
    writes,
    airtable: {
      async getRecord(table, id) {
        return { id, fields: unitFields };
      },
      async updateRecord(table, id, fields) {
        writes.push({ table, id, fields });
      }
    }
  };
}

function woovinOrder(extra = {}) {
  return {
    id: "recORDER",
    fields: {
      "Linked Inventory Unit": ["recUNIT"],
      "Fulfillment Status": "Confirmed",
      "Store Name": ["Woovin"],
      "Client Country": ["Netherlands"],
      "Offer To Store": 219,
      ...extra
    }
  };
}

const unitPrice = (ctx) =>
  ctx.writes.find((w) => w.table === "Inventory Units").fields["Selling Price"];

test("a claimed VAT0 pair on Woovin is sold without VAT, though the order has no Offer VAT Type", async () => {
  const ctx = fakeCtx({ "VAT Type": "VAT0" });

  await calculateLinkedUnitPrice.run(woovinOrder(), ctx);

  assert.equal(unitPrice(ctx), 180.99);
});

test("a margin pair keeps the price as it is", async () => {
  const ctx = fakeCtx({ "VAT Type": "Margin" });

  await calculateLinkedUnitPrice.run(woovinOrder({ "Offer VAT Type": "VAT21" }), ctx);

  assert.equal(unitPrice(ctx), 219);
});

test("an accepted VAT0 offer still comes out the same as before", async () => {
  const ctx = fakeCtx({ "VAT Type": "VAT0" });

  await calculateLinkedUnitPrice.run(
    woovinOrder({ "Offer VAT Type": "VAT21", "Offer Accepted?": true, "Offer To Store": 212 }),
    ctx
  );

  assert.equal(unitPrice(ctx), 175.21);
});

test("a unit without VAT Type falls back on Offer VAT Type", async () => {
  const ctx = fakeCtx({});

  await calculateLinkedUnitPrice.run(woovinOrder({ "Offer VAT Type": "VAT21" }), ctx);

  assert.equal(unitPrice(ctx), 180.99);
});
