import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import { runScheduledTriggers, retryRuns } from "../modules/automation";
import { deps } from "./helpers/harness";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, dir: ReturnType<typeof client>, rep: ReturnType<typeof client>;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  await admin("GET", "/me");
  for (const [email, role] of [["rep@example.com", "sales_rep"], ["dir@example.com", "sales_director"]] as const) await admin("POST", "/members", { email, display_name: email.split("@")[0], role });
  rep = client(db, ident("rep@example.com")); dir = client(db, ident("dir@example.com"));
});
after(async () => { if (db) await db.close(); });

const lead = (n: string, extra = {}) => ({ first_name: n, last_name: "Test", email: `${n.toLowerCase()}@acme.test`, company: `${n} Ltd`, source: "web_form", consent_email: true, ...extra });

test("validation rejects bad rules and circular chains; rep cannot manage rules", { skip }, async () => {
  const bad = await admin("POST", "/automation/rules", { name: "x", trigger: "lead.created", actions: [{ type: "update_field", params: { field: "status_bogus", value: 1 } }] });
  assert.equal(bad.status, 422);
  assert.equal((await rep("POST", "/automation/rules", { name: "Rep rule", trigger: "lead.created", actions: [{ type: "notify", params: { title: "x1" } }] })).status, 403);
  const a = await admin("POST", "/automation/rules", { name: "Assign on lead", trigger: "lead.created", actions: [{ type: "assign", params: { to: "round_robin" } }] });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal((await admin("POST", `/automation/rules/${a.json.id}/activate`)).status, 200);
  const loop = await admin("POST", "/automation/rules", { name: "Loop back", trigger: "lead.assigned", actions: [{ type: "assign", params: { to: "round_robin" } }] });
  assert.equal(loop.status, 422, "a rule that would close a cycle with an active rule is refused");
  assert.match(JSON.stringify(loop.json), /circular/);
});

test("an active rule creates a task and notifies on lead creation, exactly once per event", { skip }, async () => {
  const r = await admin("POST", "/automation/rules", { name: "New lead task", trigger: "lead.created", conditions: [{ field: "source", op: "eq", value: "web_form" }], actions: [{ type: "create_task", params: { subject: "Call {{first_name}} at {{company}}", dueInDays: 1 } }, { type: "notify", params: { title: "New lead {{first_name}}" } }] });
  assert.equal((await admin("POST", `/automation/rules/${r.json.id}/activate`)).status, 200);
  const l = await admin("POST", "/leads", lead("Ada", { owner_id: (await db.query<{ id: number }>("SELECT id FROM sales_members WHERE email = 'rep@example.com'")).rows[0]!.id }));
  assert.equal(l.status, 201, JSON.stringify(l.json));
  const tasks = (await db.query<any>("SELECT subject, owner_id, due_at FROM sales_activities WHERE lead_id = $1 AND created_by = 'Automation'", [l.json.id])).rows;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].subject, "Call Ada at Ada Ltd");
  const runs = await admin("GET", "/automation/runs", undefined, { query: { rule_id: String(r.json.id) } });
  assert.equal(runs.json.items[0].status, "success");
  const notes = (await db.query<any>("SELECT title FROM sales_notifications WHERE title LIKE 'New lead Ada%'")).rows;
  assert.ok(notes.length >= 1);
  // a non-matching lead does not trigger
  const l2 = await admin("POST", "/leads", lead("Bob", { source: "cold" }));
  assert.equal((await db.query("SELECT 1 FROM sales_activities WHERE lead_id = $1", [l2.json.id])).rows.length, 0);
});

test("sensitive rules need a second person; messages are skipped honestly without a provider or consent", { skip }, async () => {
  const r = await admin("POST", "/automation/rules", { name: "Welcome email", trigger: "lead.created", actions: [{ type: "send_message", params: { channel: "email", template: "Hello {{first_name}}" } }] });
  assert.equal(r.status, 201);
  assert.equal((await admin("POST", `/automation/rules/${r.json.id}/activate`)).status, 409, "creator cannot approve their own sensitive rule");
  assert.equal((await dir("POST", `/automation/rules/${r.json.id}/activate`)).status, 200);
  const l = await admin("POST", "/leads", lead("Cleo"));
  const run = (await admin("GET", "/automation/runs", undefined, { query: { rule_id: String(r.json.id) } })).json.items[0];
  assert.equal(run.status, "skipped");
  assert.match(JSON.stringify(run.result), /not connected/);
  assert.equal((await db.query("SELECT 1 FROM sales_outbox WHERE entity_type = 'automation_run'")).rows.length, 0);
  assert.ok(l.json.id);
});

