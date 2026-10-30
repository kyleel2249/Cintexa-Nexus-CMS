import { useSyncExternalStore } from "react";
import { sk, SkClientError } from "./api";
import { checkVerifier, deriveKey, makeVerifier, newKdf, reencryptAll, type KdfParams } from "./crypto";

/** In-memory only. The derived key is non-extractable and is never written anywhere; locking or leaving the page drops it. */
export type KeyPhase = "loading" | "none" | "locked" | "unlocked" | "error";
export interface KeyState { phase: KeyPhase; error?: string }

let state: KeyState = { phase: "loading" };
let key: CryptoKey | null = null;
let envelope: { kdf: KdfParams; verifierIv: string; verifierCt: string } | null = null;
let fails = 0; let blockedUntil = 0;
const listeners = new Set<() => void>();
const set = (s: KeyState) => { state = s; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getKey = () => key;
export const useKeyring = (): KeyState => useSyncExternalStore(subscribe, () => state, () => state);

export async function initKeyring(force = false): Promise<void> {
  if (!force && (state.phase === "unlocked" || state.phase === "locked" || state.phase === "none")) return;
  try {
    const r = await sk("GET", "/key");
    if (!r.exists) { envelope = null; set({ phase: "none" }); return; }
    envelope = { kdf: r.kdf, verifierIv: r.verifierIv, verifierCt: r.verifierCt };
    set({ phase: key ? "unlocked" : "locked" });
  } catch (e) { set({ phase: "error", error: e instanceof Error ? e.message : "Storage is unavailable" }); }
}

export async function createKeyring(master: string): Promise<void> {
  if (master.length < 12) throw new Error("Use a master password of at least 12 characters.");
  const kdf = newKdf();
  const k = await deriveKey(master, kdf);
  const v = await makeVerifier(k);
  try { await sk("PUT", "/key", { body: { kdf, ...v } }); }
  catch (e) { if (e instanceof SkClientError && e.code === "key_exists") { await initKeyring(true); throw new Error("A vault key already exists. Unlock it instead."); } throw e; }
  envelope = { kdf, ...v }; key = k; fails = 0;
  set({ phase: "unlocked" });
}

export async function unlockKeyring(master: string): Promise<void> {
  if (!envelope) await initKeyring(true);
  if (!envelope) throw new Error("No vault key exists yet.");
  const wait = blockedUntil - Date.now();
  if (wait > 0) throw new Error(`Too many wrong attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`);
  const k = await deriveKey(master, envelope.kdf);
  if (!(await checkVerifier(k, envelope.verifierIv, envelope.verifierCt))) {
    fails += 1; if (fails >= 3) blockedUntil = Date.now() + Math.min(2 ** (fails - 2), 30) * 1000;
    throw new Error("Wrong master password.");
  }
  key = k; fails = 0; blockedUntil = 0;
  set({ phase: "unlocked" });
}

export function lockKeyring() { key = null; if (state.phase === "unlocked") set({ phase: "locked" }); }

/** Change the master password: re-encrypt every record in the browser, then swap key + ciphertexts atomically on the store. */
export async function changeKeyringPassword(newMaster: string): Promise<{ reencrypted: number }> {
  if (!key || !envelope) throw new Error("Unlock the vault first.");
  if (newMaster.length < 12) throw new Error("Use a master password of at least 12 characters.");
  const exp = await sk<{ entries: { id: string; type: string; iv: string; ciphertext: string }[] }>("GET", "/vault-export");
  const kdf = newKdf();
  const nk = await deriveKey(newMaster, kdf);
  const entries = await reencryptAll(key, nk, exp.entries);
  const v = await makeVerifier(nk);
  await sk("POST", "/key/rotate", { body: { kdf, ...v, entries } }); // 409 vault_changed => nothing was modified
  key = nk; envelope = { kdf, ...v }; fails = 0; blockedUntil = 0;
  return { reencrypted: entries.length };
}
