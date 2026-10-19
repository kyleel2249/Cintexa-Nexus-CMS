import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../core/settings";
import { scoreLead, priorityFromScore } from "../domain/lead-scoring";
import { normalizeEmail, normalizePhone, normalizeCompany, levenshtein, similarity, matchScore, rankDuplicates } from "../domain/dedupe";
import { assertTransition, canTransition, LEAD_TRANSITIONS, QUOTATION_TRANSITIONS, ORDER_TRANSITIONS, COMMISSION_TRANSITIONS } from "../domain/state-machines";
import { resolvePrice, evaluateApproval, approverCanApprove, discountLimitFor, type PriceBook } from "../domain/pricing";
import { attainmentPercent, remaining, netActual, pacing } from "../domain/targets";
import { computeCommission, tieredTotal, validateTiers, selectPlan, reversalFor, quotaBonus, splitCredit, type Plan } from "../domain/commission";
import { computeForecast, accuracyOf, seasonalIndex, linearTrend, forecastError } from "../domain/forecast";
import { assessHealth } from "../domain/health";
import { validateRule, findCycle, evaluateConditions, renderTemplate, runKey, type RuleDef } from "../domain/automation-engine";
import { rangeFor } from "../core/time";
import { HttpError } from "../core/errors";
import * as M from "../core/money";

const NOW = new Date("2026-10-17T10:00:00Z");
const S = DEFAULT_SETTINGS;

describe("lead scoring", () => {
  test("explains every point and clamps to 0..100", () => {
    const r = scoreLead({ email: "a@b.co", phone: "+233201234567", company: "Acme", job_title: "Managing Director", budget: "25000.00", source: "referral", consent_email: true, last_contact_at: "2026-10-15T00:00:00Z", status: "contacted" }, S.leads.scoring, NOW);
    assert.equal(r.score, 10 + 8 + 7 + 5 + 12 + 10 + 15 + 15 + 5 + 8 - 0 > 100 ? 100 : r.score);
    assert.ok(r.breakdown.every((f) => f.points !== 0 && f.detail));
    assert.ok(r.score <= 100 && r.score >= 0);
    const names = r.breakdown.map((f) => f.factor);
    for (const n of ["email", "phone", "company", "decision_maker", "budget", "high_budget", "source", "consent", "recent_contact"]) assert.ok(names.includes(n), n);
  });
  test("empty lead scores 0, stale lead is penalised but never below 0", () => {
    assert.equal(scoreLead({}, S.leads.scoring, NOW).score, 0);
    const stale = scoreLead({ email: "x@y.co", status: "contacted", last_contact_at: "2026-01-01T00:00:00Z" }, S.leads.scoring, NOW);
    assert.equal(stale.score, 0);
    assert.ok(stale.breakdown.some((f) => f.factor === "stale"));
  });
  test("decision maker match is whole-word (no 'head' in 'headset')", () => {
    const a = scoreLead({ job_title: "Headset Technician" }, S.leads.scoring, NOW);
    assert.ok(!a.breakdown.some((f) => f.factor === "decision_maker"));
    assert.ok(scoreLead({ job_title: "Head of Sales" }, S.leads.scoring, NOW).breakdown.some((f) => f.factor === "decision_maker"));
  });
  test("priority bands", () => {
    assert.deepEqual([0, 30, 55, 75].map(priorityFromScore), ["low", "medium", "high", "urgent"]);
  });
});

