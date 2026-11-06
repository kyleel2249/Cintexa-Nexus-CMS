import test from "node:test";
import assert from "node:assert/strict";
import { moduleForPath, describeResponse } from "./announce-core.ts";

test("paths map to the owning tool; Finance, sync and public/research calls are not announced", () => {
  assert.equal(moduleForPath("/csi/objectives"), "corporate-strategy");
  assert.equal(moduleForPath("/diary/entries"), "business-diary");
  assert.equal(moduleForPath("/fi/entries"), "financial-intelligence");
  assert.equal(moduleForPath("/sales/leads"), "sales");
  assert.equal(moduleForPath("/finance/invoices"), null);
  assert.equal(moduleForPath("/sync/events"), null);
  assert.equal(moduleForPath("/sales/research/jobs"), null);
});

test("an id, title and amount are read from common response shapes", () => {
  const d = describeResponse("/sales/leads", "POST", { lead: { id: 7, name: "Acme", updatedAt: "t1" } });
  assert.equal(d.entityType, "lead"); assert.equal(d.entityId, 7); assert.equal(d.title, "Acme"); assert.equal(d.stamp, "t1");
  const o = describeResponse("/sales/orders", "POST", { id: "SO-1", title: "Order", amountMinor: 5000 });
  assert.equal(o.amountMinor, 5000); assert.equal(o.entityType, "order");
  assert.ok(describeResponse("/csi/x", "PUT", null).entityId);
});
