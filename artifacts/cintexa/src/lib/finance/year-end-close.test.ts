import test from "node:test";
import assert from "node:assert";
// @ts-ignore – Pages Function module under test (memory mode, same engine the app runs)
import * as mod from "../../../../../functions/api/finance/[[path]].ts";

const env: any = { FIN_ALLOW_MEMORY: "1" };
async function call(method: string, path: string, body?: unknown) {
  const r = await (mod as any).onRequest({
    request: new Request("https://x.dev/api/finance/" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
    env, params: { path: path.split("?")[0].split("/").filter(Boolean) },
  });
  return { status: r.status, body: await r.json() as any };
}
const post = (entryDate: string, lines: [string, number, number][], desc = "t", extra: any = {}) =>
  call("POST", "journals", { entryDate, description: desc, post: true, ...extra, lines: lines.map(([accountCode, debit, credit]) => ({ accountCode, debit, credit })) });

test("year-end close: GHS 5,000 sale, expense, drawings → retained earnings, locked, no duplicate, reopenable", async () => {
  const cap = await post("2026-01-02", [["1010", 1000000, 0], ["3010", 0, 1000000]], "capital");
  assert.equal(cap.status, 201);
  const sale = await post("2026-03-10", [["1050", 500000, 0], ["4010", 0, 500000]], "GHS 5,000 sale");
  assert.equal(sale.status, 201);
  const exp = await post("2026-06-05", [["6400", 150000, 0], ["1010", 0, 150000]], "GHS 1,500 expense");
  assert.equal(exp.status, 201);
  const dr = await post("2026-07-01", [["3060", 100000, 0], ["1010", 0, 100000]], "drawings GHS 1,000");
  assert.equal(dr.status, 201);

  const pre = await call("GET", "year-end/preview?year=2026");
  assert.equal(pre.body.canClose, true);
  assert.equal(pre.body.closing.netResultMinor, 350000);   // 5,000 − 1,500 = 3,500.00
  assert.equal(pre.body.closing.drawingsMinor, 100000);
  assert.equal(pre.body.closing.totals.balanced, true);

  // confirmation + reason are mandatory
  assert.equal((await call("POST", "year-end/close", { year: 2026 })).status, 400);

  const close = await call("POST", "year-end/close", { year: 2026, confirm: "CLOSE_YEAR", reason: "FY2026 close" });
  assert.equal(close.status, 201);
  assert.equal(close.body.postClosing.balanced, true);
  assert.equal(close.body.postClosing.temporaryAccountsZero, true);
  assert.equal(close.body.postClosing.retainedEarnings, 250000); // 3,500 profit − 1,000 drawings

  // P&L for the year still shows the real result (closing entries excluded from activity)
  const pnl = await call("GET", "pnl?from=2026-01-01&to=2026-12-31");
  assert.equal(pnl.body.netProfit, 350000);
  assert.equal(pnl.body.grossRevenue, 500000);
  // Balance sheet balances and counts the profit exactly once
  const bs = await call("GET", "balance-sheet?asOf=2026-12-31");
  assert.equal(bs.body.balanced, true);
  assert.equal(bs.body.equity, 1000000 + 250000);
  // Pre-closing trial balance still shows revenue
  const tbPre = await call("GET", "trial-balance?asOf=2026-12-31&preClosing=1");
  assert.ok(tbPre.body.rows.some((r: any) => r.code === "4010" && r.credit === 500000));
  const tbPost = await call("GET", "trial-balance?asOf=2026-12-31");
  assert.ok(!tbPost.body.rows.some((r: any) => r.code === "4010"));
  assert.equal(tbPost.body.balanced, true);

  // duplicate close blocked, year locked, closing journal protected
  assert.equal((await call("POST", "year-end/close", { year: 2026, confirm: "CLOSE_YEAR", reason: "again" })).status, 409);
  const locked = await post("2026-08-01", [["1010", 100, 0], ["4010", 0, 100]]);
  assert.equal(locked.status, 400);
  assert.match(locked.body.error, /closed/);
  const jid = close.body.journal.id;
  assert.equal((await call("POST", `journals/${jid}/reverse`, {})).status, 409);
  assert.equal((await call("DELETE", `journals/${jid}`, { confirm: "DELETE_JOURNAL" })).status, 409);

  // reopen → books return to pre-close state → can close again once
  const re = await call("POST", "year-end/reopen", { year: 2026, confirm: "REOPEN_YEAR", reason: "late invoice" });
  assert.equal(re.status, 200);
  const tbAfter = await call("GET", "trial-balance?asOf=2026-12-31");
  assert.ok(tbAfter.body.rows.some((r: any) => r.code === "4010" && r.credit === 500000));
  assert.equal((await post("2026-08-01", [["1010", 100, 0], ["4010", 0, 100]], "late sale")).status, 201);
  const again = await call("POST", "year-end/close", { year: 2026, confirm: "CLOSE_YEAR", reason: "re-close" });
  assert.equal(again.status, 201);
  assert.equal(again.body.yearClose.netResultMinor, 350100);
});

test("policy engine: effective-dated, documented, cannot rewrite closed history", async () => {
  const d = await call("GET", "policies?asOf=2027-01-01");
  assert.equal(d.body.inForce.fiscalYearEndMonth.value, "12");
  assert.equal((await call("POST", "policies", { key: "inventoryMethod", value: "LIFO", effectiveFrom: "2027-01-01", reason: "x1x" })).status, 400);
  assert.equal((await call("POST", "policies", { key: "inventoryMethod", value: "FIFO", effectiveFrom: "2027-01-01" })).status, 400); // reason required
  assert.equal((await call("POST", "policies", { key: "inventoryMethod", value: "FIFO", effectiveFrom: "2026-05-01", reason: "backdate" })).status, 409); // closed year
  const ok = await call("POST", "policies", { key: "inventoryMethod", value: "FIFO", effectiveFrom: "2027-01-01", reason: "Adopt FIFO" });
  assert.equal(ok.status, 201);
  assert.equal((await call("GET", "policies?asOf=2026-12-31")).body.inForce.inventoryMethod.value, "WEIGHTED_AVERAGE");
  assert.equal((await call("GET", "policies?asOf=2027-02-01")).body.inForce.inventoryMethod.value, "FIFO");
});

test("depreciation: 25% SL computer posts each month once, never twice, never past cost", async () => {
  const a = await call("POST", "assets", { name: "Laptop", category: "laptop", costMinor: 800000, residualMinor: 0, acquisitionDate: "2027-01-05" });
  assert.equal(a.status, 201);
  assert.equal(a.body.asset.monthlyDepreciationMinor, 16667); // GHC 166.67
  const m1 = await call("POST", "assets/depreciate", { periodYm: "2027-01" });
  assert.equal(m1.body.created.length, 1);
  const m2 = await call("POST", "assets/depreciate", { periodYm: "2027-02" });   // second month must NOT be blocked
  assert.equal(m2.body.created.length, 1);
  const again = await call("POST", "assets/depreciate", { periodYm: "2027-01" }); // same month is idempotent
  assert.equal(again.body.created.length, 0);
  assert.equal(again.body.skipped[0].reason, "already_posted_period");
  const list = await call("GET", "assets");
  assert.equal(list.body.items[0].accumulatedMinor, 33334);
});