describe("duplicate detection", () => {
  const rules = S.leads.dedupe;
  test("normalisation", () => {
    assert.equal(normalizeEmail("John.Doe+promo@Gmail.com"), "johndoe@gmail.com");
    assert.equal(normalizeEmail("a+x@corp.com"), "a@corp.com");
    assert.equal(normalizeEmail("not-an-email"), null);
    assert.equal(normalizePhone("+233 24 123 4567"), normalizePhone("024-123-4567"));
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizeCompany("Acme Ltd."), normalizeCompany("ACME, Inc"));
  });
  test("levenshtein / similarity", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(similarity("Jon Smith", "John Smith") > 0.85, true);
    assert.equal(similarity("", ""), 1);
  });
  test("email match outranks everything; unrelated people do not match", () => {
    const a = { id: 1, first_name: "Ama", last_name: "Mensah", email: "ama@x.com" };
    assert.equal(matchScore(a, { id: 2, first_name: "A.", last_name: "M", email: "AMA@x.com" }, rules)!.confidence >= 0.95, true);
    assert.equal(matchScore(a, { id: 3, first_name: "Kofi", last_name: "Boateng", email: "kofi@y.com" }, rules), null);
  });
  test("rankDuplicates sorts by confidence and skips self", () => {
    const subject = { id: 1, first_name: "Ama", last_name: "Mensah", email: "ama@x.com", phone: "0241234567", company: "Acme Ltd" };
    const ranked = rankDuplicates(subject, [
      subject,
      { id: 2, first_name: "Ama", last_name: "Mensah", phone: "+233241234567" },
      { id: 3, first_name: "Ama", last_name: "Mensah", email: "ama@x.com" },
      { id: 4, first_name: "Zed", last_name: "Q" },
    ], rules);
    assert.deepEqual(ranked.map((r) => r.id), [3, 2]);
  });
  test("rules can be switched off", () => {
    const off = { ...rules, matchEmail: false, matchPhone: false, matchCompany: false };
    assert.equal(matchScore({ id: 1, email: "a@b.co" }, { id: 2, email: "a@b.co" }, off), null);
  });
});

describe("state machines", () => {
  test("allowed and forbidden edges", () => {
    assert.ok(canTransition(LEAD_TRANSITIONS, "new", "contacted"));
    assert.ok(!canTransition(LEAD_TRANSITIONS, "converted", "new"));
    assert.ok(!canTransition(QUOTATION_TRANSITIONS, "accepted", "draft"));
    assert.ok(!canTransition(ORDER_TRANSITIONS, "completed", "cancelled"));
    assert.ok(!canTransition(COMMISSION_TRANSITIONS, "paid", "void"));
  });
  test("a quotation cannot jump from draft to accepted", () => {
    assert.throws(() => assertTransition("quotation", QUOTATION_TRANSITIONS, "draft", "accepted"), (e: unknown) => e instanceof HttpError && e.status === 409 && e.code === "invalid_transition");
  });
  test("same-state is a no-op", () => assertTransition("order", ORDER_TRANSITIONS, "draft", "draft"));
});

