import test from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY, lookupTerm } from "./glossary";
import { SALES_NAV, SALES_AI_NAV } from "./nav";
import * as enums from "./enums";

test("every Sales section name has a plain-language explanation", () => {
  for (const i of [...SALES_NAV, SALES_AI_NAV]) assert.ok(lookupTerm(i.label)?.short, `no clue for section "${i.label}"`);
});
test("every lead, account, contact, quotation and order status has an explanation", () => {
  for (const list of [enums.LEAD_STATUSES, enums.ACCOUNT_STATUSES, enums.QUOTATION_STATUSES, enums.ORDER_STATUSES, enums.PAYMENT_STATUSES, enums.PRIORITIES, enums.OPP_STATUSES]) for (const o of list) assert.ok(lookupTerm(o.value) ?? lookupTerm(o.label), `no clue for status "${o.value}"`);
});
test("research and AI terms used by AI Autofill are explained", () => {
  for (const t of ["AI Autofill", "Confidence", "Verification", "Evidence", "Hypothesis", "Apply selected", "Accept all", "Clear AI drafts", "Refresh research", "Research Company", "robots.txt", "Autonomy level", "SEO", "AEO", "Structured data", "Meta description"]) assert.ok(lookupTerm(t), `no clue for "${t}"`);
});
test("lookup tolerates formatting and pattern families", () => {
  assert.equal(lookupTerm("Lead score *")?.term, "Lead score");
  assert.equal(lookupTerm("at_risk")?.term, "At risk");
  assert.match(lookupTerm("Points: has email")!.short, /lead's score/);
  assert.match(lookupTerm("Quotation prefix")!.short, /numbered/);
  assert.equal(lookupTerm("zzz not a term"), null);
});
test("entries are non-empty, short and not duplicated within a category", () => {
  const seen = new Set<string>();
  for (const e of GLOSSARY) {
    assert.ok(e.short.length >= 8 && e.short.length <= 420, `bad length: ${e.term}`);
    const k = `${e.category}|${e.term.toLowerCase()}`; assert.ok(!seen.has(k), `duplicate: ${k}`); seen.add(k);
  }
  assert.ok(GLOSSARY.length > 400);
});