test("editing a rule returns it to draft; dry-run changes nothing; paused rules do not run", { skip }, async () => {
  const r = await admin("POST", "/automation/rules", { name: "Flag priority", trigger: "lead.created", actions: [{ type: "update_field", params: { field: "priority", value: "high" } }] });
  await admin("POST", `/automation/rules/${r.json.id}/activate`);
  const p = await admin("PATCH", `/automation/rules/${r.json.id}`, { name: "Flag priority v2" });
  assert.equal(p.json.status, "draft");
  assert.equal(p.json.version, 2);
  const l = await admin("POST", "/leads", lead("Dan"));
  assert.notEqual((await db.query<any>("SELECT priority FROM sales_leads WHERE id = $1", [l.json.id])).rows[0].priority, "high", "draft rule did not run");
  const dry = await admin("POST", `/automation/rules/${r.json.id}/test`, { entity_id: l.json.id });
  assert.equal(dry.json.dryRun, true);
  assert.notEqual((await db.query<any>("SELECT priority FROM sales_leads WHERE id = $1", [l.json.id])).rows[0].priority, "high");
  await admin("POST", `/automation/rules/${r.json.id}/activate`);
  await admin("POST", `/automation/rules/${r.json.id}/run`, { entity_id: l.json.id });
  assert.equal((await db.query<any>("SELECT priority FROM sales_leads WHERE id = $1", [l.json.id])).rows[0].priority, "high");
  await admin("POST", `/automation/rules/${r.json.id}/pause`);
  const l2 = await admin("POST", "/leads", lead("Eve"));
  assert.notEqual((await db.query<any>("SELECT priority FROM sales_leads WHERE id = $1", [l2.json.id])).rows[0].priority, "high");
});

test("scheduled triggers fire once per day per record; unknown integrations fail permanently and retry is guarded", { skip }, async () => {
  const sla = await admin("POST", "/automation/rules", { name: "SLA breach", trigger: "lead.uncontacted", actions: [{ type: "escalate", params: { to: "director", note: "{{event.reason}}" } }] });
  await admin("POST", `/automation/rules/${sla.json.id}/activate`);
  const l = await admin("POST", "/leads", lead("Fay"));
  await db.query("UPDATE sales_leads SET created_at = now() - interval '3 days' WHERE id = $1", [l.json.id]);
  const n1 = await runScheduledTriggers(db, deps);
  assert.ok(n1 >= 1);
  const count = async () => Number((await db.query<any>("SELECT count(*)::int n FROM sales_automation_runs WHERE rule_id = $1 AND entity_id = $2", [sla.json.id, l.json.id])).rows[0].n);
  assert.equal(await count(), 1);
  await runScheduledTriggers(db, deps);
  assert.equal(await count(), 1, "same day, same record: no second run");
  const runRow = (await db.query<any>("SELECT status, error, result FROM sales_automation_runs WHERE rule_id = $1", [sla.json.id])).rows[0];
  assert.equal(runRow.status, "success", JSON.stringify(runRow));
  assert.ok((await db.query("SELECT 1 FROM sales_notifications WHERE kind = 'escalation'")).rows.length >= 1);

  const ci = await admin("POST", "/automation/rules", { name: "Call CRM", trigger: "lead.created", actions: [{ type: "call_integration", params: { name: "crm.sync" } }] });
  assert.equal((await admin("POST", `/automation/rules/${ci.json.id}/activate`)).status, 409, "creator cannot approve their own integration rule");
  assert.equal((await dir("POST", `/automation/rules/${ci.json.id}/activate`)).status, 200);
  await admin("POST", "/leads", lead("Gus"));
  const run = (await admin("GET", "/automation/runs", undefined, { query: { rule_id: String(ci.json.id) } })).json.items[0];
  assert.equal(run.status, "dead");
  assert.match(run.error, /No integration named/);
  assert.equal(await retryRuns(db, deps), 0, "dead runs are not retried automatically");
});