describe("pricing", () => {
  const book = (over: Partial<PriceBook> & Pick<PriceBook, "id">): PriceBook => ({ accountId: null, isDefault: false, active: true, validFrom: null, validTo: null, currency: "USD", entries: [], ...over });
  const product = { id: 10, basePrice: "100.00", category: "Hardware" };
  test("customer book beats default book beats base price; tiers by quantity", () => {
    const books = [
      book({ id: 1, isDefault: true, entries: [{ productId: 10, minQuantity: "1", unitPrice: "95.00" }, { productId: 10, minQuantity: "10", unitPrice: "90.00" }] }),
      book({ id: 2, accountId: 7, entries: [{ productId: 10, minQuantity: "1", unitPrice: "80.00" }] }),
    ];
    const base = { product, currency: "USD", priceBooks: books, promotions: [], on: "2026-10-17" };
    assert.deepEqual(resolvePrice({ ...base, quantity: "1", accountId: 7 }).source, "customer_price_book");
    assert.equal(resolvePrice({ ...base, quantity: "1", accountId: 7 }).unitPrice, "80.00");
    assert.equal(resolvePrice({ ...base, quantity: "12", accountId: 8 }).unitPrice, "90.00");
    assert.equal(resolvePrice({ ...base, quantity: "2", accountId: 8 }).unitPrice, "95.00");
    assert.equal(resolvePrice({ ...base, quantity: "1", accountId: 8, priceBooks: [] }).source, "base_price");
  });
  test("expired / inactive / wrong-currency books are ignored", () => {
    const entries = [{ productId: 10, minQuantity: "1", unitPrice: "50.00" }];
    const run = (b: PriceBook) => resolvePrice({ product, quantity: "1", accountId: null, currency: "USD", priceBooks: [b], promotions: [], on: "2026-10-17" }).unitPrice;
    assert.equal(run(book({ id: 1, entries, validTo: "2026-01-01" })), "100.00");
    assert.equal(run(book({ id: 1, entries, active: false })), "100.00");
    assert.equal(run(book({ id: 1, entries, currency: "EUR" })), "100.00");
    assert.equal(run(book({ id: 1, entries })), "50.00");
  });
  test("best promotion is suggested, not baked in", () => {
    const r = resolvePrice({
      product, quantity: "1", accountId: null, currency: "USD", priceBooks: [], on: "2026-10-17",
      promotions: [
        { id: 1, productId: 10, category: null, discountPercent: "5", startsOn: "2026-10-01", endsOn: "2026-10-31", active: true },
        { id: 2, productId: null, category: "Hardware", discountPercent: "12", startsOn: "2026-10-01", endsOn: "2026-10-31", active: true },
        { id: 3, productId: 10, category: null, discountPercent: "50", startsOn: "2026-01-01", endsOn: "2026-01-31", active: true },
      ],
    });
    assert.equal(r.unitPrice, "100.00");
    assert.deepEqual(r.promotion, { id: 2, percent: "12" });
  });
  test("approval findings and who may approve", () => {
    const f = evaluateApproval({ ownerRole: "sales_rep", maxLineDiscountPercent: 15, marginPercent: 5, total: "60000.00", creditLimit: "50000.00", openExposure: "10000.00" }, S.discounts, S.orders);
    assert.deepEqual(f.map((x) => x.code).sort(), ["credit_limit_exceeded", "discount_exceeds_limit", "margin_below_minimum", "order_over_threshold"]);
    assert.equal(approverCanApprove("sales_rep", f, 15, S.discounts).ok, false);
    assert.equal(approverCanApprove("sales_manager", f, 15, S.discounts).ok, false); // margin/credit need director+
    assert.equal(approverCanApprove("sales_director", f, 15, S.discounts).ok, true);
    assert.equal(approverCanApprove("finance", f, 15, S.discounts).ok, false); // finance cannot approve discounts
    const only = evaluateApproval({ ownerRole: "sales_rep", maxLineDiscountPercent: 15, marginPercent: 30, total: "100.00", creditLimit: null, openExposure: "0.00" }, S.discounts, S.orders);
    assert.equal(approverCanApprove("sales_manager", only, 15, S.discounts).ok, true);
    assert.equal(approverCanApprove("sales_manager", evaluateApproval({ ownerRole: "sales_rep", maxLineDiscountPercent: 25, marginPercent: 30, total: "1.00", creditLimit: null, openExposure: "0.00" }, S.discounts), 25, S.discounts).ok, false);
  });
  test("discount ceilings per role", () => {
    assert.equal(discountLimitFor("sales_rep", S.discounts), 10);
    assert.equal(discountLimitFor("finance", S.discounts), 0);
  });
  test("within limits needs no approval", () => {
    assert.deepEqual(evaluateApproval({ ownerRole: "sales_rep", maxLineDiscountPercent: 10, marginPercent: 40, total: "500.00", creditLimit: null, openExposure: "0.00" }, S.discounts, S.orders), []);
  });
});

