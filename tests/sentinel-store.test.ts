import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { memoryDb } from "../artifacts/api-server/src/services/sentinel/__tests__/helpers/pg";
import { handleSentinelRequest, resetRateLimits } from "../artifacts/api-server/src/services/sentinel/router";
import { runGeneration, retryGeneration, type WorkflowDeps } from "../artifacts/cintexa/src/lib/sentinel-key/store/workflow";
import { aadFor, deriveKey, newKdf, open, seal } from "../artifacts/cintexa/src/lib/sentinel-key/store/crypto";

const OWNER = { ownerId: "owner-1" };
const SECRET = "Zq8#mLp2!vTn9xKe-TOP-SECRET";

async function rig() {
  resetRateLimits();
  const { db, pg } = await memoryDb();
  const key = await deriveKey("correct horse battery staple", newKdf(200_000));
  const calls: string[] = [];
  const hooks: { failOn?: RegExp; failTimes: number } = { failTimes: 0 };
  const call: WorkflowDeps["call"] = async (method, path, opts) => {
    calls.push(`${method} ${path}`);
    if (hooks.failOn?.test(`${method} ${path}`) && hooks.failTimes > 0) { hooks.failTimes--; throw new Error("network down"); }
    const r = await handleSentinelRequest(db, { method, path, body: opts?.body, identity: OWNER });
    if (r.status >= 300) throw Object.assign(new Error((r.body as any).error), { status: r.status });
    return r.body;
  };
  let sealImpl = seal;
  const deps: WorkflowDeps = { call, getKey: () => key, newId: () => randomUUID(), seal: (k, p, a) => sealImpl(k, p, a) };
  const alias = (await handleSentinelRequest(db, { method: "POST", path: "/aliases", body: { id: randomUUID(), name: "Cintexa – Production API" }, identity: OWNER })).body as any;
  const count = async (t: string) => Number(((await pg.query(`SELECT count(*) n FROM ${t}`)).rows[0] as any).n);
  return { db, pg, key, deps, alias, calls, hooks, count, setSeal: (f: typeof seal) => { sealImpl = f; } };
}
const input = (aliasId: string | null, make = () => SECRET) => ({ type: "token" as const, aliasId, settings: { bytes: 32 }, make });

