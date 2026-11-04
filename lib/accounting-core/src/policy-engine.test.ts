import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PolicyError,
  PolicyNotConfiguredError,
  PolicyRegistry,
  POLICY_KEYS,
  assessMateriality,
  decideCapitalisation,
  decideRevenueRecognition,
  depreciationRule,
  fxRateBasis,
  inventoryValuationMethod,
  parseDecimalScaled,
  policyReadiness,
  seedDefaultPolicies,
  verifyAuditChain,
  ALL_CORE_POLICY_KEYS,
} from "./index";

const ACTOR = "open-access";

function seeded(opts: ConstructorParameters<typeof PolicyRegistry>[0] = {}, from = "2026-01-01"): PolicyRegistry {
  const r = new PolicyRegistry({ clock: () => "2026-11-04T00:00:00.000Z", ...opts });
  seedDefaultPolicies(r, { effectiveFrom: from, actor: ACTOR });
  return r;
}

function code(c: string) {
  return (e: unknown) => e instanceof PolicyError && e.code === c;
}

test("parseDecimalScaled is exact and rejects bad input", () => {
  assert.equal(parseDecimalScaled("25"), 25_000_000n);
  assert.equal(parseDecimalScaled("0.5"), 500_000n);
  assert.equal(parseDecimalScaled("1.0000001"), null);
  assert.equal(parseDecimalScaled("-1"), null);
  assert.equal(parseDecimalScaled("abc"), null);
});

test("seeded pack provides the mandated 25% straight-line computer depreciation", () => {
  const r = seeded();
  const rule = depreciationRule(r, "computer_equipment", "2026-06-30");
  assert.equal(rule.method, "straight_line");
  assert.equal(rule.annualRatePercent, "25");
  assert.equal(rule.annualRateScaled, 25_000_000n);
  assert.equal(rule.policyVersion, 1);
});

test("seeding is idempotent", () => {
  const r = seeded();
  const again = seedDefaultPolicies(r, { effectiveFrom: "2027-01-01", actor: ACTOR });
  assert.deepEqual(again, []);
  assert.equal(r.history(POLICY_KEYS.depreciationComputerEquipment).length, 1);
});

test("entity-level policies are not invented: unconfigured ones fail loudly", () => {
  const r = seeded();
  assert.throws(() => inventoryValuationMethod(r, "2026-06-30"), (e) => e instanceof PolicyNotConfiguredError);
  const ready = policyReadiness(r, "2026-06-30", ALL_CORE_POLICY_KEYS);
  assert.equal(ready.ready, false);
  assert.deepEqual(ready.missing.sort(), [POLICY_KEYS.framework, POLICY_KEYS.inventoryValuation, POLICY_KEYS.materiality].sort());
});

test("inventory policy: FIFO accepted, LIFO and negative stock rejected", () => {
  const r = seeded();
  assert.throws(
    () => r.propose({ key: POLICY_KEYS.inventoryValuation, domain: "inventory_valuation", effectiveFrom: "2026-01-01", params: { method: "LIFO", allowNegativeStock: false }, changeType: "initial", rationale: "x", actor: ACTOR }),
    code("INVALID_POLICY"),
  );
  assert.throws(
    () => r.propose({ key: POLICY_KEYS.inventoryValuation, domain: "inventory_valuation", effectiveFrom: "2026-01-01", params: { method: "FIFO", allowNegativeStock: true }, changeType: "initial", rationale: "x", actor: ACTOR }),
    code("INVALID_POLICY"),
  );
  const v = r.propose({ key: POLICY_KEYS.inventoryValuation, domain: "inventory_valuation", effectiveFrom: "2026-01-01", params: { method: "FIFO", allowNegativeStock: false }, changeType: "initial", rationale: "Entity choice", actor: ACTOR });
  r.approve(POLICY_KEYS.inventoryValuation, v.version, ACTOR);
  assert.equal(inventoryValuationMethod(r, "2026-06-30").method, "FIFO");
});

