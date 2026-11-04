import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CHART,
  SYSTEM_ROLES,
  buildReversalDraft,
  draftFingerprint,
  fiscalYearPeriods,
  formatRate,
  journalHash,
  normalizeDraft,
  normalizeLines,
  periodForDate,
  validateChart,
  validateJournalDraft,
  GENESIS_HASH,
  type AccountInfo,
  type JournalDraft,
  type JournalValidationContext,
} from "./index";

const accounts = new Map<string, AccountInfo>([
  ["1020", { code: "1020", postable: true, active: true, currency: null }],
  ["3010", { code: "3010", postable: true, active: true, currency: null }],
  ["1000", { code: "1000", postable: false, active: true, currency: null }],
  ["1030", { code: "1030", postable: true, active: true, currency: "USD" }],
  ["9999", { code: "9999", postable: true, active: false, currency: null }],
]);
const ctx: JournalValidationContext = { functionalCurrency: "GHS", accounts, period: { id: "p1", status: "open", start: "2026-11-01", end: "2026-11-30" } };

function draft(over: Partial<JournalDraft> = {}): JournalDraft {
  return {
    entryDate: "2026-11-04",
    sourceType: "manual",
    sourceId: "M-1",
    description: "Capital introduced",
    currency: "GHS",
    lines: [
      { accountCode: "1020", debitMinor: 100_00n },
      { accountCode: "3010", creditMinor: 100_00n },
    ],
    ...over,
  };
}

function codes(d: JournalDraft, c: JournalValidationContext = ctx): string[] {
  return validateJournalDraft(normalizeDraft(d), c).issues.map((i) => i.code);
}

test("default chart is structurally valid and carries the roles later steps rely on", () => {
  assert.deepEqual(validateChart(DEFAULT_CHART), []);
  for (const role of ["accounts_receivable", "accounts_payable", "inventory", "cogs", "retained_earnings", "income_summary", "accum_dep_computer_equipment", "depreciation_expense_computer_equipment", "fx_gain_unrealised", "fx_loss_unrealised", "net_salaries_payable", "paye_payable", "pension_payable", "deferred_revenue"]) {
    assert.ok(SYSTEM_ROLES.includes(role), `missing role ${role}`);
  }
});

test("contra accounts carry the opposite normal balance", () => {
  const by = (role: string) => DEFAULT_CHART.find((a) => a.systemRole === role);
  assert.equal(by("accum_dep_computer_equipment")?.normalBalance, "credit");
  assert.equal(by("owner_drawings")?.normalBalance, "debit");
  assert.equal(by("sales_returns")?.normalBalance, "debit");
  assert.equal(by("accounts_receivable")?.normalBalance, "debit");
  assert.equal(by("owner_capital")?.normalBalance, "credit");
});

test("validateChart catches duplicate codes, missing parents and postable parents", () => {
  const bad = validateChart([
    { code: "1000", name: "A", type: "asset", subtype: "x", normalBalance: "debit", postable: true },
    { code: "1000", name: "B", type: "asset", subtype: "x", normalBalance: "debit", postable: true, parentCode: "1000" },
    { code: "1100", name: "C", type: "asset", subtype: "x", normalBalance: "debit", postable: true, parentCode: "7777" },
  ]);
  assert.ok(bad.some((p) => p.includes("duplicate code")));
  assert.ok(bad.some((p) => p.includes("must be defined before")));
  assert.ok(bad.some((p) => p.includes("parents must be headers")));
});

test("fiscal year periods: 12 contiguous months, leap February, offset fiscal year", () => {
  const p = fiscalYearPeriods(2026);
  assert.equal(p.length, 12);
  assert.equal(p[0]?.start, "2026-01-01");
  assert.equal(p[1]?.end, "2026-02-28");
  assert.equal(p[11]?.end, "2026-12-31");
  assert.equal(fiscalYearPeriods(2028)[1]?.end, "2028-02-29");
  const july = fiscalYearPeriods(2026, 7);
  assert.equal(july[0]?.start, "2026-07-01");
  assert.equal(july[11]?.end, "2027-06-30");
  for (let i = 1; i < p.length; i++) {
    const prev = new Date(`${p[i - 1]?.end}T00:00:00Z`).getTime();
    const cur = new Date(`${p[i]?.start}T00:00:00Z`).getTime();
    assert.equal(cur - prev, 86_400_000, "periods must be contiguous");
  }
  assert.equal(periodForDate(p, "2026-03-15")?.periodNo, 3);
  assert.equal(periodForDate(p, "2027-01-01"), undefined);
  assert.throws(() => fiscalYearPeriods(2026, 13), RangeError);
});

