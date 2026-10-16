/**
 * Website Intelligence transport selector.
 *
 *  server mode : the REST API answers /v1/website-audits/meta, so everything goes to it.
 *  local mode  : no API is reachable. The same engine runs in this page, history is kept in IndexedDB,
 *                and pages are fetched through the stateless Cloudflare Pages relay (/api/wi-relay).
 *
 * The mode is detected once per session and can be re-checked with redetectMode().
 */
import { useSyncExternalStore } from "react";
import { MemoryRepo, createLocalRuntime, type LocalRuntime, type StoredAudit } from "@workspace/wi-engine/local";
import { API_BASE, ApiError, explainStatus, readJson } from "@/lib/api";
import { firebaseAuth } from "@/lib/firebase";

export type WiMode = "detecting" | "server" | "local";

const BASE = "/v1/website-audits";
const RELAY = "/api/wi-relay";
const PSI_KEY = "wi.pagespeedKey";
const SETTINGS_KEY = "wi.localSettings";

let mode: WiMode = "detecting";
let detecting: Promise<WiMode> | null = null;
const listeners = new Set<() => void>();
const setMode = (m: WiMode) => { mode = m; listeners.forEach((l) => l()); };

export const getWiMode = (): WiMode => mode;
export function useWiMode(): WiMode {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => mode, () => mode);
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function probeServer(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}${BASE}/meta`, { headers: { accept: "application/json", ...(await authHeader()) }, credentials: "include" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return false;
    const body = (await res.json()) as { totalTests?: number };
    return typeof body.totalTests === "number";
  } catch { return false; }
}

/** Detects the mode once. Waits for the Firebase session to be restored so the probe carries a token. */
export function ensureMode(): Promise<WiMode> {
  if (mode !== "detecting") return Promise.resolve(mode);
  detecting ??= (async () => {
    try { await firebaseAuth.authStateReady(); } catch { /* continue without a session */ }
    const m: WiMode = (await probeServer()) ? "server" : "local";
    setMode(m);
    return m;
  })();
  return detecting;
}
export function redetectMode(): Promise<WiMode> { detecting = null; mode = "detecting"; listeners.forEach((l) => l()); return ensureMode(); }

// ---------------------------------------------------------------------------
// IndexedDB persistence (one database per signed-in user)
// ---------------------------------------------------------------------------
const STORE = "audits";
function openDb(uid: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`cintexa-wi-${uid}`, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "summary.id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB is unavailable."));
  });
}
const tx = <T,>(db: IDBDatabase, m: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { const r = fn(db.transaction(STORE, m).objectStore(STORE)); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export interface LocalState { runtime: LocalRuntime; repo: MemoryRepo; persistent: boolean }
let local: { uid: string; promise: Promise<LocalState> } | null = null;

async function createLocal(uid: string, email: string | null): Promise<LocalState> {
  let db: IDBDatabase | null = null;
  try { db = await openDb(uid); } catch { db = null; }
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let repo!: MemoryRepo;
  const flush = async () => {
    timer = null;
    if (!db) return;
    for (const id of [...dirty]) {
      dirty.delete(id);
      try {
        const snap = repo.exportAudit(id);
        if (snap) await tx(db, "readwrite", (s) => s.put(snap));
        else await tx(db, "readwrite", (s) => s.delete(id));
      } catch { /* quota or private mode: the in-memory copy still works */ }
    }
  };
  repo = new MemoryRepo((id) => { dirty.add(id); timer ??= setTimeout(() => void flush(), 400); });
  if (db) {
    try { for (const rec of await tx<StoredAudit[]>(db, "readonly", (s) => s.getAll())) repo.importAudit(rec); } catch { /* start empty */ }
    window.addEventListener("pagehide", () => void flush());
  }
  const store = (k: string) => ({ read: () => { try { return localStorage.getItem(k); } catch { return null; } }, write: (v: string) => localStorage.setItem(k, v) });
  const runtime = createLocalRuntime({
    user: { id: uid, email },
    net: { relayUrl: RELAY, getToken: () => firebaseAuth.currentUser?.getIdToken().catch(() => null) ?? Promise.resolve(null) },
    repo,
    settingsStore: store(SETTINGS_KEY),
    pageSpeedKey: getPageSpeedKey,
    runtimeVersion: `browser (${navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] ?? "unknown"})`,
  });
  await runtime.recoverInterrupted();
  return { runtime, repo, persistent: Boolean(db) };
}

export async function getLocal(): Promise<LocalState> {
  await firebaseAuth.authStateReady().catch(() => undefined);
  // Signing in is optional. Visitors who are not signed in use a separate on-device workspace.
  const u = firebaseAuth.currentUser;
  const uid = u?.uid ?? "anonymous";
  if (!local || local.uid !== uid) local = { uid, promise: createLocal(uid, u?.email ?? null) };
  return local.promise;
}

export function getPageSpeedKey(): string | null { try { return localStorage.getItem(PSI_KEY) || null; } catch { return null; } }
export function setPageSpeedKey(key: string): void { try { key.trim() ? localStorage.setItem(PSI_KEY, key.trim()) : localStorage.removeItem(PSI_KEY); } catch { /* storage unavailable */ } }

// ---------------------------------------------------------------------------
// Unified request helpers
// ---------------------------------------------------------------------------
/** fetch-compatible entry point for /v1/website-audits/*. */
export async function wiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const m = await ensureMode();
  if (m === "server") {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type") && typeof init.body === "string") headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    return fetch(`${API_BASE}${path}`, { credentials: "include", ...init, headers });
  }
  const { runtime } = await getLocal();
  const rel = path.startsWith(BASE) ? path.slice(BASE.length) || "/" : path;
  let body: unknown;
  if (typeof init.body === "string" && init.body) { try { body = JSON.parse(init.body); } catch { body = undefined; } }
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const r = await runtime.handle({ method: (init.method ?? "GET").toUpperCase(), path: rel, body, headers });
  const out = new Headers({ "content-type": r.contentType, ...r.headers });
  return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: out });
}

export async function wiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try { res = await wiFetch(path, init); } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError((e as Error)?.message === "Failed to fetch" ? "Cannot reach the API. Check your connection." : (e as Error)?.message || "Network error", 0);
  }
  const body = await readJson<any>(res);
  if (!res.ok) throw new ApiError(explainStatus(res.status, body?.error || body?.message), res.status, body);
  return body as T;
}