test("invalid depreciation rates are rejected", () => {
  const r = seeded();
  for (const bad of ["0", "101", "abc", "-5"]) {
    assert.throws(
      () => r.propose({ key: POLICY_KEYS.depreciationComputerEquipment, domain: "depreciation", effectiveFrom: "2027-01-01", params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: bad, convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType: "estimate_change", rationale: "x", actor: ACTOR }),
      code("INVALID_POLICY"),
    );
  }
});

test("a change in estimate takes effect prospectively and history is preserved", () => {
  const r = seeded();
  const v2 = r.propose({ key: POLICY_KEYS.depreciationComputerEquipment, domain: "depreciation", effectiveFrom: "2027-01-01", params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: "20", convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType: "estimate_change", rationale: "Longer observed useful life", actor: ACTOR });
  assert.equal(r.resolve(POLICY_KEYS.depreciationComputerEquipment, "2027-06-01").version, 1, "draft must not take effect");
  r.approve(POLICY_KEYS.depreciationComputerEquipment, v2.version, ACTOR);
  assert.equal(depreciationRule(r, "computer_equipment", "2026-12-31").annualRatePercent, "25");
  assert.equal(depreciationRule(r, "computer_equipment", "2027-01-01").annualRatePercent, "20");
  assert.equal(r.history(POLICY_KEYS.depreciationComputerEquipment).length, 2);
});

test("a change needs a rationale and the first version must be initial", () => {
  const r = seeded();
  assert.throws(
    () => r.propose({ key: POLICY_KEYS.depreciationComputerEquipment, domain: "depreciation", effectiveFrom: "2027-01-01", params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: "20", convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType: "policy_change", rationale: "  ", actor: ACTOR }),
    code("INVALID_POLICY"),
  );
  assert.throws(
    () => r.propose({ key: "depreciation.vehicles", domain: "depreciation", effectiveFrom: "2027-01-01", params: { assetClass: "vehicles", method: "straight_line", annualRatePercent: "20", convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType: "policy_change", rationale: "x", actor: ACTOR }),
    code("INVALID_POLICY"),
  );
});

test("closed periods: backdating is refused, retrospective policy change flags a restatement, estimates can never be retrospective", () => {
  let locked: string | null = "2026-12-31";
  const r = seeded({ lockedThrough: () => locked }, "2027-01-01");
  const mk = (changeType: "policy_change" | "estimate_change", retrospective: boolean) =>
    r.propose({ key: POLICY_KEYS.depreciationComputerEquipment, domain: "depreciation", effectiveFrom: "2026-06-01", params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: "20", convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType, rationale: "Reassessment", retrospective, actor: ACTOR });

  const a = mk("policy_change", false);
  assert.throws(() => r.approve(POLICY_KEYS.depreciationComputerEquipment, a.version, ACTOR), code("PERIOD_LOCKED"));

  const b = mk("estimate_change", true);
  assert.throws(() => r.approve(POLICY_KEYS.depreciationComputerEquipment, b.version, ACTOR), code("ESTIMATE_NOT_RETROSPECTIVE"));

  const c = mk("policy_change", true);
  const approved = r.approve(POLICY_KEYS.depreciationComputerEquipment, c.version, ACTOR);
  assert.equal(approved.requiresRestatement, true);
  locked = null;
});

test("inserting a version before an already-approved later one is refused (no silent history change)", () => {
  const r = seeded();
  const base = { key: POLICY_KEYS.depreciationComputerEquipment, domain: "depreciation" as const, params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: "20", convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType: "policy_change" as const, rationale: "x", actor: ACTOR };
  const later = r.propose({ ...base, effectiveFrom: "2027-01-01" });
  r.approve(base.key, later.version, ACTOR);
  const earlier = r.propose({ ...base, effectiveFrom: "2026-06-01" });
  assert.throws(() => r.approve(base.key, earlier.version, ACTOR), code("BACKDATED"));
  const same = r.propose({ ...base, effectiveFrom: "2027-01-01" });
  assert.throws(() => r.approve(base.key, same.version, ACTOR), code("EFFECTIVE_DATE_CLASH"));
});

test("segregation of duties can be switched on and is off by default", () => {
  const strict = new PolicyRegistry({ requireDistinctApprover: true });
  const v = strict.propose({ key: POLICY_KEYS.functionalCurrency, domain: "functional_currency", effectiveFrom: "2026-01-01", params: { functionalCurrency: "GHS" }, changeType: "initial", rationale: "x", actor: "maker" });
  assert.throws(() => strict.approve(POLICY_KEYS.functionalCurrency, v.version, "maker"), code("SAME_APPROVER"));
  assert.equal(strict.approve(POLICY_KEYS.functionalCurrency, v.version, "checker").status, "approved");
  assert.doesNotThrow(() => seeded());
});

test("rejected drafts never take effect and cannot be approved later", () => {
  const r = seeded();
  const v = r.propose({ key: POLICY_KEYS.depreciationComputerEquipment, domain: "depreciation", effectiveFrom: "2027-01-01", params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: "10", convention: "annual_divided_by_12", startsOn: "available_for_use" }, changeType: "estimate_change", rationale: "x", actor: ACTOR });
  r.reject(POLICY_KEYS.depreciationComputerEquipment, v.version, ACTOR, "Not supported by evidence");
  assert.throws(() => r.approve(POLICY_KEYS.depreciationComputerEquipment, v.version, ACTOR), code("NOT_DRAFT"));
  assert.equal(depreciationRule(r, "computer_equipment", "2028-01-01").annualRatePercent, "25");
});