test("a balanced journal validates", () => {
  const r = validateJournalDraft(normalizeDraft(draft()), ctx);
  assert.equal(r.ok, true);
  assert.equal(r.totalDebitMinor, 10_000n);
});

test("unbalanced, one-sided, zero and malformed journals are rejected", () => {
  assert.ok(codes(draft({ lines: [{ accountCode: "1020", debitMinor: 100n }, { accountCode: "3010", creditMinor: 99n }] })).includes("UNBALANCED"));
  assert.ok(codes(draft({ lines: [{ accountCode: "1020", debitMinor: 100n, creditMinor: 100n }, { accountCode: "3010", creditMinor: 0n }] })).includes("LINE_SIDE"));
  assert.ok(codes(draft({ lines: [{ accountCode: "1020", debitMinor: 0n }, { accountCode: "3010", creditMinor: 0n }] })).includes("LINE_SIDE"));
  assert.ok(codes(draft({ lines: [{ accountCode: "1020", debitMinor: 100n }] })).includes("TOO_FEW_LINES"));
  assert.ok(codes(draft({ lines: [{ accountCode: "1020", debitMinor: -5n }, { accountCode: "3010", creditMinor: 5n }] })).includes("NEGATIVE_AMOUNT"));
  assert.ok(codes(draft({ sourceType: " ", sourceId: "" })).includes("MISSING_SOURCE"));
  assert.ok(codes(draft({ description: "  " })).includes("MISSING_DESCRIPTION"));
  assert.ok(codes(draft({ entryDate: "2026-02-30" })).includes("INVALID_DATE"));
});

test("account rules: unknown, inactive and header accounts cannot be posted to", () => {
  const lines = (code: string) => [{ accountCode: code, debitMinor: 100n }, { accountCode: "3010", creditMinor: 100n }];
  assert.ok(codes(draft({ lines: lines("0000") })).includes("UNKNOWN_ACCOUNT"));
  assert.ok(codes(draft({ lines: lines("9999") })).includes("INACTIVE_ACCOUNT"));
  assert.ok(codes(draft({ lines: lines("1000") })).includes("NON_POSTABLE_ACCOUNT"));
});

test("period rules: closed, missing and mis-dated", () => {
  assert.ok(codes(draft(), { ...ctx, period: { id: "p", status: "closed", start: "2026-11-01", end: "2026-11-30" } }).includes("PERIOD_CLOSED"));
  assert.ok(codes(draft(), { ...ctx, period: { id: "p", status: "locked", start: "2026-11-01", end: "2026-11-30" } }).includes("PERIOD_CLOSED"));
  assert.ok(codes(draft(), { ...ctx, period: null }).includes("NO_PERIOD"));
  assert.ok(codes(draft({ entryDate: "2026-12-01" })).includes("DATE_OUTSIDE_PERIOD"));
});

test("journals stay in the functional currency", () => {
  assert.ok(codes(draft({ currency: "USD" })).includes("CURRENCY_MISMATCH"));
});

