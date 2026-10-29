/**
 * Alias-linked generation workflow (transport-agnostic so it can be unit-tested):
 *
 *   begin (history event "pending", alias mandatory)  ->  generate  ->  encrypt  ->  commit (vault entry + history "saved", one transaction)
 *
 *  - The secret is only generated AFTER the history event exists, so no credential can exist without a history record.
 *  - Any failure marks the event "failed" with a code (best effort) and the outcome says exactly what was and was not stored.
 *  - Ids are created by the client, so a retried begin/commit is idempotent on the server: no duplicates.
 *  - If saving fails the secret is still returned so it is not silently lost; the caller shows it with a Retry action.
 */
import type { CredentialType } from "@sentinel-engine/types";
import type { Sealed } from "./crypto";
import { aadFor } from "./crypto";

export type Stage = "key" | "begin" | "generate" | "encrypt" | "save";
export interface WorkflowDeps {
  call: (method: string, path: string, opts?: { body?: unknown }) => Promise<any>;
  getKey: () => CryptoKey | null;
  newId: () => string;
  seal: (key: CryptoKey, plaintext: string, aad: Uint8Array) => Promise<Sealed>;
}
export interface GenerationInput {
  type: CredentialType;
  aliasId: string | null | undefined;
  settings: Record<string, string | number | boolean>;
  itemCount?: number;
  /** Produces the plaintext secret (several items are joined by newlines). */
  make: () => string | Promise<string>;
}
export interface Pending { eventId: string; entryId: string; type: CredentialType; sealed: Sealed | null }
export interface Outcome {
  /** "saved": vault AND history written. "incomplete": secret exists but is not (fully) stored. "failed": nothing usable was produced. */
  status: "saved" | "incomplete" | "failed";
  stage?: Stage;
  /** true when a secret was produced (it must be shown even if storage failed). */
  generated: boolean;
  secret?: string;
  eventId?: string;
  entryId?: string;
  aliasId?: string;
  aliasName?: string;
  error?: string;
  pending?: Pending;
}

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

async function markFailed(deps: WorkflowDeps, eventId: string, code: string) {
  try { await deps.call("POST", `/generations/${eventId}/fail`, { body: { code } }); } catch { /* the event stays "pending", which is also reported as incomplete */ }
}

export async function runGeneration(deps: WorkflowDeps, input: GenerationInput): Promise<Outcome> {
  if (!input.aliasId) return { status: "failed", stage: "begin", generated: false, error: "Choose or create an alias before generating." };
  const key = deps.getKey();
  if (!key) return { status: "failed", stage: "key", generated: false, error: "Unlock your vault first. Every generated credential is saved encrypted to it." };

  const eventId = deps.newId();
  let aliasName: string | undefined;
  try {
    const ev = await deps.call("POST", "/generations", { body: { eventId, aliasId: input.aliasId, type: input.type, settings: input.settings, itemCount: input.itemCount ?? 1 } });
    aliasName = ev.aliasNameAtGeneration;
  } catch (e) {
    return { status: "failed", stage: "begin", generated: false, error: `Nothing was generated or saved. ${msg(e, "The history record could not be created.")}` };
  }

  let secret: string;
  try { secret = await input.make(); }
  catch (e) { await markFailed(deps, eventId, "generation_failed"); return { status: "failed", stage: "generate", generated: false, eventId, aliasId: input.aliasId, aliasName, error: msg(e, "Generation failed.") }; }

  const pending: Pending = { eventId, entryId: deps.newId(), type: input.type, sealed: null };
  try { pending.sealed = await deps.seal(key, secret, aadFor(pending.entryId, input.type)); }
  catch (e) {
    await markFailed(deps, eventId, "encryption_failed");
    return { status: "incomplete", stage: "encrypt", generated: true, secret, eventId, aliasId: input.aliasId, aliasName, pending, error: `The credential was generated but could not be encrypted, so it was NOT saved. ${msg(e, "")}`.trim() };
  }
  return commit(deps, pending, secret, input.aliasId, aliasName);
}

async function commit(deps: WorkflowDeps, pending: Pending, secret: string, aliasId: string, aliasName?: string): Promise<Outcome> {
  try {
    const r = await deps.call("POST", `/generations/${pending.eventId}/commit`, { body: { entryId: pending.entryId, iv: pending.sealed!.iv, ciphertext: pending.sealed!.ciphertext, encVersion: 1 } });
    return { status: "saved", generated: true, secret, eventId: pending.eventId, entryId: r.vaultEntryId ?? pending.entryId, aliasId, aliasName: r.aliasName ?? aliasName };
  } catch (e) {
    await markFailed(deps, pending.eventId, "save_failed");
    return { status: "incomplete", stage: "save", generated: true, secret, eventId: pending.eventId, aliasId, aliasName, pending, error: `The credential was generated but is NOT saved to the vault. ${msg(e, "")}`.trim() };
  }
}

/** Safe retry: re-encrypts if needed, then commits with the SAME event id and record id (idempotent). */
export async function retryGeneration(deps: WorkflowDeps, o: Outcome): Promise<Outcome> {
  if (o.status === "saved" || !o.pending || !o.secret || !o.aliasId) return o;
  const key = deps.getKey();
  if (!key) return { ...o, error: "Unlock your vault, then retry." };
  const pending = { ...o.pending };
  if (!pending.sealed) {
    try { pending.sealed = await deps.seal(key, o.secret, aadFor(pending.entryId, pending.type)); }
    catch (e) { return { ...o, error: `Encryption failed again. ${msg(e, "")}`.trim() }; }
  }
  return commit(deps, pending, o.secret, o.aliasId, o.aliasName);
}
