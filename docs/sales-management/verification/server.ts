import { openDb, resetDb, client, ident, deps, router } from "/home/claude/cintexa-nexus-cms/artifacts/api-server/src/services/sales/__tests__/helpers/harness";
import { dispatch } from "/home/claude/cintexa-nexus-cms/artifacts/api-server/src/services/sales/core/router";
const E = import.meta.dir;
const db = await openDb();
await resetDb(db);
const admin = client(db, ident("boss@example.com", "admin"));
const must = async (p: Promise<any>, what: string) => { const r = await p; if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
await must(admin("GET", "/me"), "me");
const rep = await must(admin("POST", "/members", { email: "rep@example.com", display_name: "Rita Rep", role: "sales_rep" }), "rep");
const acc = await must(admin("POST", "/accounts", { name: "Acme Ghana Ltd", email: "info@acme.gh", industry: "Retail", country: "GH" }), "acc");
const acc2 = await must(admin("POST", "/accounts", { name: "Beta Foods", email: "hi@beta.com" }), "acc2");
await must(admin("POST", "/contacts", { account_id: acc.accountId ?? acc.id, first_name: "Ama", last_name: "Mensah", email: "ama@acme.gh" }), "contact");
const prod = await must(admin("POST", "/products", { sku: "W-1", name: "Widget", base_price: "100.00", cost_price: "40.00" }), "prod");
const lead = await must(admin("POST", "/leads", { first_name: "Kofi", last_name: "Boateng", email: "kofi@lead.com", company: "Lead Co", source: "referral", estimated_value: "5000.00" }), "lead");
await must(admin("POST", "/leads", { first_name: "Efua", email: "efua@lead.com", company: "Second Co" }), "lead2");
const q = await must(admin("POST", "/quotations", { account_id: acc.accountId ?? acc.id, lines: [{ product_id: prod.id, quantity: 3 }] }), "quote");
const o = await must(admin("POST", "/orders", { account_id: acc2.accountId ?? acc2.id, lines: [{ product_id: prod.id, quantity: 2 }] }), "order");
await admin("POST", `/orders/${o.id}/confirm`, {});
await must(admin("POST", "/campaigns", { name: "Spring Push", channel: "email", utm_campaign: "spring" }), "campaign");
const comp = await must(admin("POST", "/competitors", { name: "RivalCo", positioning: "Cheap" }), "comp");
await must(admin("POST", `/competitors/${comp.id}/intel`, { kind: "pricing", title: "Cut prices", content: "10% cut", source: "Call", observed_on: "2026-10-01" }), "intel");
await must(admin("POST", "/playbook", { title: "Discovery script", kind: "script", body: "Ask open questions.", is_training: true }), "pb");
const per = await must(admin("POST", "/target-periods", { name: "FY2026", kind: "year", starts_on: "2026-01-01", ends_on: "2026-12-31" }), "period");
await admin("POST", "/lead-forms", { name: "Website contact" });
const forms = (await admin("GET", "/lead-forms")).json.items;
const send = await admin("POST", `/quotations/${q.id}/submit`, {});
const seed = { lead: lead.id, acc: acc.accountId ?? acc.id, prod: prod.id, quote: q.id, order: o.id, formToken: forms[0]?.token, comp: comp.id, rep: rep.id, send: send.status };
console.log("seeded", JSON.stringify(seed));

Bun.serve({
  port: 4577,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/dist/entry.js") return new Response(Bun.file(E + "/dist/entry.js"));
    if (url.pathname === "/dist/app.css") return new Response(Bun.file(E + "/dist/app.css"), { headers: { "content-type": "text/css" } });
    if (url.pathname === "/__seed") return Response.json(seed);
    if (url.pathname.startsWith("/api/sales")) {
      const path = url.pathname.slice("/api/sales".length) || "/";
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.json().catch(() => undefined);
      const query: Record<string, string> = {}; url.searchParams.forEach((v, k) => (query[k] = v));
      const headers: Record<string, string> = {}; req.headers.forEach((v, k) => (headers[k] = v));
      const who = req.headers.get("x-test-user") ?? "boss@example.com";
      const auth = path.startsWith("/public/") ? undefined : who === "anon" ? undefined : ident(who, who.startsWith("boss") ? "admin" : "editor");
      const r = await dispatch(router, db, deps, { method: req.method, path, query, body, headers, auth, ip: "10.0.0.9" });
      if (r.raw) return new Response(r.raw.data, { status: r.status, headers: { "content-type": r.raw.contentType, ...(r.raw.filename ? { "content-disposition": `attachment; filename="${r.raw.filename}"` } : {}) } });
      return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
    }
    return new Response('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/dist/app.css"></head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/dist/entry.js"></script></body></html>', { headers: { "content-type": "text/html" } });
  },
});
console.log("listening");