test("audit chain verifies, survives a snapshot round trip and detects tampering", () => {
  const r = seeded();
  const snap = r.snapshot();
  assert.equal(verifyAuditChain(snap.audit), true);
  const restored = new PolicyRegistry({ snapshot: snap });
  assert.equal(depreciationRule(restored, "computer_equipment", "2026-06-30").annualRatePercent, "25");

  const tampered = r.snapshot();
  const first = tampered.audit[0];
  assert.ok(first);
  first.actor = "someone-else";
  assert.equal(verifyAuditChain(tampered.audit), false);
  assert.throws(() => new PolicyRegistry({ snapshot: tampered }), code("INVALID_POLICY"));
});

test("returned policies are copies: callers cannot mutate the registry", () => {
  const r = seeded();
  const v = r.resolve(POLICY_KEYS.depreciationComputerEquipment, "2026-06-30");
  v.params.annualRatePercent = "99";
  assert.equal(depreciationRule(r, "computer_equipment", "2026-06-30").annualRatePercent, "25");
});

test("FX: only monetary items are revalued at closing rate", () => {
  const r = seeded();
  assert.deepEqual(
    [fxRateBasis(r, "monetary", "2026-12-31").basis, fxRateBasis(r, "monetary", "2026-12-31").revalueAtPeriodEnd],
    ["closing_rate", true],
  );
  const hc = fxRateBasis(r, "non_monetary_historical_cost", "2026-12-31");
  assert.equal(hc.basis, "historical_rate");
  assert.equal(hc.revalueAtPeriodEnd, false);
});

test("revenue: quotes, orders, invoices and payments alone never recognise revenue", () => {
  const r = seeded();
  const d = "2026-06-30";
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "quotation_issued" }).treatment, "no_entry");
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "order_placed" }).treatment, "no_entry");
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "invoice_issued" }).treatment, "defer_as_contract_liability");
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "payment_received" }).treatment, "defer_as_contract_liability");
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "payment_received", performanceAlreadySatisfied: true }).treatment, "no_entry");
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "delivery" }).treatment, "recognise_revenue");
  assert.equal(decideRevenueRecognition(r, { date: d, trigger: "service_performed" }).policyVersion, 1);
});

