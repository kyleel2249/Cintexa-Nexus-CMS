/**
 * Sentinel Key local vault.
 *  - Key derivation: PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte random salt per vault (Web Crypto API).
 *  - Encryption: AES-256-GCM with a fresh random 96-bit IV for every save; the GCM tag authenticates ciphertext
 *    and the envelope metadata (version + KDF parameters are bound as additional authenticated data).
 *  - The master password is never stored or transmitted; the derived key is non-extractable and lives only in memory.
 *  - Data stays on this browser (localStorage holds only the encrypted envelope). Nothing is synchronised.
 */
import { fromBase64, getCrypto, randomBytes, toBase64 } from "./random";

export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
const MIN_IMPORT_ITERATIONS = 200_000;
const MAX_IMPORT_ITERATIONS = 5_000_000;
export const VAULT_STORAGE_KEY = "sentinel-key.vault.v1";
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_ENTRIES = 2000;
export const MIN_MASTER_LENGTH = 12;

export interface VaultEntry {
  id: string; name: string; username: string; password: string; origin: string; category: string; notes: string;
  createdAt: number; updatedAt: number;
}
export interface VaultData { entries: VaultEntry[] }

export interface Envelope {
  v: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string };
  data: string;
}

export interface KeyValueStore { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }

export const browserStore: KeyValueStore = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export class VaultError extends Error {
  constructor(public code: "wrong-password" | "corrupt" | "invalid" | "weak-master" | "missing", message: string) { super(message); }
}

export interface VaultSession { key: CryptoKey; salt: Uint8Array; iterations: number; data: VaultData }

const enc = new TextEncoder();
const dec = new TextDecoder();
const aadFor = (v: number, kdf: Envelope["kdf"]) => enc.encode(JSON.stringify({ v, n: kdf.name, h: kdf.hash, i: kdf.iterations, s: kdf.salt }));