describe("targets", () => {
  test("attainment and remaining", () => {
    assert.equal(attainmentPercent("75000.00", "100000.00"), 75);
    assert.equal(attainmentPercent("10.00", "0.00"), null);
    assert.equal(remaining("100.00", "130.00"), "-30.00");
    assert.equal(netActual("1000.00", "100.00", "50.00"), "850.00");
  });
  test("pacing: ahead / behind / achieved / zero target", () => {
    const range = rangeFor("month", NOW, "UTC"); // Oct 2026, 16.4/31 days elapsed
    const ahead = pacing({ target: "31000.00", actual: "20000.00", range, now: NOW });
    assert.equal(ahead.status, "ahead");
    const behind = pacing({ target: "31000.00", actual: "5000.00", range, now: NOW });
    assert.equal(behind.status, "behind");
    assert.equal(pacing({ target: "100.00", actual: "100.00", range, now: NOW }).status, "achieved");
    assert.equal(pacing({ target: "0.00", actual: "0.00", range, now: NOW }).status, "no_target");
    assert.ok(Number(behind.requiredPerDay) > 0);
    assert.equal(behind.daysRemaining, 15); // 14.6 days left, rounded up
  });
  test("closed period and not-started period", () => {
    const past = rangeFor("last_month", NOW, "UTC");
    assert.equal(pacing({ target: "100.00", actual: "10.00", range: past, now: NOW }).status, "closed");
    const future = { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", label: "Nov" };
    assert.equal(pacing({ target: "100.00", actual: "0.00", range: future, now: NOW }).status, "not_started");
  });
});

describe("commission", () => {
  const base: Plan = { id: 1, version: 1, kind: "percent", basis: "collected", measure: "revenue", rate: "5", fixedAmount: null, tiers: [], productId: null, category: null, memberId: null, effectiveFrom: "2026-01-01", effectiveTo: null, active: true, quotaBonus: null };
  test("percent with split credit", () => {
    const r = computeCommission(base, "10000.00", "60");
    assert.equal(r.amount, "300.00"); // 6000 credited × 5%
    assert.equal((r.breakdown as any).credited, "6000.00");
  });
  test("fixed commission is shared by split", () => {
    assert.equal(computeCommission({ ...base, kind: "fixed", rate: null, fixedAmount: "200.00" }, "999.00", "50").amount, "100.00");
  });
  test("progressive tiers on cumulative basis", () => {
    const tiers = [{ from: "0.00", to: "10000.00", rate: "2" }, { from: "10000.00", to: "50000.00", rate: "4" }, { from: "50000.00", to: null, rate: "6" }];
    assert.equal(validateTiers(tiers), null);
    assert.equal(tieredTotal("60000.00", tiers), "200.00" /* 2%×10k */.replace("200.00", M.add("200.00", M.add("1600.00", "600.00"))));
    const plan: Plan = { ...base, kind: "tiered", rate: null, tiers };
    // order of 8000 then 8000: second crosses 10k boundary -> 2000@2% ... exact increments sum to total
    const a = computeCommission(plan, "8000.00", "100", "0.00");
    const b = computeCommission(plan, "8000.00", "100", "8000.00");
    assert.equal(a.amount, "160.00");
    assert.equal(M.add(a.amount, b.amount), tieredTotal("16000.00", tiers));
  });
  test("tier validation catches gaps, overlaps and bounded last tier", () => {
    assert.match(validateTiers([{ from: "0.00", to: "10.00", rate: "1" }, { from: "20.00", to: null, rate: "2" }])!, /contiguous/);
    assert.match(validateTiers([{ from: "5.00", to: null, rate: "1" }])!, /start at 0/);
    assert.match(validateTiers([{ from: "0.00", to: "10.00", rate: "1" }])!, /unbounded/);
    assert.match(validateTiers([])!, /At least one/);
  });
  test("plan selection prefers the most specific effective plan", () => {
    const plans: Plan[] = [
      base,
      { ...base, id: 2, productId: 5, rate: "8" },
      { ...base, id: 3, memberId: 9, rate: "6" },
      { ...base, id: 4, productId: 5, memberId: 9, rate: "10" },
      { ...base, id: 5, effectiveTo: "2026-06-30", rate: "99" },
      { ...base, id: 6, active: false, rate: "98" },
    ];
    assert.equal(selectPlan(plans, { memberId: 9, productId: 5, category: null, on: "2026-10-17" })!.id, 4);
    assert.equal(selectPlan(plans, { memberId: 1, productId: 5, category: null, on: "2026-10-17" })!.id, 2);
    assert.equal(selectPlan(plans, { memberId: 9, productId: 1, category: null, on: "2026-10-17" })!.id, 3);
    assert.equal(selectPlan(plans, { memberId: 1, productId: 1, category: null, on: "2026-10-17" })!.id, 1);
    assert.equal(selectPlan([], { memberId: 1, productId: 1, category: null, on: "2026-10-17" }), null);
  });
  test("reversal is proportional, negative and capped", () => {
    assert.equal(reversalFor("500.00", "10000.00", "2500.00"), "-125.00");
    assert.equal(reversalFor("500.00", "10000.00", "99999.00"), "-500.00");
    assert.equal(reversalFor("500.00", "10000.00", "0.00"), "0.00");
  });
  test("quota bonus once, at threshold", () => {
    const p = { ...base, quotaBonus: { thresholdPercent: 100, amount: "1000.00" } };
    assert.equal(quotaBonus(p, 99.9, false), "0.00");
    assert.equal(quotaBonus(p, 100, false), "1000.00");
    assert.equal(quotaBonus(p, 120, true), "0.00");
    assert.equal(quotaBonus(p, null, false), "0.00");
  });
  test("split credit never loses a cent", () => {
    assert.equal(M.sum(splitCredit("100.00", [1, 1, 1])), "100.00");
  });
});

describe("forecast", () => {
  const range = rangeFor("month", NOW, "UTC");
  const opp = (id: number, amount: string, probability: number, category: any, date: string | null, changes = 0) => ({ id, amount, probability, category, expectedCloseDate: date, closeDateChanges: changes, ownerId: 1 });
  const cfg = { minimumClosedDeals: 10, worstCaseHaircut: 0.5, bestCaseUplift: 1 };
  test("scenarios are computed exactly", () => {
    const r = computeForecast({
      opps: [opp(1, "10000.00", 90, "commit", "2026-10-25"), opp(2, "20000.00", 50, "best_case", "2026-10-28"), opp(3, "40000.00", 20, "pipeline", "2026-10-30"), opp(4, "99999.00", 90, "commit", "2026-11-15"), opp(5, "5000.00", 60, "omitted", "2026-10-20")],
      closedAmount: "30000.00", closedDeals: 3, range, target: "100000.00", today: "2026-10-17", cfg,
    });
    assert.equal(r.weighted, "27000.00"); // 9000 + 10000 + 8000
    assert.equal(r.baseCase, "57000.00");
    assert.equal(r.bestCase, M.add("30000.00", M.add("10000.00", M.add("20000.00", "8000.00"))));
    assert.equal(r.worstCase, "35000.00");
    assert.equal(r.coverage, 100); // 70000 open ÷ 70000 remaining
    assert.equal(r.openCount, 3);
    assert.equal(r.reliability.level, "estimate");
    assert.match(r.reliability.message, /not a statistical forecast/);
  });
  test("reliability flips to supported with enough history; overdue and slipped are surfaced", () => {
    const r = computeForecast({ opps: [opp(1, "100.00", 50, "pipeline", "2026-10-01", 2)], closedAmount: "0.00", closedDeals: 25, range, target: null, today: "2026-10-17", cfg });
    assert.equal(r.reliability.level, "supported");
    assert.equal(r.overdueCount, 1);
    assert.equal(r.slippedCount, 1);
    assert.equal(r.coverage, null);
    assert.equal(r.weighted, "0.00"); // overdue open deals are reported, not counted
  });
  test("accuracy metrics", () => {
    const a = accuracyOf([{ forecast: "110.00", actual: "100.00" }, { forecast: "80.00", actual: "100.00" }]);
    assert.deepEqual(a, { mape: 15, bias: -5, n: 2 });
    assert.equal(accuracyOf([]).mape, null);
    assert.equal(forecastError("10.00", "0.00"), null);
  });
  test("seasonality and trend refuse thin data", () => {
    const monthly = Array.from({ length: 10 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, amount: 100 }));
    assert.equal(seasonalIndex(monthly, 24), null);
    const two = Array.from({ length: 24 }, (_, i) => ({ month: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, amount: (i % 12) + 1 }));
    const idx = seasonalIndex(two, 24)!;
    assert.equal(idx.length, 12);
    assert.ok(idx[11]! > idx[0]!);
    assert.equal(linearTrend([1, 2, 3]), null);
    const t = linearTrend([10, 12, 14, 16, 18, 20])!;
    assert.equal(Math.round(t.slope), 2);
    assert.equal(t.r2, 1);
    assert.equal(Math.round(t.next), 22);
  });
});

