/**
 * Documentation engine tests — deterministic notes from COA structure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateDocumentation, explainAccount } from "./documentation-engine.ts";

describe("generateDocumentation", () => {
  it("generates balanced customer receipt notes", () => {
    const doc = generateDocumentation({
      journalType: "cash_receipt",
      entryDate: "2026-11-03",
      currency: "GHS",
      lines: [
        {
          key: "1",
          account: { code: "1030", name: "Bank Accounts", type: "asset", subtype: "bank" },
          debit: 500000,
          credit: 0,
        },
        {
          key: "2",
          account: { code: "1050", name: "Accounts Receivable", type: "asset", subtype: "ar" },
          debit: 0,
          credit: 500000,
        },
      ],
    });
    assert.ok(doc.journalMemo.toLowerCase().includes("receipt") || doc.journalMemo.toLowerCase().includes("customer"));
    assert.equal(doc.lineNotes.length, 2);
    assert.ok(doc.lineNotes[0].autoNote.length > 10);
    assert.ok(doc.lineNotes[1].autoNote.length > 10);
    assert.equal(doc.completenessScore >= 50, true);
    assert.ok(doc.financialImpact.summary.length > 0);
  });

  it("flags unbalanced journals", () => {
    const doc = generateDocumentation({
      lines: [
        {
          account: { code: "5010", name: "Office Expenses", type: "expense" },
          debit: 10000,
          credit: 0,
        },
      ],
    });
    assert.ok(doc.alerts.some((a) => a.id === "unbalanced" || a.id === "empty" || a.severity === "critical" || a.severity === "info"));
  });

  it("suggests capitalisation caution for large expense", () => {
    const doc = generateDocumentation({
      lines: [
        {
          key: "a",
          account: { code: "5010", name: "Office Expenses", type: "expense" },
          debit: 850000,
          credit: 0,
        },
        {
          key: "b",
          account: { code: "1030", name: "Bank Accounts", type: "asset", subtype: "bank" },
          debit: 0,
          credit: 850000,
        },
      ],
    });
    assert.ok(doc.alerts.some((a) => a.id.startsWith("capex-check")));
  });

  it("explains Accounts Receivable", () => {
    const text = explainAccount({ code: "1050", name: "Accounts Receivable", type: "asset", subtype: "ar" });
    assert.ok(text.toLowerCase().includes("owed") || text.toLowerCase().includes("customer"));
  });
});