test("foreign detail: rate must reproduce the functional amount; currency-bound accounts need it", () => {
  const ok = draft({ lines: [{ accountCode: "1030", debitMinor: 15_500n, foreign: { currency: "USD", amountMinor: 1_000n, fxRate: "15.5" } }, { accountCode: "3010", creditMinor: 15_500n }] });
  assert.deepEqual(codes(ok), []);
  const off = draft({ lines: [{ accountCode: "1030", debitMinor: 15_000n, foreign: { currency: "USD", amountMinor: 1_000n, fxRate: "15.5" } }, { accountCode: "3010", creditMinor: 15_000n }] });
  assert.ok(codes(off).includes("FX_AMOUNT_MISMATCH"));
  const missing = draft({ lines: [{ accountCode: "1030", debitMinor: 100n }, { accountCode: "3010", creditMinor: 100n }] });
  assert.ok(codes(missing).includes("FOREIGN_DETAIL_REQUIRED"));
  const wrongCcy = draft({ lines: [{ accountCode: "1030", debitMinor: 100n, foreign: { currency: "EUR", amountMinor: 10n, fxRate: "10" } }, { accountCode: "3010", creditMinor: 100n }] });
  assert.ok(codes(wrongCcy).includes("ACCOUNT_CURRENCY_MISMATCH"));
  const sameCcy = draft({ lines: [{ accountCode: "1020", debitMinor: 100n, foreign: { currency: "GHS", amountMinor: 100n, fxRate: "1" } }, { accountCode: "3010", creditMinor: 100n }] });
  assert.ok(codes(sameCcy).includes("FOREIGN_SAME_CURRENCY"));
  const badRate = draft({ lines: [{ accountCode: "1030", debitMinor: 100n, foreign: { currency: "USD", amountMinor: 10n, fxRate: "abc" } }, { accountCode: "3010", creditMinor: 100n }] });
  assert.ok(codes(badRate).includes("INVALID_FX_RATE"));
});

test("formatRate normalises to 10 dp", () => {
  assert.equal(formatRate("1.5"), "1.5000000000");
  assert.equal(formatRate("15"), "15.0000000000");
  assert.equal(formatRate("0.0000000001"), "0.0000000001");
  assert.equal(formatRate("1.00000000001"), null);
});

test("default idempotency key and fingerprint are stable and content-sensitive", () => {
  const a = normalizeDraft(draft());
  assert.equal(a.idempotencyKey, "manual:M-1:v1:standard");
  assert.equal(draftFingerprint(a), draftFingerprint(normalizeDraft(draft())));
  const changed = normalizeDraft(draft({ lines: [{ accountCode: "1020", debitMinor: 101_00n }, { accountCode: "3010", creditMinor: 101_00n }] }));
  assert.notEqual(draftFingerprint(a), draftFingerprint(changed));
  const spaced = normalizeDraft(draft({ description: "  Capital introduced  " }));
  assert.equal(draftFingerprint(a), draftFingerprint(spaced));
});

test("journal hash chains to its predecessor and changes with any figure", () => {
  const header = { reference: "JNL-2026-000001", entryDate: "2026-11-04", journalType: "standard", sourceType: "manual", sourceId: "M-1", sourceVersion: 1, description: "Capital introduced", currency: "GHS", postedBy: "open-access", postedAt: "2026-11-04T10:00:00.000Z", reversesJournalId: null };
  const lines = normalizeLines(draft().lines);
  const h1 = journalHash(GENESIS_HASH, header, lines);
  assert.equal(h1, journalHash(GENESIS_HASH, header, lines));
  assert.notEqual(h1, journalHash("1".repeat(64), header, lines));
  const tweaked = normalizeLines([{ accountCode: "1020", debitMinor: 100_01n }, { accountCode: "3010", creditMinor: 100_01n }]);
  assert.notEqual(h1, journalHash(GENESIS_HASH, header, tweaked));
  // dimension key order must not matter
  const d1 = normalizeLines([{ accountCode: "1020", debitMinor: 1n, dimensions: { a: "1", b: "2" } }]);
  const d2 = normalizeLines([{ accountCode: "1020", debitMinor: 1n, dimensions: { b: "2", a: "1" } }]);
  assert.equal(journalHash(GENESIS_HASH, header, d1), journalHash(GENESIS_HASH, header, d2));
});

test("reversal swaps sides, keeps the source, and is idempotent per original", () => {
  const rev = buildReversalDraft({ id: "abc", reference: "JNL-2026-000001", sourceType: "manual", sourceId: "M-1", sourceVersion: 1, currency: "GHS", lines: draft().lines }, { entryDate: "2026-11-05", reason: "Posted in error" });
  assert.equal(rev.journalType, "reversal");
  assert.equal(rev.idempotencyKey, "reversal:abc");
  assert.equal(rev.lines[0]?.creditMinor, 100_00n);
  assert.equal(rev.lines[0]?.debitMinor, 0n);
  assert.equal(rev.lines[1]?.debitMinor, 100_00n);
  assert.deepEqual(codes(rev), []);
});