async function deriveKey(master: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = getCrypto().subtle;
  const base = await s.importKey("raw", enc.encode(master.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return s.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(session: VaultSession): Promise<Envelope> {
  const iv = randomBytes(12);
  const kdf: Envelope["kdf"] = { name: "PBKDF2", hash: "SHA-256", iterations: session.iterations, salt: toBase64(session.salt) };
  const ct = await getCrypto().subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aadFor(VAULT_VERSION, kdf) as BufferSource }, session.key, enc.encode(JSON.stringify(session.data)));
  return { v: VAULT_VERSION, kdf, cipher: { name: "AES-256-GCM", iv: toBase64(iv) }, data: toBase64(new Uint8Array(ct)) };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
function sanitize(raw: unknown): VaultData {
  const list = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) throw new VaultError("corrupt", "Vault contents are not in the expected format.");
  const ids = new Set<string>();
  const entries: VaultEntry[] = [];
  for (const e of list as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") throw new VaultError("corrupt", "Vault contents are not in the expected format.");
    const id = str(e.id, 64);
    if (!id || ids.has(id)) throw new VaultError("corrupt", "Vault contents are not in the expected format.");
    ids.add(id);
    entries.push({ id, name: str(e.name, 200), username: str(e.username, 320), password: str(e.password, 1024), origin: str(e.origin, 2048), category: str(e.category, 64), notes: str(e.notes, 4000), createdAt: Number(e.createdAt) || 0, updatedAt: Number(e.updatedAt) || 0 });
  }
  return { entries };
}

function parseEnvelope(json: string, imported: boolean): Envelope {
  if (typeof json !== "string" || json.length > MAX_BACKUP_BYTES) throw new VaultError("invalid", "The file is too large or not text.");
  let o: any;
  try { o = JSON.parse(json); } catch { throw new VaultError("invalid", "The file is not valid JSON."); }
  const ok = o && typeof o === "object" && o.v === VAULT_VERSION && o.kdf?.name === "PBKDF2" && o.kdf?.hash === "SHA-256" && Number.isInteger(o.kdf?.iterations) && typeof o.kdf?.salt === "string" && o.cipher?.name === "AES-256-GCM" && typeof o.cipher?.iv === "string" && typeof o.data === "string";
  if (!ok) throw new VaultError("invalid", "This is not a Sentinel Key vault file or its version is not supported.");
  const it = o.kdf.iterations as number;
  if (it < MIN_IMPORT_ITERATIONS || it > MAX_IMPORT_ITERATIONS) throw new VaultError("invalid", "The key-derivation settings in this file are outside the accepted range.");
  try {
    if (fromBase64(o.kdf.salt).length < 16 || fromBase64(o.cipher.iv).length !== 12) throw new Error();
  } catch { throw new VaultError("invalid", "The file's salt or nonce is malformed."); }
  void imported;
  return o as Envelope;
}

async function open(master: string, env: Envelope): Promise<VaultSession> {
  const salt = fromBase64(env.kdf.salt);
  const key = await deriveKey(master, salt, env.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv: fromBase64(env.cipher.iv) as BufferSource, additionalData: aadFor(env.v, env.kdf) as BufferSource }, key, fromBase64(env.data) as BufferSource);
  } catch {
    // AES-GCM cannot distinguish a wrong key from tampered data; both fail authentication.
    throw new VaultError("wrong-password", "Wrong master password, or the vault data has been modified.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(dec.decode(plain)); } catch { throw new VaultError("corrupt", "Vault contents are not in the expected format."); }
  return { key, salt, iterations: env.kdf.iterations, data: sanitize(parsed) };
}

export const vaultExists = (store: KeyValueStore = browserStore) => store.get(VAULT_STORAGE_KEY) !== null;

export async function createVault(master: string, store: KeyValueStore = browserStore, iterations = PBKDF2_ITERATIONS): Promise<VaultSession> {
  if (master.length < MIN_MASTER_LENGTH) throw new VaultError("weak-master", `Use a master password of at least ${MIN_MASTER_LENGTH} characters.`);
  if (vaultExists(store)) throw new VaultError("invalid", "A vault already exists in this browser.");
  const salt = randomBytes(16);
  const session: VaultSession = { key: await deriveKey(master, salt, iterations), salt, iterations, data: { entries: [] } };
  store.set(VAULT_STORAGE_KEY, JSON.stringify(await seal(session)));
  return session;
}

export async function unlockVault(master: string, store: KeyValueStore = browserStore): Promise<VaultSession> {
  const raw = store.get(VAULT_STORAGE_KEY);
  if (!raw) throw new VaultError("missing", "No vault exists in this browser yet.");
  return open(master, parseEnvelope(raw, false));
}

export async function saveVault(session: VaultSession, store: KeyValueStore = browserStore): Promise<void> {
  store.set(VAULT_STORAGE_KEY, JSON.stringify(await seal(session)));
}

/** Encrypted backup: the same authenticated envelope, safe to store anywhere. Requires the master password to open. */
export async function exportBackup(session: VaultSession): Promise<string> {
  return JSON.stringify(await seal(session));
}

/** Verifies a backup by decrypting it with its master password before anything is replaced. */
export async function importBackup(json: string, master: string, store: KeyValueStore = browserStore): Promise<VaultSession> {
  const session = await open(master, parseEnvelope(json, true));
  await saveVault(session, store);
  return session;
}

export async function changeMasterPassword(session: VaultSession, newMaster: string, store: KeyValueStore = browserStore): Promise<VaultSession> {
  if (newMaster.length < MIN_MASTER_LENGTH) throw new VaultError("weak-master", `Use a master password of at least ${MIN_MASTER_LENGTH} characters.`);
  const salt = randomBytes(16);
  const next: VaultSession = { key: await deriveKey(newMaster, salt, PBKDF2_ITERATIONS), salt, iterations: PBKDF2_ITERATIONS, data: session.data };
  await saveVault(next, store);
  return next;
}

export const deleteVault = (store: KeyValueStore = browserStore) => store.remove(VAULT_STORAGE_KEY);

export function newEntryId(): string {
  return toBase64(randomBytes(12)).replace(/[+/=]/g, "x");
}