describe("customer health", () => {
  const cfg = S.retention;
  const base = { daysSinceLastPurchase: 10, ordersLast365: 6, revenueLast90: 1000, revenuePrev90: 900, openComplaints: 0, activitiesLast60: 3, reorderIntervalDays: null, daysPastExpectedReorder: null, status: "active" as const };
  test("healthy account", () => assert.equal(assessHealth(base, cfg).band, "healthy"));
  test("no evidence is 'unknown', never 'at risk'", () => {
    const h = assessHealth({ ...base, daysSinceLastPurchase: null, ordersLast365: 0, revenueLast90: 0, revenuePrev90: 0, activitiesLast60: 0, status: "prospect" }, cfg);
    assert.equal(h.band, "unknown");
    assert.equal(h.score, null);
  });
  test("at risk carries explicit reasons", () => {
    const h = assessHealth({ ...base, daysSinceLastPurchase: 120, ordersLast365: 1, revenueLast90: 0, revenuePrev90: 800, openComplaints: 2, activitiesLast60: 0 }, cfg);
    assert.equal(h.band, "at_risk");
    assert.ok(h.reasons.length >= 3);
  });
  test("churned is final", () => assert.equal(assessHealth({ ...base, status: "churned" }, cfg).band, "churned"));
});

describe("automation engine", () => {
  const rule = (over: Partial<RuleDef>): RuleDef => ({ name: "Follow up new leads", trigger: "lead.created", conditions: [], actions: [{ type: "create_task", params: { subject: "Call the lead", dueInDays: 1 } }], ...over });
  test("valid rule passes; invalid pieces are reported with paths", () => {
    assert.deepEqual(validateRule(rule({})), []);
    const issues = validateRule(rule({ name: "x", conditions: [{ field: "Bad Field!", op: "eq", value: 1 }], actions: [{ type: "create_task", params: {} }, { type: "update_field", params: { field: "amount", value: 1 } }] }));
    const paths = issues.map((i) => i.path);
    assert.ok(paths.includes("name") && paths.includes("conditions[0].field") && paths.includes("actions[0].params.subject") && paths.includes("actions[1].params.field"));
  });
  test("detects circular workflows across rules", () => {
    const a = rule({ id: 1, name: "A", trigger: "lead.assigned", actions: [{ type: "assign", params: { to: "round_robin" } }] });
    assert.ok(findCycle([a]), "a rule that re-assigns on assignment loops by itself");
    assert.match(validateRule(a).find((i) => i.message.includes("circular"))!.message, /circular/);
    const ok = rule({ id: 2, name: "B", trigger: "lead.created", actions: [{ type: "assign", params: { to: "round_robin" } }] });
    assert.equal(findCycle([ok, rule({ id: 3, name: "C", trigger: "lead.assigned" })]), null);
  });
  test("conditions", () => {
    const ctx = { amount: 5000, owner: { name: "Ama" }, tags: ["vip"], source: "Referral", empty: "" };
    assert.ok(evaluateConditions([{ field: "amount", op: "gte", value: 5000 }, { field: "source", op: "contains", value: "ref" }, { field: "tags", op: "contains", value: "vip" }, { field: "owner.name", op: "eq", value: "Ama" }, { field: "empty", op: "is_empty" }, { field: "amount", op: "in", value: [1, 5000] }], ctx));
    assert.ok(!evaluateConditions([{ field: "amount", op: "lt", value: 10 }], ctx));
    assert.ok(!evaluateConditions([{ field: "__proto__.x", op: "is_set" }], ctx));
    assert.ok(evaluateConditions([], ctx));
  });
  test("templates only read plain values", () => {
    assert.equal(renderTemplate("Hi {{owner.name}}, {{amount}} {{missing}} {{owner}}", { owner: { name: "Ama" }, amount: 5 }), "Hi Ama, 5  ");
  });
  test("run keys are stable per event and differ across versions", () => {
    const k = (v: number, e: string) => runKey({ id: 1, version: v }, "lead.created", "lead", 9, e);
    assert.equal(k(1, "a"), k(1, "a"));
    assert.notEqual(k(1, "a"), k(2, "a"));
    assert.notEqual(k(1, "a"), k(1, "b"));
  });
  test("sensitive actions are flagged", async () => {
    const { SENSITIVE_ACTIONS } = await import("../domain/automation-engine");
    assert.ok(SENSITIVE_ACTIONS.includes("send_message"));
    assert.ok(!SENSITIVE_ACTIONS.includes("create_task"));
  });
});
