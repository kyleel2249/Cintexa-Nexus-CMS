/**
 * On-device Intelligence runtime: the same orchestrator, agents, approvals and audit chain that run on the API server,
 * executing in the browser against the same PGlite database as Sales (so it reads the real Sales records and keeps its
 * own intel_* tables beside them; Sales backup/restore therefore covers Intelligence history too).
 * No AI key is ever placed in the browser: the optional AI narrative is only available on the API server, and the UI says so.
 */
import { createIntelligence, handleIntelligence, type Actor, type Intelligence } from "@workspace/intelligence";
import { getLocalQueryable } from "@/lib/sales/local/runtime";

const ACTOR: Actor = { userId: "local-device-owner", orgId: "default", roles: ["admin", "manager", "staff"] };
let inst: Promise<Intelligence> | null = null;

function get(): Promise<Intelligence> {
  if (!inst) {
    inst = getLocalQueryable().then((db) => createIntelligence({ db }));
    inst.catch(() => { inst = null; });
  }
  return inst;
}

export class IntelError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export async function intel<T = any>(method: "GET" | "POST" | "PATCH" | "PUT", path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  let i: Intelligence;
  try { i = await get(); } catch (e) { throw new IntelError(`The on-device database could not start: ${e instanceof Error ? e.message : String(e)}`, 500, "local_db_unavailable"); }
  const r = await handleIntelligence(i, { method, path, query: opts.query, body: opts.body, headers: {}, actor: ACTOR });
  if (r.status >= 400) { const b = r.body as { error?: string; code?: string } | undefined; throw new IntelError(b?.error ?? "Request failed", r.status, b?.code ?? "error"); }
  return r.body as T;
}
