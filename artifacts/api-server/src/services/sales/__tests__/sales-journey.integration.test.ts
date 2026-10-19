import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import type { Db } from "../core/types";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>;
let repA: ReturnType<typeof client>;
let repB: ReturnType<typeof client>;
let outsider: ReturnType<typeof client>;
let repAId = 0;
let repBId = 0;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  const me = await admin("GET", "/me");
  assert.equal(me.status, 200, JSON.stringify(me.json));
  const a = await admin("POST", "/members", { email: "rep.a@example.com", display_name: "Rep A", role: "sales_rep" });
  const b = await admin("POST", "/members", { email: "rep.b@example.com", display_name: "Rep B", role: "sales_rep" });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  repAId = a.json.id; repBId = b.json.id;
  repA = client(db, ident("rep.a@example.com"));
  repB = client(db, ident("rep.b@example.com"));
  outsider = client(db, ident("nobody@example.com"));
});
after(async () => { if (db) await db.close(); });

test("unmapped users and API keys are denied", { skip }, async () => {
  assert.equal((await outsider("GET", "/leads")).status, 403);
  const key = client(db, { sub: "k", email: "", platformRole: "api", isApiKey: true });
  assert.equal((await key("GET", "/leads")).status, 403);
  const anon = client(db, undefined);
  assert.equal((await anon("GET", "/leads")).status, 401);
});

test("lead lifecycle: create → duplicate guard → touch → qualify → convert (once)", { skip }, async () => {
  const c = await repA("POST", "/leads", { first_name: "Ama", last_name: "Mensah", email: "ama@acme-gh.com", phone: "+233201234567", company: "Acme Ghana Ltd", job_title: "CEO", source: "referral", estimated_value: "25000.00" });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const id = c.json.id;
  assert.ok(c.json.score > 40, `score ${c.json.score}`);
  assert.equal(c.json.ownerId, repAId); // a sole rep owns what they create under manual assignment

  const dup = await repA("POST", "/leads", { first_name: "Ama", email: "AMA@acme-gh.com" });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, "possible_duplicate");

  const noContact = await repA("POST", "/leads", { first_name: "Nobody" });
  assert.equal(noContact.status, 422);

  assert.equal((await repA("POST", `/leads/${id}/convert`, {})).status, 422); // not qualified yet
  assert.equal((await repA("POST", `/leads/${id}/status`, { status: "qualified" })).status, 200);
  const t = await repA("POST", `/leads/${id}/touch`, { channel: "call", subject: "Intro call", notes: "Interested" });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const dq = await repA("POST", `/leads/${id}/status`, { status: "disqualified" });
  assert.equal(dq.status, 422, "disqualification needs a reason");

  const key = "convert-key-0001";
  const conv = await repA("POST", `/leads/${id}/convert`, { opportunity_amount: "25000.00", expected_close_date: "2030-01-31" }, { headers: { "idempotency-key": key } });
  assert.equal(conv.status, 200, JSON.stringify(conv.json));
  assert.ok(conv.json.accountId && conv.json.opportunityId);
  const replay = await repA("POST", `/leads/${id}/convert`, { opportunity_amount: "25000.00", expected_close_date: "2030-01-31" }, { headers: { "idempotency-key": key } });
  assert.equal(replay.headers?.["idempotent-replay"], "true");
  assert.equal(replay.json.accountId, conv.json.accountId);
  const again = await repA("POST", `/leads/${id}/convert`, {});
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "already_converted");

  const accts = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_accounts")).rows[0]!.n;
  const opps = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_opportunities")).rows[0]!.n;
  assert.equal(accts, 1);
  assert.equal(opps, 1);
});

test("IDOR: another rep cannot see, edit or convert a lead they do not own", { skip }, async () => {
  const c = await repA("POST", "/leads", { first_name: "Kofi", email: "kofi@beta.com", company: "Beta" });
  const id = c.json.id;
  assert.equal((await repB("GET", `/leads/${id}`)).status, 404);
  assert.equal((await repB("PATCH", `/leads/${id}`, { first_name: "X" })).status, 404);
  assert.equal((await repB("POST", `/leads/${id}/touch`, { channel: "call", subject: "hello" })).status, 404);
  const list = await repB("GET", "/leads");
  assert.ok(!list.json.items.some((l: any) => l.id === id));
  assert.equal((await repB("POST", `/leads/${id}/assign`, { owner_id: repBId })).status, 403); // reps cannot reassign
  assert.equal((await admin("POST", `/leads/${id}/assign`, { owner_id: repBId, reason: "balance" })).status, 200);
  assert.equal((await repB("GET", `/leads/${id}`)).status, 200);
  assert.equal((await repA("GET", `/leads/${id}`)).status, 404);
});

