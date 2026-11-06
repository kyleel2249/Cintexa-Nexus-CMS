import test from "node:test";
import assert from "node:assert";
// @ts-ignore – Pages Function module under test (memory mode — the same engine the app runs)
import * as mod from "../../../../../functions/api/finance/[[path]].ts";

const env: any = { FIN_ALLOW_MEMORY: "1" };
async function call(method: string, path: string, body?: unknown) {
  const r = await (mod as any).onRequest({
    request: new Request("https://x.dev/api/finance/" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
    env, params: { path: path.split("?")[0].split("/").filter(Boolean) },
  });
  return { status: r.status, body: await r.json() as any };
}
const je = (entryDate: string, lines: any[], description = "t") => call("POST", "journals", { entryDate, description, post: true, lines });
const bal = async (code: string, asOf?: string) => {
  const tb = (await call("GET", "trial-balance" + (asOf ? `?asOf=${asOf}` : ""))).body;
  const r = tb.rows.find((x: any) => x.code === code);
  return r ? r.balance : 0;
};
const tbBalanced = async () => (await call("GET", "trial-balance")).body.balanced;

test("FX: foreign-currency lines, revaluation, partial settlement (realized/unrealized), liability, missing rate", async () => {
  // GHS 11.00 per USD → USD 1,000.00 receivable = GHS 11,000.00
  const inv = await je("2027-01-10", [{ accountCode: "1050", fcCurrency: "USD", fcAmount: 100000, rate: 11, side: "debit" }, { accountCode: "4010", credit: 1100000 }]);
  assert.equal(inv.status, 201);
  assert.equal(inv.body.journal.lines[0].debit, 1100000);
  // inconsistent functional amount is rejected
  assert.equal((await je("2027-01-11", [{ accountCode: "1050", fcCurrency: "USD", fcAmount: 100, rate: 11, debit: 9999 }, { accountCode: "4010", credit: 9999 }])).status, 400);

  // revaluation needs an APPROVED closing rate
  const pend = await call("POST", "fx/rates", { currency: "USD", rate: 12.5, rateDate: "2027-01-31", source: "Bank of Ghana" });
  assert.equal(pend.status, 201); assert.equal(pend.body.rate.status, "pending");
  const miss = await call("POST", "fx/revalue", { periodYm: "2027-01" });
  assert.equal(miss.status, 409); assert.equal(miss.body.code, "MISSING_RATE");
  assert.equal((await call("POST", `fx/rates/${pend.body.rate.id}/approve`, { approvedBy: "CFO" })).status, 200);

  const prev = await call("GET", "fx/revaluation/preview?periodYm=2027-01");
  assert.equal(prev.body.detail[0].difference, 150000);
  const rv = await call("POST", "fx/revalue", { periodYm: "2027-01" });
  assert.equal(rv.status, 201);
  assert.equal(await bal("1050"), 1250000);            // 100,000 USD-minor × 12.50
  assert.equal(await bal("4211"), 150000);             // unrealized gain
  const again = await call("POST", "fx/revalue", { periodYm: "2027-01" });
  assert.equal(again.body.posted, false);              // idempotent: nothing more to revalue
  assert.equal(await tbBalanced(), true);

  // settle 40% (USD 400.00) at 13.00 → proceeds 5,200; hist 4,400; realized +800; reverse unrealized 600
  const st = await call("POST", "fx/settle", { accountCode: "1050", currency: "USD", fcAmount: 40000, rate: 13, date: "2027-02-10", counterAccountCode: "1030", idempotencyKey: "S-1" });
  assert.equal(st.status, 201);
  assert.equal((await call("POST", "fx/settle", { accountCode: "1050", currency: "USD", fcAmount: 40000, rate: 13, date: "2027-02-10", counterAccountCode: "1030", idempotencyKey: "S-1" })).body.duplicate, true);
  assert.equal(await bal("1030"), 520000);
  assert.equal(await bal("4210"), 80000);              // realized gain
  assert.equal(await bal("4211"), 90000);              // 150,000 − 60,000 reversed
  assert.equal(await bal("1050"), 750000);             // 60,000 USD-minor × 12.50
  // cannot settle more than is open
  assert.equal((await call("POST", "fx/settle", { accountCode: "1050", currency: "USD", fcAmount: 999999, rate: 13, date: "2027-02-11" })).status, 400);

  // February: closing 13.00 on the remaining 60,000 → +300
  const feb = await call("POST", "fx/rates", { currency: "USD", rate: 13, rateDate: "2027-02-28", source: "Bank of Ghana", approvedBy: "CFO" });
  assert.equal(feb.status, 201);
  assert.equal((await call("POST", "fx/revalue", { periodYm: "2027-02" })).status, 201);
  assert.equal(await bal("1050"), 780000);
  const rep = (await call("GET", "fx/report?from=2027-01-01&to=2027-12-31")).body;
  assert.equal(rep.netRealized, 80000); assert.equal(rep.netUnrealized, 120000);
  const exp = (await call("GET", "fx/exposure?asOf=2027-02-28")).body;
  assert.equal(exp.items[0].unrealizedPendingMinor, 0);

  // liability: EUR 500.00 payable at 15.00 = 7,500; closing 16.00 → loss 500 (liability up)
  assert.equal((await je("2027-03-05", [{ accountCode: "6400", debit: 750000 }, { accountCode: "2010", fcCurrency: "EUR", fcAmount: 50000, rate: 15, side: "credit" }])).status, 201);
  await call("POST", "fx/rates", { currency: "EUR", rate: 16, rateDate: "2027-03-31", source: "Bank of Ghana", approvedBy: "CFO" });
  await call("POST", "fx/rates", { currency: "USD", rate: 13, rateDate: "2027-03-31", source: "Bank of Ghana", approvedBy: "CFO" });
  assert.equal((await call("POST", "fx/revalue", { periodYm: "2027-03" })).status, 201);
  assert.equal(await bal("2010"), 800000);
  assert.equal(await bal("6391"), 50000);
  assert.equal(await tbBalanced(), true);
  // non-monetary account is rejected for FX settlement
  assert.equal((await call("POST", "fx/settle", { accountCode: "1090", currency: "USD", fcAmount: 1, rate: 1, date: "2027-03-10" })).status, 400);
});

test("Inventory: WAC, COGS conditions, no negative stock, returns, write-down, FIFO via policy, GL reconciliation", async () => {
  const item = (await call("POST", "inventory/items", { sku: "cab-01", name: "Cable" })).body.item;
  assert.equal((await call("POST", "inventory/items", { sku: "CAB-01", name: "dup" })).status, 409);
  assert.equal((await call("POST", "inventory/receive", { itemId: item.id, qty: 10, totalCostMinor: 10000, date: "2026-01-05" })).status, 201);
  assert.equal((await call("POST", "inventory/receive", { itemId: item.id, qty: 10, totalCostMinor: 14000, date: "2026-01-10" })).status, 201);
  assert.equal(await bal("1090"), 24000);
  // COGS is refused until the sale is fulfilled
  const no = await call("POST", "inventory/issue", { itemId: item.id, qty: 5, date: "2026-01-15", reason: "sale" });
  assert.equal(no.status, 409); assert.equal(no.body.code, "COGS_CONDITIONS_NOT_MET");
  const sale = await call("POST", "inventory/issue", { itemId: item.id, qty: 5, date: "2026-01-15", reason: "sale", fulfilled: true, saleRef: "SO-1", idempotencyKey: "K1" });
  assert.equal(sale.status, 201); assert.equal(sale.body.movement.costMinor, 6000); // 5 × avg 1,200
  assert.equal((await call("POST", "inventory/issue", { itemId: item.id, qty: 5, date: "2026-01-15", reason: "sale", fulfilled: true, saleRef: "SO-1", idempotencyKey: "K1" })).body.duplicate, true);
  assert.equal(await bal("5200"), 6000);
  assert.equal(await bal("1090"), 18000);
  // negative stock refused and nothing posted
  const neg = await call("POST", "inventory/issue", { itemId: item.id, qty: 100, date: "2026-01-16", reason: "sale", fulfilled: true, saleRef: "SO-2" });
  assert.equal(neg.status, 409); assert.equal(neg.body.code, "INSUFFICIENT_STOCK");
  assert.equal(await bal("1090"), 18000);
  // sales return of 2 units at ORIGINAL cost (2,400)
  const ret = await call("POST", "inventory/return", { movementId: sale.body.movement.id, qty: 2, date: "2026-01-20" });
  assert.equal(ret.body.movement.costMinor, 2400);
  assert.equal((await call("POST", "inventory/return", { movementId: sale.body.movement.id, qty: 4, date: "2026-01-20" })).status, 400); // only 3 left
  // damaged goods → loss expense, not COGS
  assert.equal((await call("POST", "inventory/issue", { itemId: item.id, qty: 1, date: "2026-01-22", reason: "damage" })).status, 201);
  assert.ok((await bal("5210")) > 0);
  // prudence: write down to NRV
  const wd = await call("POST", "inventory/writedown", { itemId: item.id, nrvUnitMinor: 1000, date: "2026-01-31" });
  assert.equal(wd.body.written_down, true);
  const val = (await call("GET", "inventory/valuation")).body;
  assert.equal(val.reconciled, true); assert.equal(val.differenceMinor, 0);
  assert.equal(await tbBalanced(), true);

  // FIFO by effective-dated policy
  assert.equal((await call("POST", "policies", { key: "inventoryMethod", value: "FIFO", effectiveFrom: "2026-06-01", reason: "Adopt FIFO" })).status, 201);
  const b = (await call("POST", "inventory/items", { sku: "FIFO-1", name: "FIFO item" })).body.item;
  await call("POST", "inventory/receive", { itemId: b.id, qty: 10, totalCostMinor: 10000, date: "2026-06-02" });
  await call("POST", "inventory/receive", { itemId: b.id, qty: 10, totalCostMinor: 20000, date: "2026-06-03" });
  const f = await call("POST", "inventory/issue", { itemId: b.id, qty: 15, date: "2026-06-10", reason: "sale", fulfilled: true, saleRef: "SO-9" });
  assert.equal(f.body.movement.method, "FIFO");
  assert.equal(f.body.movement.costMinor, 10000 + 5 * 2000); // oldest layer first
  assert.equal((await call("GET", "inventory/valuation")).body.reconciled, true);
  // purchase return at cost reduces AP
  const pr = await call("POST", "inventory/purchase-return", { itemId: b.id, qty: 2, date: "2026-06-12" });
  assert.equal(pr.status, 201); assert.equal(pr.body.movement.costMinor, 4000);
  assert.equal((await call("GET", "inventory/valuation")).body.reconciled, true);
});

test("Payroll: statutory rules are configuration; run → approve → post → pay; no duplicates", async () => {
  await call("POST", "payroll/employees", { name: "Ama", basicMinor: 200000, allowances: { transport: 20000 } });
  // no rules → refuse (rates are never hard-coded)
  const none = await call("POST", "payroll/runs", { periodYm: "2026-03" });
  assert.equal(none.status, 409); assert.equal(none.body.code, "PAYROLL_RULES_NOT_CONFIGURED");
  // TEST FIXTURE rates only — real PAYE/SSNIT values must be entered from the current statutory schedule
  assert.equal((await call("POST", "payroll/rules", { effectiveFrom: "2026-01-01", employeePensionBps: 550, employerPensionBps: 1300,
    payeBands: [{ upToMinor: 40000, rateBps: 0 }, { upToMinor: 100000, rateBps: 1000 }, { upToMinor: null, rateBps: 2000 }] })).status, 400); // source required
  assert.equal((await call("POST", "payroll/rules", { effectiveFrom: "2026-01-01", employeePensionBps: 550, employerPensionBps: 1300, source: "test fixture",
    payeBands: [{ upToMinor: 40000, rateBps: 0 }, { upToMinor: 100000, rateBps: 1000 }, { upToMinor: null, rateBps: 2000 }] })).status, 201);
  const run = (await call("POST", "payroll/runs", { periodYm: "2026-03" })).body.run;
  const l = run.lines[0];
  assert.equal(l.gross, 220000); assert.equal(l.employeePension, 11000); assert.equal(l.employerPension, 26000);
  assert.equal(l.paye, 27800); assert.equal(l.net, 181200);
  assert.equal((await call("POST", "payroll/runs", { periodYm: "2026-03" })).body.code, "DUPLICATE_RUN");
  assert.equal((await call("POST", `payroll/runs/${run.id}/pay`, { date: "2026-03-31" })).status, 409); // must be approved first
  const ap = await call("POST", `payroll/runs/${run.id}/approve`, { approvedBy: "MD" });
  assert.equal(ap.status, 200);
  assert.equal(await bal("6010"), 220000); assert.equal(await bal("6011"), 26000);
  assert.equal(await bal("2060"), 27800); assert.equal(await bal("2061"), 37000); assert.equal(await bal("2040"), 181200);
  assert.equal((await call("POST", `payroll/runs/${run.id}/approve`, { approvedBy: "MD" })).status, 409);
  const pay = await call("POST", `payroll/runs/${run.id}/pay`, { date: "2026-03-31" });
  assert.equal(pay.status, 200);
  assert.equal(await bal("2040"), 0);
  assert.equal((await call("POST", `payroll/runs/${run.id}/pay`, { date: "2026-03-31" })).status, 409);
  assert.equal(await tbBalanced(), true);
});

test("Year-end blocks on pending FX; restatement pack: materiality, original preserved, opening RE, no duplicate", async () => {
  // fund 2026 and book a sale + expense
  await je("2026-01-02", [{ accountCode: "1010", debit: 5000000 }, { accountCode: "3010", credit: 5000000 }], "capital");
  await je("2026-04-10", [{ accountCode: "1050", debit: 500000 }, { accountCode: "4010", credit: 500000 }], "sale");
  await je("2026-05-10", [{ accountCode: "6400", debit: 100000 }, { accountCode: "1010", credit: 100000 }], "expense");
  // a restatement before the year is closed is refused
  assert.equal((await call("POST", "restatements", { fiscalYear: 2026, adjustments: [{ accountCode: "6400", debit: 1 }, { accountCode: "2030", credit: 1 }], description: "x1x", rootCause: "x1x" })).status, 409);
  const close = await call("POST", "year-end/close", { year: 2026, confirm: "CLOSE_YEAR", reason: "FY2026 close" });
  assert.equal(close.status, 201, JSON.stringify(close.body));
  const origRE = await bal("3040");
  const origPnl = (await call("GET", "pnl?from=2026-01-01&to=2026-12-31")).body.netProfit;
  assert.ok(origPnl > 0);

  // immaterial error (below 5% of revenue) → corrected in current period, not restated
  const small = await call("POST", "restatements", { fiscalYear: 2026, type: "error", description: "Small accrual missed", rootCause: "Cut-off", adjustments: [{ accountCode: "6400", debit: 1000 }, { accountCode: "2030", credit: 1000 }] });
  assert.equal(small.status, 201); assert.equal(small.body.pack.treatment, "current_period_correction");

  // material error: GHS 500 expense missed → retrospective restatement
  const adj = [{ accountCode: "6400", debit: 50000 }, { accountCode: "2030", credit: 50000 }];
  assert.equal((await call("POST", "restatements", { fiscalYear: 2026, description: "x1x", rootCause: "x1x", adjustments: [{ accountCode: "3040", debit: 5 }, { accountCode: "2030", credit: 5 }] })).body.code, "DIRECT_RE_ADJUSTMENT");
  const mk = await call("POST", "restatements", { fiscalYear: 2026, type: "error", description: "Unrecorded rent accrual", rootCause: "Invoice received after close", managementExplanation: "Supplier invoice arrived late", adjustments: adj });
  assert.equal(mk.status, 201);
  const pack = mk.body.pack;
  assert.equal(pack.treatment, "retrospective_restatement");
  assert.equal(pack.materiality.material, true);
  assert.equal(pack.impact.netProfit, -50000);
  assert.equal(pack.impact.liabilities, 50000);
  assert.equal(pack.impact.equity, -50000);
  assert.equal(pack.original.netProfit, origPnl);
  assert.equal(pack.restated.netProfit, origPnl - 50000);
  assert.equal(pack.original.balanced, true); assert.equal(pack.restated.balanced, true);
  assert.equal(pack.openingRetainedEarningsAdjustmentMinor, -50000);
  // cannot post before approval
  assert.equal((await call("POST", `restatements/${pack.id}/post`, { entryDate: "2027-01-05" })).status, 409);
  assert.equal((await call("POST", `restatements/${pack.id}/approve`, { approvedBy: "MD" })).status, 400); // comment required
  assert.equal((await call("POST", `restatements/${pack.id}/approve`, { approvedBy: "MD", comment: "Reviewed with auditor" })).status, 200);
  const posted = await call("POST", `restatements/${pack.id}/post`, { entryDate: "2027-01-05" });
  assert.equal(posted.status, 200);
  const lines = posted.body.journal.lines;
  assert.ok(lines.some((x: any) => x.accountCode === "3040" && x.debit === 50000));   // opening RE, not 6400
  assert.ok(!lines.some((x: any) => x.accountCode === "6400"));
  assert.equal(await bal("3040"), origRE - 50000);
  assert.equal((await call("POST", `restatements/${pack.id}/post`, { entryDate: "2027-01-06" })).status, 409); // no duplicate posting
  // FY2026 as issued is untouched; the stored original snapshot is preserved
  assert.equal((await call("GET", "pnl?from=2026-01-01&to=2026-12-31")).body.netProfit, origPnl);
  assert.equal((await call("GET", `restatements/${pack.id}`)).body.pack.original.netProfit, origPnl);
  assert.equal(await tbBalanced(), true);
});
