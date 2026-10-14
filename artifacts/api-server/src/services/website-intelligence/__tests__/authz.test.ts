/** Ownership and cross-tenant checks on the HTTP router. Needs DATABASE_URL; the express module is replaced by a recorder in the test harness. */
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS } from "@workspace/wi-core";

const enabled = Boolean(process.env.DATABASE_URL);
const t = (name: string, fn: () => Promise<void>) => (enabled ? test(name, { timeout: 60_000 }, fn) : test.skip(name, fn));

async function call(method: string, path: string, auth: { sub: string; role: string; email?: string } | null, params: Record<string, string> = {}, body: unknown = {}, query: Record<string, string> = {}) {
  const { routes } = (await import("express")) as unknown as { routes: { method: string; path: string; handler: (q: any, s: any) => any }[] };
  await import("../../../routes/website-audits");
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} registered`);
  let status = 200; let payload: any;
  const res: any = { status(c: number) { status = c; return res; }, json(b: unknown) { payload = b; return res; }, end() { return res; }, setHeader() {} };
  await r!.handler({ auth, params, body, query, headers: {} }, res);
  return { status, payload };
}

t("a user cannot read, cancel, delete, patch or share another user's audit; admins can read", async () => {
  const store = await import("../store");
  const { normalizeConfig } = await import("../config");
  const cfg = normalizeConfig({ url: "https://example.com", authorization: { confirmed: true } }, DEFAULT_LIMITS, { userEmail: "owner@x.y", allowAuthenticated: false }).cfg!;
  const a = await store.createAudit({ ownerId: "owner-1", ownerEmail: "owner@x.y", hostname: "example.com", cfg });
  const owner = { sub: "owner-1", role: "editor" }; const other = { sub: "other-2", role: "editor" }; const admin = { sub: "adm", role: "admin" };
  assert.equal((await call("GET", "/:id", owner, { id: a.id })).status, 200);
  assert.equal((await call("GET", "/:id", admin, { id: a.id })).status, 200);
  for (const [m, p] of [["GET", "/:id"], ["GET", "/:id/bundle"], ["GET", "/:id/events"], ["POST", "/:id/cancel"], ["POST", "/:id/retry"], ["DELETE", "/:id"], ["GET", "/:id/findings"], ["PATCH", "/:id/findings/:fp"], ["GET", "/:id/recommendations"], ["POST", "/:id/tasks"], ["GET", "/:id/report"], ["POST", "/:id/share"], ["POST", "/:id/retest"], ["GET", "/:id/comparison"]] as const) {
    const r = await call(m, p, other, { id: a.id, fp: "x" });
    assert.equal(r.status, 404, `${m} ${p} must not reveal another tenant's audit (got ${r.status})`);
  }
  const list = await call("GET", "/", other);
  assert.equal(list.payload.items.some((x: any) => x.id === a.id), false);
  const stats = await call("GET", "/stats", other);
  assert.equal(stats.payload.total, 0);
  assert.equal((await call("PUT", "/settings", other, {}, {})).status, 403);
  assert.equal((await call("GET", "/settings", owner)).status, 403);
});

t("creating an audit validates scope: private targets and missing authorization are rejected before anything is stored", async () => {
  const store = await import("../store");
  const before = (await store.listAudits({ ownerId: "u9", admin: false })).total;
  const u = { sub: "u9", role: "editor", email: "u9@x.y" };
  assert.equal((await call("POST", "/", u, {}, { url: "http://169.254.169.254/", authorization: { confirmed: true } })).status, 400);
  assert.equal((await call("POST", "/", u, {}, { url: "https://example.com" })).status, 400);
  assert.equal((await call("POST", "/", u, {}, { url: "https://example.com", authorization: { confirmed: true }, authenticated: { enabled: true, confirmed: true, allowedPathPrefixes: ["/a/"], credential: "x" } })).status, 400);
  assert.equal((await store.listAudits({ ownerId: "u9", admin: false })).total, before);
});

t("public share endpoint exposes no notes, owner or e-mail, and revocation closes it", async () => {
  const store = await import("../store");
  const { normalizeConfig } = await import("../config");
  const cfg = normalizeConfig({ url: "https://example.com", authorization: { confirmed: true } }, DEFAULT_LIMITS, { userEmail: "owner@x.y", allowAuthenticated: false }).cfg!;
  const a = await store.createAudit({ ownerId: "owner-3", ownerEmail: "owner3@x.y", hostname: "example.com", cfg });
  await store.patchAudit(a.id, { status: "completed", completedAt: new Date() });
  const owner = { sub: "owner-3", role: "editor", email: "owner3@x.y" };
  const s = await call("POST", "/:id/share", owner, { id: a.id });
  assert.equal(s.status, 201);
  const pub = await call("GET", "/public/:token", null, { token: s.payload.token });
  assert.equal(pub.status, 200);
  const text = JSON.stringify(pub.payload);
  assert.ok(!text.includes("owner3@x.y"));
  assert.equal(pub.payload.audit.ownerId, "");
  await call("DELETE", "/:id/share", owner, { id: a.id });
  assert.equal((await call("GET", "/public/:token", null, { token: s.payload.token })).status, 404);
});
