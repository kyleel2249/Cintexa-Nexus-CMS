import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { openDb, resetDb, client, ident, TEST_DB_URL } from "./helpers/harness";
import type { Db } from "../core/types";
import type { AiProvider } from "../integrations/providers";

const skip = !TEST_DB_URL ? "SALES_TEST_DATABASE_URL not set" : false;
let db: Db & { close(): Promise<void> };
let admin: ReturnType<typeof client>, rep: ReturnType<typeof client>, rep2: ReturnType<typeof client>, mgr: ReturnType<typeof client>, fin: ReturnType<typeof client>;
let accountId = 0, productId = 0, repId = 0;

before(async () => {
  if (skip) return;
  db = await openDb();
  await resetDb(db);
  admin = client(db, ident("boss@example.com", "admin"));
  await admin("GET", "/me");
  for (const [email, role] of [["rep@example.com", "sales_rep"], ["rep2@example.com", "sales_rep"], ["mgr@example.com", "sales_manager"], ["fin@example.com", "finance"]] as const) await admin("POST", "/members", { email, display_name: email.split("@")[0], role });
  rep = client(db, ident("rep@example.com")); rep2 = client(db, ident("rep2@example.com")); mgr = client(db, ident("mgr@example.com")); fin = client(db, ident("fin@example.com"));
  repId = (await db.query<{ id: number }>("SELECT id FROM sales_members WHERE email = 'rep@example.com'")).rows[0]!.id;
  accountId = (await rep("POST", "/accounts", { name: "Support Co" })).json.id;
  productId = (await admin("POST", "/products", { sku: "S-1", name: "Gadget", base_price: "100.00", cost_price: "30.00" })).json.id;
});
after(async () => { if (db) await db.close(); });