test("capitalisation: repairs and maintenance are never capitalised; threshold is honoured", () => {
  const r = seeded();
  const d = "2026-06-30";
  assert.equal(decideCapitalisation(r, { date: d, amountMinor: 800_000n, nature: "repair", extendsLifeOrCapacity: true }).treatment, "expense");
  assert.equal(decideCapitalisation(r, { date: d, amountMinor: 800_000n, nature: "new_asset", extendsLifeOrCapacity: true }).treatment, "capitalise");
  assert.equal(decideCapitalisation(r, { date: d, amountMinor: 800_000n, nature: "improvement", extendsLifeOrCapacity: false }).treatment, "expense");

  const v = r.propose({ key: POLICY_KEYS.capitalisation, domain: "capitalisation", effectiveFrom: "2027-01-01", params: { thresholdMinor: "100000", routineNaturesExpensed: ["repair", "maintenance"] }, changeType: "policy_change", rationale: "Introduce threshold", actor: ACTOR });
  r.approve(POLICY_KEYS.capitalisation, v.version, ACTOR);
  assert.equal(decideCapitalisation(r, { date: "2027-02-01", amountMinor: 99_999n, nature: "new_asset", extendsLifeOrCapacity: true }).treatment, "expense");
  assert.equal(decideCapitalisation(r, { date: "2027-02-01", amountMinor: 100_000n, nature: "new_asset", extendsLifeOrCapacity: true }).treatment, "capitalise");

  assert.throws(
    () => r.propose({ key: POLICY_KEYS.capitalisation, domain: "capitalisation", effectiveFrom: "2028-01-01", params: { thresholdMinor: "0", routineNaturesExpensed: ["repair"] }, changeType: "policy_change", rationale: "x", actor: ACTOR }),
    code("INVALID_POLICY"),
  );
});

test("materiality: quantitative, floor, qualitative and legal paths", () => {
  const r = seeded();
  assert.throws(() => assessMateriality(r, { date: "2026-06-30", amountMinor: 1n, benchmarkMinor: 1n }), (e) => e instanceof PolicyNotConfiguredError);
  const v = r.propose({ key: POLICY_KEYS.materiality, domain: "materiality", effectiveFrom: "2026-01-01", params: { thresholdPercent: "5", benchmark: "profit_before_tax", absoluteFloorMinor: "50000000", qualitativeAlwaysMaterial: ["turns_profit_to_loss"] }, changeType: "initial", rationale: "Entity threshold", actor: ACTOR });
  r.approve(POLICY_KEYS.materiality, v.version, ACTOR);
  const d = "2026-06-30";
  assert.equal(assessMateriality(r, { date: d, amountMinor: 4_999n, benchmarkMinor: 100_000n }).material, false);
  assert.equal(assessMateriality(r, { date: d, amountMinor: 5_000n, benchmarkMinor: 100_000n }).material, true);
  assert.equal(assessMateriality(r, { date: d, amountMinor: -5_000n, benchmarkMinor: -100_000n }).material, true);
  assert.equal(assessMateriality(r, { date: d, amountMinor: 1n, benchmarkMinor: 100_000n, legalOrRegulatory: true }).material, true);
  assert.equal(assessMateriality(r, { date: d, amountMinor: 1n, benchmarkMinor: 100_000n, qualitativeFlags: ["turns_profit_to_loss"] }).material, true);
  assert.equal(assessMateriality(r, { date: d, amountMinor: 50_000_000n, benchmarkMinor: 100_000_000_000n }).material, true);
  assert.equal(assessMateriality(r, { date: d, amountMinor: 10n, benchmarkMinor: 0n }).material, true);
  assert.equal(assessMateriality(r, { date: d, amountMinor: 0n, benchmarkMinor: 0n }).material, false);
});
