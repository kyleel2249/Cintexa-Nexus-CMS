import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { memoryDb } from "./helpers/pg";
import { handleSentinelRequest, resetRateLimits } from "../router";
import type { Db, SkRequest } from "../types";
import { CREDENTIAL_TYPES } from "../types";

const A = { ownerId: "user-a" };
const B = { ownerId: "user-b" };
const IV = "AAAAAAAAAAAAAAAA"; // 12 bytes
const ct = (s: string) => Buffer.from(`ENC:${s}:${"x".repeat(24)}`).toString("base64"); // stands in for client-side ciphertext
const PLAINTEXT = "P@ssw0rd-SECRET-VALUE-9f3a";

async function setup() {
  resetRateLimits();
  const { db, pg } = await memoryDb();
  const call = async (identity: typeof A | undefined, method: string, path: string, body?: unknown, query?: SkRequest["query"], isApiKey = false) =>
    handleSentinelRequest(db, { method, path, body, query, identity, isApiKey });
  const mkAlias = async (who = A, name = `Alias ${randomUUID().slice(0, 6)}`) => { const r = await call(who, "POST", "/aliases", { id: randomUUID(), name }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as any; };
  const generate = async (who: typeof A, aliasId: string, type = "password", settings: any = { length: 24 }) => {
    const eventId = randomUUID(), entryId = randomUUID();
    const b = await call(who, "POST", "/generations", { eventId, aliasId, type, settings });
    const c = await call(who, "POST", `/generations/${eventId}/commit`, { entryId, iv: IV, ciphertext: ct(PLAINTEXT), encVersion: 1 });
    return { eventId, entryId, begin: b, commit: c };
  };
  return { db, pg, call, mkAlias, generate };
}

test("every credential type requires an alias", async () => {
  const { call, mkAlias } = await setup();
  const al = await mkAlias();
  for (const type of CREDENTIAL_TYPES) {
    const none = await call(A, "POST", "/generations", { eventId: randomUUID(), type });
    assert.equal(none.status, 400, `${type} without alias`);
    const junk = await call(A, "POST", "/generations", { eventId: randomUUID(), type, aliasId: "not-a-uuid" });
    assert.equal(junk.status, 400);
    const unknown = await call(A, "POST", "/generations", { eventId: randomUUID(), type, aliasId: randomUUID() });
    assert.equal(unknown.status, 404);
    const ok = await call(A, "POST", "/generations", { eventId: randomUUID(), type, aliasId: al.id });
    assert.equal(ok.status, 201, `${type} with alias`);
  }
  assert.equal((await call(A, "POST", "/generations", { eventId: randomUUID(), type: "nope", aliasId: al.id })).status, 400);
});

test("a successful generation is saved to both vault and history under the same alias id", async () => {
  const { call, mkAlias, generate } = await setup();
  const al = await mkAlias(A, "Gmail – Personal Account");
  const g = await generate(A, al.id, "passphrase", { words: 6 });
  assert.equal(g.begin.status, 201); assert.equal(g.commit.status, 200);
  assert.equal((g.commit.body as any).status, "saved");
  const hist = (await call(A, "GET", `/history/${g.eventId}`)).body as any;
  const vault = (await call(A, "GET", "/vault")).body as any;
  assert.equal(hist.aliasId, al.id); assert.equal(vault.items[0].aliasId, al.id);
  assert.equal(hist.vaultEntryId, g.entryId); assert.equal(vault.items[0].id, g.entryId); assert.equal(vault.items[0].historyEventId, g.eventId);
  assert.equal(hist.status, "saved"); assert.equal(hist.aliasNameAtGeneration, "Gmail – Personal Account");
  assert.deepEqual(hist.settings, { words: 6 });
});

test("vault values are ciphertext at rest and history/audit never contain plaintext", async () => {
  const { pg, call, mkAlias, generate } = await setup();
  const al = await mkAlias(); await generate(A, al.id);
  const dump = JSON.stringify([(await pg.query("SELECT * FROM sk_vault_entries")).rows, (await pg.query("SELECT * FROM sk_history")).rows, (await pg.query("SELECT * FROM sk_audit")).rows, (await pg.query("SELECT * FROM sk_aliases")).rows]);
  assert.ok(!dump.includes(PLAINTEXT), "plaintext never reaches storage");
  const row = (await pg.query("SELECT ciphertext, iv FROM sk_vault_entries")).rows[0] as any;
  assert.equal(row.ciphertext, ct(PLAINTEXT)); assert.equal(row.iv, IV);
  assert.ok(!JSON.stringify((await call(A, "GET", "/history")).body).includes("ciphertext"), "history responses carry no ciphertext");
  assert.ok(!JSON.stringify((await call(A, "GET", "/vault")).body).includes("ciphertext"), "vault lists carry no ciphertext");
  const sw = (await call(A, "GET", "/summary")).body as any; assert.equal(sw.vaultEntries, 1);
});

test("reusing an alias keeps credentials separate", async () => {
  const { call, mkAlias, generate } = await setup();
  const al = await mkAlias();
  const g1 = await generate(A, al.id, "password"); const g2 = await generate(A, al.id, "token", { bytes: 32 });
  const list = (await call(A, "GET", "/vault")).body as any;
  assert.equal(list.total, 2); assert.deepEqual(new Set(list.items.map((i: any) => i.id)), new Set([g1.entryId, g2.entryId]));
  assert.deepEqual(new Set(list.items.map((i: any) => i.type)), new Set(["password", "token"]));
});

test("renaming an alias updates the displayed name everywhere and preserves associations", async () => {
  const { call, mkAlias, generate } = await setup();
  const al = await mkAlias(A, "GitHub – Dev"); const g = await generate(A, al.id);
  const r = await call(A, "PATCH", `/aliases/${al.id}`, { name: "GitHub – Development" }); assert.equal(r.status, 200);
  const vault = (await call(A, "GET", "/vault")).body as any; const hist = (await call(A, "GET", `/history/${g.eventId}`)).body as any;
  assert.equal(vault.items[0].aliasName, "GitHub – Development"); assert.equal(vault.items[0].aliasId, al.id);
  assert.equal(hist.aliasName, "GitHub – Development"); assert.equal(hist.aliasNameAtGeneration, "GitHub – Dev"); assert.equal(hist.aliasId, al.id);
  const filtered = (await call(A, "GET", "/history", undefined, { aliasId: al.id })).body as any; assert.equal(filtered.total, 1);
  assert.equal((await call(A, "GET", "/aliases")).body && ((await call(A, "GET", "/aliases")).body as any).items[0].entryCount, 1);
});

test("alias names are unique per owner, case/space-insensitively, and metadata is stored", async () => {
  const { call, mkAlias } = await setup();
  await mkAlias(A, "Database – Staging");
  assert.equal((await call(A, "POST", "/aliases", { id: randomUUID(), name: "  database –   STAGING " })).status, 409);
  assert.equal((await call(B, "POST", "/aliases", { id: randomUUID(), name: "Database – Staging" })).status, 201, "other owners may reuse a name");
  const r = await call(A, "POST", "/aliases", { id: randomUUID(), name: "Cintexa – Production API", category: "api", service: "Cintexa", project: "Nexus", environment: "production", notes: "owner: ops", tags: ["prod", "prod", "api"], expiresAt: "2030-01-01T00:00:00Z" });
  assert.equal(r.status, 201); const b = r.body as any;
  assert.deepEqual(b.tags, ["prod", "api"]); assert.equal(b.environment, "production"); assert.equal(b.expiresAt, "2030-01-01T00:00:00.000Z");
  const s = (await call(A, "GET", "/aliases", undefined, { q: "nexus" })).body as any; assert.equal(s.items.length, 1);
  assert.equal((await call(A, "POST", "/aliases", { id: randomUUID(), name: "" })).status, 400);
  assert.equal((await call(A, "POST", "/aliases", { id: randomUUID(), name: "x".repeat(121) })).status, 400);
});

test("repeated requests never create duplicates (begin and commit are idempotent)", async () => {
  const { pg, call, mkAlias } = await setup();
  const al = await mkAlias(); const eventId = randomUUID(), entryId = randomUUID();
  const body = { eventId, aliasId: al.id, type: "id", settings: { format: "uuidv4" } };
  const b1 = await call(A, "POST", "/generations", body); const b2 = await call(A, "POST", "/generations", body);
  assert.equal(b1.status, 201); assert.equal(b2.status, 201); assert.equal((b1.body as any).id, (b2.body as any).id);
  const commit = { entryId, iv: IV, ciphertext: ct("x"), encVersion: 1 };
  const c1 = await call(A, "POST", `/generations/${eventId}/commit`, commit); const c2 = await call(A, "POST", `/generations/${eventId}/commit`, commit);
  const c3 = await call(A, "POST", `/generations/${eventId}/commit`, { ...commit, entryId: randomUUID() });
  assert.equal((c1.body as any).alreadySaved, false); assert.equal((c2.body as any).alreadySaved, true); assert.equal((c3.body as any).vaultEntryId, entryId);
  assert.equal(Number(((await pg.query("SELECT count(*) n FROM sk_vault_entries")).rows[0] as any).n), 1);
  assert.equal(Number(((await pg.query("SELECT count(*) n FROM sk_history")).rows[0] as any).n), 1);
  // concurrent retries
  const ev2 = randomUUID(); await call(A, "POST", "/generations", { ...body, eventId: ev2 });
  await Promise.all([1, 2, 3].map(() => call(A, "POST", `/generations/${ev2}/commit`, { ...commit, entryId: randomUUID() })));
  assert.equal(Number(((await pg.query("SELECT count(*) n FROM sk_vault_entries WHERE history_event_id=$1", [ev2])).rows[0] as any).n), 1);
});

test("failed storage is reported accurately and can be retried safely", async () => {
  const { call, mkAlias } = await setup();
  const al = await mkAlias(); const eventId = randomUUID();
  await call(A, "POST", "/generations", { eventId, aliasId: al.id, type: "token" });
  const f = await call(A, "POST", `/generations/${eventId}/fail`, { code: "save_failed" });
  assert.equal((f.body as any).status, "failed"); assert.equal((f.body as any).failureCode, "save_failed"); assert.equal((f.body as any).vaultEntryId, null);
  assert.equal(((await call(A, "GET", "/summary")).body as any).incomplete, 1);
  assert.equal((await call(A, "POST", `/generations/${eventId}/fail`, { code: "bogus" })).status, 400);
  const retry = await call(A, "POST", `/generations/${eventId}/commit`, { entryId: randomUUID(), iv: IV, ciphertext: ct("y"), encVersion: 1 });
  assert.equal((retry.body as any).status, "saved"); assert.equal((retry.body as any).failureCode, null);
  const again = await call(A, "POST", `/generations/${eventId}/fail`, { code: "save_failed" }); assert.equal((again.body as any).status, "saved", "a saved event cannot be downgraded");
  assert.equal(((await call(A, "GET", "/summary")).body as any).incomplete, 0);
});

test("commit is atomic: a failure after the vault insert leaves no vault row and the event stays incomplete", async () => {
  const { db, call, mkAlias, pg } = await setup();
  const al = await mkAlias(); const eventId = randomUUID(); await call(A, "POST", "/generations", { eventId, aliasId: al.id, type: "password" });
  const failing: Db = { query: db.query, tx: (fn) => db.tx((q) => fn({ query: (sql, p) => { if (/UPDATE sk_history SET status='saved'/.test(sql)) throw new Error("simulated crash"); return q.query(sql, p); } })) };
  const r = await handleSentinelRequest(failing, { method: "POST", path: `/generations/${eventId}/commit`, body: { entryId: randomUUID(), iv: IV, ciphertext: ct("z"), encVersion: 1 }, identity: A });
  assert.equal(r.status, 500); assert.ok(!JSON.stringify(r.body).includes("simulated"), "internals are not echoed");
  assert.equal(Number(((await pg.query("SELECT count(*) n FROM sk_vault_entries")).rows[0] as any).n), 0);
  assert.equal(((await call(A, "GET", `/history/${eventId}`)).body as any).status, "pending");
});

test("users cannot reach another user's aliases, vault, history or ids", async () => {
  const { call, mkAlias, generate } = await setup();
  const al = await mkAlias(A); const g = await generate(A, al.id);
  const bAlias = await mkAlias(B);
  const probes: [string, string, unknown?][] = [
    ["GET", `/vault/${g.entryId}`], ["PATCH", `/vault/${g.entryId}`, { pinned: true }], ["DELETE", `/vault/${g.entryId}`],
    ["GET", `/history/${g.eventId}`], ["DELETE", `/history/${g.eventId}`], ["PATCH", `/aliases/${al.id}`, { name: "hijack" }], ["DELETE", `/aliases/${al.id}`], ["POST", `/aliases/${al.id}/archive`],
    ["POST", `/generations/${g.eventId}/commit`, { entryId: randomUUID(), iv: IV, ciphertext: ct("q"), encVersion: 1 }], ["POST", `/generations/${g.eventId}/fail`, { code: "save_failed" }],
  ];
  for (const [m, p, b] of probes) assert.equal((await call(B, m, p, b)).status, 404, `${m} ${p}`);
  assert.equal((await call(B, "POST", "/generations", { eventId: randomUUID(), aliasId: al.id, type: "password" })).status, 404, "cannot generate under A's alias");
  assert.equal((await call(B, "POST", "/generations", { eventId: g.eventId, aliasId: bAlias.id, type: "password" })).status, 409, "cannot hijack an id");
  assert.equal((await call(B, "PATCH", `/vault/${g.entryId}`, { aliasId: al.id })).status, 404);
  const own = await generate(B, bAlias.id);
  assert.equal((await call(B, "PATCH", `/vault/${own.entryId}`, { aliasId: al.id })).status, 404, "cannot move own record onto A's alias");
  for (const path of ["/vault", "/history", "/aliases"]) assert.ok(((await call(B, "GET", path)).body as any).items.every((i: any) => i.id !== g.entryId && i.id !== g.eventId && i.id !== al.id), path);
  assert.equal(((await call(B, "GET", "/summary")).body as any).vaultEntries, 1);
  const exp = (await call(B, "GET", "/vault-export")).body as any; assert.equal(exp.entries.length, 1); assert.equal(exp.aliases.length, 1);
  assert.equal(((await call(A, "GET", `/vault/${g.entryId}`)).body as any).ciphertext, ct(PLAINTEXT), "owner still has everything");
});

test("deleting a history event does not delete its vault record, and vice versa; both only on explicit request", async () => {
  const { call, mkAlias, generate } = await setup();
  const al = await mkAlias();
  const g1 = await generate(A, al.id); const r1 = await call(A, "DELETE", `/history/${g1.eventId}`);
  assert.deepEqual(r1.body, { deleted: true, vaultDeleted: false });
  assert.equal((await call(A, "GET", `/vault/${g1.entryId}`)).status, 200); assert.equal(((await call(A, "GET", `/vault/${g1.entryId}`)).body as any).historyEventId, null);
  const g2 = await generate(A, al.id); const r2 = await call(A, "DELETE", `/vault/${g2.entryId}`);
  assert.deepEqual(r2.body, { deleted: true, historyDeleted: false });
  const h2 = (await call(A, "GET", `/history/${g2.eventId}`)).body as any; assert.equal(h2.vaultEntryId, null); assert.equal(h2.vaultRecordAvailable, false); assert.equal(h2.status, "saved");
  const g3 = await generate(A, al.id); assert.deepEqual((await call(A, "DELETE", `/history/${g3.eventId}`, undefined, { withVault: "true" })).body, { deleted: true, vaultDeleted: true });
  assert.equal((await call(A, "GET", `/vault/${g3.entryId}`)).status, 404);
  const g4 = await generate(A, al.id); assert.deepEqual((await call(A, "DELETE", `/vault/${g4.entryId}`, undefined, { withHistory: "true" })).body, { deleted: true, historyDeleted: true });
  assert.equal((await call(A, "GET", `/history/${g4.eventId}`)).status, 404);
  assert.equal((await call(A, "POST", `/generations/${g2.eventId}/commit`, { entryId: randomUUID(), iv: IV, ciphertext: ct("n"), encVersion: 1 })).status, 409, "a deleted record is not silently recreated");
});

test("aliases in use cannot be deleted (archive instead) and archived aliases cannot be generated under", async () => {
  const { call, mkAlias, generate } = await setup();
  const used = await mkAlias(); await generate(A, used.id);
  assert.equal((await call(A, "DELETE", `/aliases/${used.id}`)).status, 409);
  assert.equal((await call(A, "POST", `/aliases/${used.id}/archive`)).status, 200);
  assert.equal((await call(A, "POST", "/generations", { eventId: randomUUID(), aliasId: used.id, type: "password" })).status, 409);
  assert.equal(((await call(A, "GET", "/aliases")).body as any).items.length, 0);
  assert.equal(((await call(A, "GET", "/aliases", undefined, { archived: "true" })).body as any).items.length, 1);
  const name = (await call(A, "GET", "/vault")).body as any; assert.equal(name.items[0].aliasName, used.name, "records stay linked to an archived alias");
  assert.equal((await call(A, "POST", `/aliases/${used.id}/restore`)).status, 200);
  const unused = await mkAlias(); assert.equal((await call(A, "DELETE", `/aliases/${unused.id}`)).status, 200);
});

test("history supports search, filters, sorting, date ranges and pagination", async () => {
  const { call, mkAlias, generate } = await setup();
  const a1 = await mkAlias(A, "Banking – Recovery Codes"), a2 = await mkAlias(A, "Customer Portal – API Token");
  for (let i = 0; i < 5; i++) await generate(A, a1.id, "recovery"); for (let i = 0; i < 3; i++) await generate(A, a2.id, "token");
  const bad = randomUUID(); await call(A, "POST", "/generations", { eventId: bad, aliasId: a2.id, type: "token" }); await call(A, "POST", `/generations/${bad}/fail`, { code: "encryption_failed" });
  const get = async (q: any) => (await call(A, "GET", "/history", undefined, q)).body as any;
  assert.equal((await get({})).total, 9);
  assert.equal((await get({ type: "recovery" })).total, 5); assert.equal((await get({ aliasId: a2.id })).total, 4);
  assert.equal((await get({ status: "failed" })).total, 1); assert.equal((await get({ status: "incomplete" })).total, 1); assert.equal((await get({ status: "saved" })).total, 8);
  assert.equal((await get({ q: "banking" })).total, 5); assert.equal((await get({ q: "100%" })).total, 0);
  const p1 = await get({ pageSize: "4", page: "1" }), p3 = await get({ pageSize: "4", page: "3" });
  assert.equal(p1.items.length, 4); assert.equal(p3.items.length, 1); assert.equal(p1.total, 9);
  assert.equal(new Set([...p1.items, ...(await get({ pageSize: "4", page: "2" })).items, ...p3.items].map((i: any) => i.id)).size, 9, "pages do not overlap");
  const asc = await get({ sort: "alias", dir: "asc" }); assert.equal(asc.items[0].aliasName, "Banking – Recovery Codes");
  assert.equal((await get({ from: "2999-01-01T00:00:00Z" })).total, 0); assert.equal((await get({ to: "2999-01-01T00:00:00Z" })).total, 9);
  assert.equal((await call(A, "GET", "/history", undefined, { status: "weird" })).status, 400); assert.equal((await call(A, "GET", "/history", undefined, { type: "weird" })).status, 400);
  const v = (await call(A, "GET", "/vault", undefined, { q: "customer", type: "token" })).body as any; assert.equal(v.total, 3);
});

test("vault: reveal records access, metadata edits, pinning, export is ciphertext only", async () => {
  const { call, mkAlias, generate } = await setup();
  const al = await mkAlias(), al2 = await mkAlias(); const g = await generate(A, al.id);
  assert.equal(((await call(A, "GET", "/vault")).body as any).items[0].lastAccessedAt, null);
  const rev = (await call(A, "GET", `/vault/${g.entryId}`)).body as any; assert.equal(rev.ciphertext, ct(PLAINTEXT)); assert.ok(rev.lastAccessedAt);
  const up = (await call(A, "PATCH", `/vault/${g.entryId}`, { pinned: true, favorite: true, tags: ["a"], notes: "n", category: "work", expiresAt: "2020-01-01T00:00:00Z", aliasId: al2.id })).body as any;
  assert.equal(up.pinned, true); assert.equal(up.aliasId, al2.id);
  assert.equal(((await call(A, "GET", "/vault", undefined, { expired: "true" })).body as any).total, 1);
  assert.equal(((await call(A, "GET", "/summary")).body as any).expiredEntries, 1);
  assert.equal((await call(A, "PATCH", `/vault/${g.entryId}`, { pinned: "yes" })).status, 400);
  const exp = (await call(A, "GET", "/vault-export")).body as any; assert.equal(exp.entries[0].ciphertext, ct(PLAINTEXT)); assert.equal(exp.format, "sentinel-key-vault-export");
});

test("key envelope: created once, bounded KDF settings", async () => {
  const { call } = await setup();
  const body = { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "c2FsdHNhbHRzYWx0c2FsdA==" }, verifierIv: IV, verifierCt: ct("v") };
  assert.equal(((await call(A, "GET", "/key")).body as any).exists, false);
  assert.equal((await call(A, "PUT", "/key", { ...body, kdf: { ...body.kdf, iterations: 10 } })).status, 400);
  assert.equal((await call(A, "PUT", "/key", { ...body, kdf: { ...body.kdf, name: "MD5" } })).status, 400);
  assert.equal((await call(A, "PUT", "/key", body)).status, 201);
  assert.equal((await call(A, "PUT", "/key", body)).status, 409);
  assert.equal(((await call(A, "GET", "/key")).body as any).kdf.iterations, 600000);
  assert.equal(((await call(B, "GET", "/key")).body as any).exists, false, "keys are per owner");
});

test("router: authentication, API keys, routing errors and rate limits", async () => {
  const { call } = await setup();
  assert.equal((await call(undefined, "GET", "/summary")).status, 401);
  assert.equal((await call(A, "GET", "/summary", undefined, undefined, true)).status, 403);
  assert.equal((await call(A, "GET", "/nope")).status, 404); assert.equal((await call(A, "PUT", "/history")).status, 405);
  assert.equal((await call(A, "POST", "/aliases", "not an object")).status, 400);
  assert.equal((await call(A, "GET", "/vault/not-a-uuid")).status, 400);
  let last = 0; for (let i = 0; i < 30; i++) last = (await call(A, "GET", "/key")).status;
  assert.equal(last, 429); assert.equal((await call(B, "GET", "/key")).status, 200, "limits are per owner");
});
