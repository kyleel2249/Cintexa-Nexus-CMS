import test from "node:test";
import assert from "node:assert/strict";
import { buildEntryGuide, lineEffect, conceptsFor, deltas } from "./double-entry-guide.ts";

const cash = { accountCode: "1010", accountName: "Cash on Hand", type: "asset" as const };
const rev = { accountCode: "4010", accountName: "Website Design Revenue", type: "revenue" as const };

test("debit increases assets, credit increases revenue", () => {
  assert.equal(lineEffect({ ...cash, side: "debit", amount: 500000 }).direction, "increases");
  assert.equal(lineEffect({ ...cash, side: "credit", amount: 500000 }).direction, "decreases");
  assert.equal(lineEffect({ ...rev, side: "credit", amount: 1 }).direction, "increases");
  assert.equal(lineEffect({ ...rev, side: "debit", amount: 1 }).direction, "decreases");
});

test("contra accounts reverse the usual effect", () => {
  const acc = { accountCode: "1283", accountName: "Accumulated Depreciation — Mobile Phones", type: "asset" as const, subtype: "contra" };
  assert.equal(lineEffect({ ...acc, side: "credit", amount: 100 }).direction, "increases");
});

test("balanced entry keeps the accounting equation and shows amounts as typed", () => {
  const g = buildEntryGuide([{ ...cash, side: "debit", amount: 500000 }, { ...rev, side: "credit", amount: 500000 }]);
  assert.equal(g.balanced, true);
  assert.match(g.effects[0]!.headline, /5,000/);
  assert.match(g.equationNote, /Balanced/);
  const d = deltas([{ ...cash, side: "debit", amount: 500000 }, { ...rev, side: "credit", amount: 500000 }]);
  assert.equal(d.asset, 500000); assert.equal(d.revenue, 500000);
});

test("unbalanced entry is explained and guide follows account changes", () => {
  const g = buildEntryGuide([{ ...cash, side: "debit", amount: 1000 }, { ...rev, side: "credit", amount: 400 }]);
  assert.equal(g.balanced, false);
  assert.match(g.equationNote, /differ/);
  const g2 = buildEntryGuide([{ ...cash, side: "credit", amount: 1000 }]);
  assert.notEqual(g.headline, g2.headline);
});

test("GAAP concepts follow the accounts: revenue, depreciation, fixed assets", () => {
  const ids = (l: any[], t?: string) => conceptsFor(l, t).map((c) => c.id);
  assert.ok(ids([{ ...rev, side: "credit", amount: 1 }]).includes("revenue-recognition"));
  assert.ok(ids([{ accountCode: "1215", accountName: "Mobile Phones", type: "asset", subtype: "fixed", side: "debit", amount: 1 }]).includes("depreciation"));
  assert.ok(ids([{ ...cash, side: "debit", amount: 1 }]).includes("dual-aspect"));
});