test("claim: only unassigned leads, exactly once", { skip }, async () => {
  const pub = await admin("POST", "/leads", { first_name: "Pool", email: "pool@x.com", company: "PoolCo", owner_id: undefined });
  const id = pub.json.id;
  await db.query("UPDATE sales_leads SET owner_id = NULL WHERE id = $1", [id]);
  const [x, y] = await Promise.all([repA("POST", `/leads/${id}/claim`), repB("POST", `/leads/${id}/claim`)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
});

test("public lead form: consent, honeypot, no duplicate disclosure", { skip }, async () => {
  const f = await admin("POST", "/lead-forms", { name: "Website" });
  assert.equal(f.status, 201);
  const anon = client(db, undefined, { ip: "203.0.113.9" });
  const path = `/public/lead-forms/${f.json.token}/submit`;
  assert.equal((await anon("POST", path, { first_name: "Web", email: "web@x.com" })).status, 422); // consent
  assert.equal((await anon("POST", path, { first_name: "Web", email: "web@x.com", consent: true })).status, 201);
  const before = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_leads WHERE lower(email) = 'web@x.com'")).rows[0]!.n;
  assert.equal(before, 1);
  assert.equal((await anon("POST", path, { first_name: "Web", email: "web@x.com", consent: true })).status, 201); // repeat looks identical
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_leads WHERE lower(email) = 'web@x.com'")).rows[0]!.n, 1);
  assert.equal((await anon("POST", path, { first_name: "Bot", email: "bot@x.com", consent: true, website: "http://spam" })).status, 200);
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_leads WHERE lower(email) = 'bot@x.com'")).rows[0]!.n, 0);
  assert.equal((await anon("POST", "/public/lead-forms/nope/submit", { first_name: "x", email: "x@x.com", consent: true })).status, 404);
  assert.equal((await anon("GET", "/leads")).status, 401, "public flag must not leak to other routes");
});

test("pipeline: required fields, stage moves, close won/lost, authorisation", { skip }, async () => {
  const acct = await admin("POST", "/accounts", { name: "Pipeline Test Co" });
  assert.equal(acct.status, 201, JSON.stringify(acct.json));
  const o = await admin("POST", "/opportunities", { name: "Big deal", account_id: acct.json.id, amount: "1000.50", expected_close_date: "2030-06-30" });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const board = await admin("GET", "/pipeline/board");
  assert.equal(board.status, 200);
  const stages = board.json.columns.map((c: any) => c.stage);
  const proposal = stages.find((s: any) => s.name === "Proposal");
  const neg = stages.find((s: any) => s.name === "Negotiation");
  const mv = await admin("POST", `/opportunities/${o.json.id}/move`, { stage_id: neg.id });
  assert.equal(mv.status, 422, "next_action is required for Negotiation");
  assert.equal(mv.json.code, "required_fields_missing");
  assert.equal((await admin("PATCH", `/opportunities/${o.json.id}`, { next_action: "Send contract" })).status, 200);
  assert.equal((await admin("POST", `/opportunities/${o.json.id}/move`, { stage_id: proposal.id })).status, 200);
  assert.equal((await admin("POST", `/opportunities/${o.json.id}/move`, { stage_id: neg.id })).status, 200);
  const fin = board.json.finalStages;
  const lost = fin.find((s: any) => s.kind === "lost");
  const won = fin.find((s: any) => s.kind === "won");
  assert.equal((await admin("POST", `/opportunities/${o.json.id}/move`, { stage_id: lost.id })).status, 422, "lost reason required");
  assert.equal((await repB("POST", `/opportunities/${o.json.id}/move`, { stage_id: won.id })).status, 404); // not owner
  const w = await admin("POST", `/opportunities/${o.json.id}/move`, { stage_id: won.id });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(w.json.status, "won");
  assert.match(w.json.note, /does not create an invoice/);
  assert.equal((await admin("PATCH", `/opportunities/${o.json.id}`, { amount: "5.00" })).status, 409);
  const detail = await admin("GET", `/opportunities/${o.json.id}`);
  assert.ok(detail.json.history.length >= 4);
  assert.equal(detail.json.opportunity.amount, "1000.50");
});

test("audit log is append-only", { skip }, async () => {
  await assert.rejects(() => db.query("UPDATE sales_audit_events SET summary = 'x'"));
  await assert.rejects(() => db.query("DELETE FROM sales_audit_events"));
  const n = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_audit_events WHERE action = 'lead.convert'")).rows[0]!.n;
  assert.ok(n >= 1);
});