describe("alias-linked generation workflow", () => {
  test("alias is required: nothing is generated or recorded without one", async () => {
    const r = await rig(); let made = 0;
    const o = await runGeneration(r.deps, input(null, () => { made++; return SECRET; }));
    expect(o.status).toBe("failed"); expect(o.generated).toBe(false); expect(made).toBe(0); expect(r.calls.length).toBe(0);
    expect(await r.count("sk_history")).toBe(0);
  });

  test("success writes vault AND history, linked to the alias; the vault value is decryptable only with the key and record binding", async () => {
    const r = await rig();
    const o = await runGeneration(r.deps, input(r.alias.id));
    expect(o.status).toBe("saved"); expect(o.secret).toBe(SECRET); expect(o.aliasName).toBe("Cintexa – Production API");
    expect(await r.count("sk_vault_entries")).toBe(1); expect(await r.count("sk_history")).toBe(1);
    const entry = (await r.pg.query("SELECT * FROM sk_vault_entries")).rows[0] as any; const hist = (await r.pg.query("SELECT * FROM sk_history")).rows[0] as any;
    expect(entry.alias_id).toBe(r.alias.id); expect(hist.alias_id).toBe(r.alias.id); expect(hist.vault_entry_id).toBe(entry.id); expect(hist.status).toBe("saved");
    expect(JSON.stringify([entry, hist, (await r.pg.query("SELECT * FROM sk_audit")).rows])).not.toContain(SECRET);
    expect(await open(r.key, { iv: entry.iv, ciphertext: entry.ciphertext }, aadFor(entry.id, "token"))).toBe(SECRET);
    await expect(open(r.key, { iv: entry.iv, ciphertext: entry.ciphertext }, aadFor(randomUUID(), "token"))).rejects.toBeDefined();
    const wrong = await deriveKey("another master password!", newKdf(200_000));
    await expect(open(wrong, { iv: entry.iv, ciphertext: entry.ciphertext }, aadFor(entry.id, "token"))).rejects.toBeDefined();
  });

  test("a locked vault blocks generation before anything is created", async () => {
    const r = await rig(); let made = 0;
    const o = await runGeneration({ ...r.deps, getKey: () => null }, input(r.alias.id, () => { made++; return SECRET; }));
    expect(o.status).toBe("failed"); expect(o.stage).toBe("key"); expect(made).toBe(0); expect(await r.count("sk_history")).toBe(0);
  });

  test("if the history record cannot be created, no secret is generated", async () => {
    const r = await rig(); r.hooks.failOn = /POST \/generations$/; r.hooks.failTimes = 1; let made = 0;
    const o = await runGeneration(r.deps, input(r.alias.id, () => { made++; return SECRET; }));
    expect(o.status).toBe("failed"); expect(o.stage).toBe("begin"); expect(o.generated).toBe(false); expect(made).toBe(0);
  });

  test("a generator error is recorded as a failed event with no vault record", async () => {
    const r = await rig();
    const o = await runGeneration(r.deps, input(r.alias.id, () => { throw new Error("rng unavailable"); }));
    expect(o.status).toBe("failed"); expect(o.stage).toBe("generate");
    const h = (await r.pg.query("SELECT status, failure_code FROM sk_history")).rows[0] as any; expect([h.status, h.failure_code]).toEqual(["failed", "generation_failed"]);
    expect(await r.count("sk_vault_entries")).toBe(0);
  });

  test("encryption failure: incomplete, secret kept for the user, history marked failed, retry saves with the same ids", async () => {
    const r = await rig(); r.setSeal(async () => { throw new Error("subtle crypto failed"); });
    const o = await runGeneration(r.deps, input(r.alias.id));
    expect(o.status).toBe("incomplete"); expect(o.generated).toBe(true); expect(o.secret).toBe(SECRET); expect(o.error).toContain("NOT saved");
    expect(await r.count("sk_vault_entries")).toBe(0);
    expect(((await r.pg.query("SELECT failure_code FROM sk_history")).rows[0] as any).failure_code).toBe("encryption_failed");
    r.setSeal(seal);
    const again = await retryGeneration(r.deps, o);
    expect(again.status).toBe("saved"); expect(again.eventId).toBe(o.eventId);
    expect(await r.count("sk_vault_entries")).toBe(1); expect(await r.count("sk_history")).toBe(1);
  });

  test("save failure: reported as incomplete (never as saved); retries are idempotent and never duplicate", async () => {
    const r = await rig(); r.hooks.failOn = /commit$/; r.hooks.failTimes = 2;
    const o = await runGeneration(r.deps, input(r.alias.id));
    expect(o.status).toBe("incomplete"); expect(o.stage).toBe("save"); expect(o.secret).toBe(SECRET);
    expect(((await r.pg.query("SELECT status FROM sk_history")).rows[0] as any).status).toBe("failed");
    expect(await r.count("sk_vault_entries")).toBe(0);
    const still = await retryGeneration(r.deps, o); expect(still.status).toBe("incomplete");
    const done = await retryGeneration(r.deps, still); expect(done.status).toBe("saved");
    const extra = await retryGeneration(r.deps, done); expect(extra.status).toBe("saved");
    expect(await r.count("sk_vault_entries")).toBe(1); expect(await r.count("sk_history")).toBe(1);
    expect(((await r.pg.query("SELECT status, vault_entry_id FROM sk_history")).rows[0] as any).status).toBe("saved");
  });

  test("an unreachable server during commit followed by a lost response does not duplicate when retried", async () => {
    const r = await rig();
    const o = await runGeneration(r.deps, input(r.alias.id)); // committed on the server
    const replay = await retryGeneration(r.deps, { ...o, status: "incomplete", pending: { eventId: o.eventId!, entryId: o.entryId!, type: "token", sealed: (await (async () => { const e = (await r.pg.query("SELECT iv, ciphertext FROM sk_vault_entries")).rows[0] as any; return { iv: e.iv, ciphertext: e.ciphertext }; })()) } });
    expect(replay.status).toBe("saved"); expect(await r.count("sk_vault_entries")).toBe(1);
  });
});