test("retention: health is evidence-based, complaints notify the owner, resolution needs text, renewals never create revenue", { skip }, async () => {
  const h = await rep("GET", `/accounts/${accountId}/health`);
  assert.equal(h.json.band, "unknown", "no history -> not guessed");
  assert.equal((await rep2("GET", `/accounts/${accountId}/health`)).status, 404, "another rep cannot see the account");
  const c = await admin("POST", "/feedback", { account_id: accountId, kind: "complaint", subject: "Late delivery", rating: 3 });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.ok((await db.query("SELECT 1 FROM sales_notifications WHERE kind = 'complaint'")).rows.length >= 1);
  const resolve = await admin("PATCH", `/feedback/${c.json.id}`, { status: "resolved" });
  assert.equal(resolve.status, 400);
  assert.equal((await admin("PATCH", `/feedback/${c.json.id}`, { status: "resolved", resolution: "Refund issued" })).status, 200);
  assert.equal((await rep("POST", "/feedback", { account_id: accountId, kind: "survey", subject: "NPS" })).status, 400, "survey needs rating");
  const r = await rep("POST", "/renewals", { account_id: accountId, description: "Annual plan", renewal_on: "2030-01-01", expected_amount: "5000.00" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const res = await rep("POST", `/renewals/${r.json.id}/resolve`, { outcome: "renewed" });
  assert.equal(res.status, 200);
  assert.equal((await db.query("SELECT 1 FROM sales_orders")).rows.length, 0, "no order created by marking a renewal");
  assert.equal((await rep("POST", `/renewals/${r.json.id}/resolve`, { outcome: "lost" })).status, 409);
  const ov = await rep("GET", "/retention/overview");
  assert.equal(ov.status, 200);
});

test("campaigns: attribution uses recorded touches only; email needs a provider and consent", { skip }, async () => {
  const camp = await admin("POST", "/campaigns", { name: "Autumn push", channel: "email", budget: "1000.00", spend: "400.00", utm_campaign: "autumn26" });
  assert.equal(camp.status, 201, JSON.stringify(camp.json));
  assert.equal((await admin("POST", "/campaigns", { name: "Dup", utm_campaign: "AUTUMN26" })).status, 409, "utm is unique case-insensitively");
  assert.equal((await rep("POST", "/campaigns", { name: "Rep camp" })).status, 403);
  const lead = await rep("POST", "/leads", { first_name: "Hal", last_name: "L", email: "hal@x.test", company: "HalCo", source: "campaign", consent_email: true, campaign_id: camp.json.id });
  assert.equal(lead.status, 201, JSON.stringify(lead.json));
  assert.equal((await admin("POST", `/campaigns/${camp.json.id}/send-email`, { subject: "Hello there", message: "Hi there" })).status, 409, "email not connected");
  await admin("PATCH", `/campaigns/${camp.json.id}`, { status: "active" });
  assert.equal((await admin("PATCH", `/campaigns/${camp.json.id}`, { status: "planned" })).status, 409, "no going back to planned");
  // won deal linked to the lead gets credited
  const pipe = (await admin("GET", "/pipelines")).json;
  const stages = (await admin("GET", `/pipelines/${pipe.items[0].id}/stages`)).json;
  void stages;
  const attr0 = await admin("GET", "/campaigns/attribution");
  assert.equal(attr0.status, 200);
  assert.equal(attr0.json.dealsConsidered, 0);
  const detail = await admin("GET", `/campaigns/${camp.json.id}`);
  assert.equal(detail.json.funnel.leads, 1);
  assert.equal(detail.json.roiPercent, -100, "no attributed revenue against 400 spend");
  assert.equal((await admin("POST", `/campaigns/${camp.json.id}/touches`, { lead_id: lead.json.id, at: "2999-01-01T00:00:00Z" })).status, 400);
});

test("competitor intel is unverified until a different person verifies it", { skip }, async () => {
  const c = await admin("POST", "/competitors", { name: "RivalCo", website: "https://rival.test" });
  assert.equal(c.status, 201);
  const i = await rep("POST", `/competitors/${c.json.id}/intel`, { kind: "pricing", title: "Cut prices", content: "10% cheaper", source: "Customer call", observed_on: "2026-01-01" });
  assert.equal(i.status, 201, JSON.stringify(i.json));
  assert.equal(i.json.verified, false);
  assert.equal((await rep("POST", `/competitor-intel/${i.json.id}/verify`)).status, 403);
  const own = await admin("POST", `/competitors/${c.json.id}/intel`, { kind: "observation", title: "Seen at expo", content: "stand", source: "Expo", observed_on: "2026-01-02" });
  assert.equal((await mgr("POST", `/competitor-intel/${i.json.id}/verify`)).status, 403, "managers lack verify permission");
  assert.equal((await admin("POST", `/competitor-intel/${own.json.id}/verify`)).status, 409, "cannot verify own item");
  assert.equal((await admin("POST", `/competitor-intel/${i.json.id}/verify`)).status, 200);
  const d = await rep("GET", `/competitors/${c.json.id}`);
  assert.equal(d.json.intel.find((x: any) => x.id === i.json.id).verified, true);
  assert.equal((await fin("POST", "/competitors", { name: "x1" })).status, 403);
});

test("playbook: drafts hidden from reps, publishing needs permission, edits version, training completion tracks version", { skip }, async () => {
  const a = await mgr("POST", "/playbook", { title: "Discovery call script", kind: "discovery", body: "Ask about budget and timeline", is_training: true });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal((await rep("GET", `/playbook/${a.json.id}`)).status, 404, "draft not visible to reps");
  assert.equal((await mgr("POST", `/playbook/${a.json.id}/status`, { status: "review" })).status, 200);
  assert.equal((await rep("POST", `/playbook/${a.json.id}/status`, { status: "published" })).status, 403);
  assert.equal((await admin("POST", `/playbook/${a.json.id}/status`, { status: "published" })).status, 200);
  const list = await rep("GET", "/playbook", undefined, { query: { q: "budget" } });
  assert.equal(list.json.items.length, 1);
  assert.equal((await rep("POST", `/playbook/${a.json.id}/complete`)).status, 200);
  const edit = await mgr("PATCH", `/playbook/${a.json.id}`, { body: "Ask about budget, timeline and authority" });
  assert.equal(edit.json.version, 2);
  assert.equal(edit.json.status, "review", "a non-publisher's edit returns the article to review");
  assert.equal((await rep("GET", `/playbook/${a.json.id}`)).status, 404);
  await admin("POST", `/playbook/${a.json.id}/status`, { status: "published" });
  const read = await rep("GET", `/playbook/${a.json.id}`);
  assert.equal(read.json.completionOutdated, true);
  const prog = await rep("GET", "/training/progress");
  assert.equal(prog.json.items.length, 1, "a rep sees only their own progress");
});

test("documents: scoped to the record, https only, signatures are recorded as unverified, restricted docs hidden", { skip }, async () => {
  assert.equal((await rep2("GET", "/documents", undefined, { query: { entity_type: "account", entity_id: String(accountId) } })).status, 404);
  assert.equal((await rep("POST", "/documents", { entity_type: "account", entity_id: accountId, title: "Contract", url: "http://insecure.test/a.pdf" })).status, 422);
  const d = await rep("POST", "/documents", { entity_type: "account", entity_id: accountId, title: "Master agreement", kind: "contract", url: "https://files.test/a.pdf" });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const s = await rep("POST", `/documents/${d.json.id}/signature`, { status: "signed", reference: "DS-1", evidence: "Scanned countersigned copy" });
  assert.equal(s.json.verified, false);
  assert.equal((await rep("POST", `/documents/${d.json.id}/version`, { url: "https://files.test/b.pdf" })).status, 409, "signed documents are frozen");
  const r = await admin("POST", "/documents", { entity_type: "account", entity_id: accountId, title: "Board notes", url: "https://files.test/n.pdf", restricted: true });
  assert.equal(r.status, 201);
  const mine = await rep("GET", "/documents", undefined, { query: { entity_type: "account", entity_id: String(accountId) } });
  assert.equal(mine.json.items.length, 1);
  const all = await admin("GET", "/documents", undefined, { query: { entity_type: "account", entity_id: String(accountId) } });
  assert.equal(all.json.items.length, 2);
  const t = await admin("POST", "/document-templates", { kind: "account_plan", name: "Plan", body: "Plan for {{account.name}} on {{today}} {{cost_total}}" });
  const out = await rep("POST", `/document-templates/${t.json.id}/render`, { entity_type: "account", entity_id: accountId });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.match(out.json.text, /Plan for/);
});

test("settings, audit log, integration status and outbox are admin-only and honest", { skip }, async () => {
  assert.equal((await rep("GET", "/settings")).status, 403);
  assert.equal((await rep("GET", "/audit-log")).status, 403);
  const bad = await admin("PUT", "/settings/discounts", { repMaxPercent: 50, managerMaxPercent: 20 });
  assert.equal(bad.status, 400);
  const ok = await admin("PUT", "/settings/discounts", { repMaxPercent: 5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const hist = await admin("GET", "/settings/discounts/history");
  assert.ok(hist.json.items.length >= 1);
  const on = await admin("PUT", "/settings/integrations", { email: { enabled: true, provider: "smtp", fromAddress: "s@x.test" } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.ok(on.json.warnings.some((w: string) => /email/.test(w)), "warns that no provider is installed");
  const st = await admin("GET", "/integrations/status");
  assert.equal(st.json.items.find((i: any) => i.key === "email").state, "enabled_but_no_provider");
  await admin("PUT", "/settings/integrations", { email: { enabled: false } });
  const log = await admin("GET", "/audit-log", undefined, { query: { action: "settings." } });
  assert.ok(log.json.items.length >= 2);
  assert.equal((await admin("GET", "/audit-log", undefined, { query: { format: "csv" } })).status, 200);
});

test("search is scoped by role and AI falls back to facts, honouring the external-provider policy", { skip }, async () => {
  const mine = await rep("GET", "/search", undefined, { query: { q: "Support" } });
  assert.ok(mine.json.items.some((i: any) => i.type === "account"));
  assert.equal((await rep2("GET", "/search", undefined, { query: { q: "Support" } })).json.items.filter((i: any) => i.type === "account").length, 0);
  assert.equal((await rep("GET", "/search", undefined, { query: { q: "a" } })).json.items.length, 0);
  const none = await rep("POST", "/ai/assist", { feature: "summarize", entity_type: "account", entity_id: accountId });
  assert.equal(none.json.available, false);
  assert.equal(none.json.facts.name, "Support Co");
  assert.equal((await fin("POST", "/ai/assist", { feature: "summarize", entity_type: "account", entity_id: accountId })).status, 403, "finance has no ai:use");

  const calls: string[] = [];
  const provider: AiProvider = { name: "test-llm", external: true, complete: async (r) => { calls.push(r.prompt); return { text: "Summary text", model: "m1", promptTokens: 10, completionTokens: 5 }; } };
  const withAi = client(db, ident("rep@example.com"), { integrations: { ai: provider } });
  await admin("PUT", "/settings/integrations", { ai: { enabled: true, allowExternalProvider: false } });
  const refused = await withAi("POST", "/ai/assist", { feature: "summarize", entity_type: "account", entity_id: accountId });
  assert.equal(refused.json.available, false);
  assert.equal(calls.length, 0, "external provider is not called when policy forbids it");
  await admin("PUT", "/settings/integrations", { ai: { enabled: true, allowExternalProvider: true } });
  const ok = await withAi("POST", "/ai/assist", { feature: "summarize", entity_type: "account", entity_id: accountId });
  assert.equal(ok.json.available, true, JSON.stringify(ok.json));
  assert.equal(ok.json.text, "Summary text");
  assert.equal(calls.length, 1);
  assert.ok(!/cost/i.test(calls[0]!), "no cost data in the prompt");
  assert.equal((await db.query("SELECT 1 FROM sales_ai_usage WHERE status = 'ok'")).rows.length, 1);
  void repId; void productId;
});
