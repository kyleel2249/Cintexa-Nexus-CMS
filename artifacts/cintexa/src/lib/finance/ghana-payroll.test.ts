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
const emp = (name: string, basic: number, extra: any = {}) => call("POST", "payroll/employees", { name, basicMinor: basic, ...extra });
const run = async (periodYm: string, adjustments: any[] = []) => (await call("POST", "payroll/runs", { periodYm, adjustments }));
const line = (r: any, name: string) => r.body.run.lines.find((l: any) => l.name === name);

test("Ghana preset: loads cited, effective-dated rules once; nothing runs before it exists", async () => {
  await emp("Ama", 800000, { allowances: { transport: 400000 } });          // GHS 8,000 basic + 4,000 allowance
  assert.equal((await run("2026-09")).body.code, "PAYROLL_RULES_NOT_CONFIGURED");
  const list = await call("GET", "payroll/presets");
  assert.equal(list.body.items[0].key, "ghana-2026"); assert.equal(list.body.items[0].loaded, false);
  assert.ok(list.body.items[0].sources.some((s: string) => s.includes("gra.gov.gh")));
  const load = await call("POST", "payroll/presets/ghana-2026");
  assert.equal(load.status, 201); assert.equal(load.body.created.length, 2);
  assert.ok(load.body.created[1].source.includes("588"));
  assert.equal(load.body.created[1].effectiveFrom, "2026-09-01");
  const again = await call("POST", "payroll/presets/ghana-2026");
  assert.equal(again.body.created.length, 0); assert.equal(again.body.skipped.length, 2);   // idempotent
  assert.equal((await call("GET", "payroll/rules")).body.items.length, 2);
  assert.equal((await call("GET", "payroll/presets")).body.items[0].loaded, true);
  assert.equal((await run("2025-12")).body.code, "PAYROLL_RULES_NOT_CONFIGURED");           // before the first rule
});

test("Ghana PAYE: old bands to 31 Aug 2026, GRA table from 1 Sep 2026; SSNIT 5.5% / 13% of basic", async () => {
  // GHS 8,000 basic + 4,000 allowance: SSNIT 440 (relief) → chargeable 11,560
  const aug = await run("2026-08");
  const a = line(aug, "Ama");
  assert.equal(a.gross, 1200000); assert.equal(a.employeePension, 44000); assert.equal(a.employerPension, 104000);
  assert.equal(a.taxable, 1156000);
  assert.equal(a.paye, 248850);                          // old bands (490/110/130/3,166.67/16,000…)
  const sep = await run("2026-09");
  const s = line(sep, "Ama");
  assert.equal(s.paye, 249450);                          // 4 + 10 + 507.50 + 25% × (11,560 − 3,668) = GHS 2,494.50
  assert.equal(s.net, 1200000 - 44000 - 249450);
  assert.ok(s.paye > a.paye);                            // the Sept table taxes this salary slightly more, as published
});

test("SSNIT insurable-earnings ceiling and floor apply to both contributions", async () => {
  await emp("Kwame", 8000000);                           // GHS 80,000 basic → insurable capped at 69,000
  await emp("Efua", 55000);                              // GHS 550 basic → treated as GHS 587.80
  const r = await run("2026-10");
  const k = line(r, "Kwame"), e = line(r, "Efua");
  assert.equal(k.insurableBase, 6900000); assert.equal(k.employeePension, 379500); assert.equal(k.employerPension, 897000);
  assert.equal(e.insurableBase, 58780); assert.equal(e.employeePension, 3233); assert.equal(e.employerPension, 7641);
});

test("Bonus: 5% concession up to 15% of annual basic (year-to-date aware); excess is ordinary income", async () => {
  await emp("Yaw", 500000);                              // GHS 5,000 basic → annual basic 60,000 → cap 9,000
  const yawId = (await call("GET", "payroll/employees")).body.items.find((x: any) => x.name === "Yaw").id;
  const nov = await run("2026-11", [{ employeeId: yawId, bonusMinor: 100000 }]);   // GHS 1,000 bonus — fully concessional
  const n = line(nov, "Yaw");
  assert.equal(n.bonusConcession, 100000); assert.equal(n.bonusTax, 5000);
  // chargeable 4,725 → 4 + 10 + 507.50 + 25% × 1,057 = 785.75; + 50 bonus tax = 835.75
  assert.equal(n.paye, 78575 + 5000);
  assert.equal(n.net, 600000 - 27500 - 83575);
  const dec = await run("2026-12", [{ employeeId: yawId, bonusMinor: 1000000 }]);  // GHS 10,000 bonus; 8,000 of cap left
  const d = line(dec, "Yaw");
  assert.equal(d.bonusConcession, 800000); assert.equal(d.bonusTax, 40000);
  assert.equal(d.paye, 128575 + 40000);                  // excess 2,000 taxed at the graduated rates
});

test("Junior overtime concession and non-resident flat rate", async () => {
  await emp("Joe", 100000, { juniorStaff: true });       // GHS 1,000 basic, annual 12,000 ≤ 18,000 limit
  await emp("Nora", 300000, { nonResident: true });
  const joe = (await call("GET", "payroll/employees")).body.items.find((x: any) => x.name === "Joe").id;
  const r = await run("2027-01", [{ employeeId: joe, overtimeMinor: 40000 }]);
  const j = line(r, "Joe"), n = line(r, "Nora");
  assert.equal(j.overtimeTax, 2000);                     // 5% of GHS 400 (below 50% of basic)
  assert.equal(j.paye, 4498 + 2000);                     // overtime kept out of ordinary income
  assert.equal(n.paye, 70875);                           // 25% × (3,000 − 165)
  // rule was due for review by 31 Dec 2026 → the run warns
  assert.ok(r.body.run.warnings.some((w: string) => w.includes("review")));
});

test("Approving a Ghana run posts a balanced journal", async () => {
  const sep = (await call("GET", "payroll/runs")).body.items.find((x: any) => x.periodYm === "2026-09");
  assert.equal((await call("POST", `payroll/runs/${sep.id}/approve`, { approvedBy: "MD" })).status, 200);
  assert.equal((await call("GET", "trial-balance")).body.balanced, true);
});
