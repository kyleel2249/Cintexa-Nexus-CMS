/** Shared by the API server (node-postgres) and the on-device runtime (PGlite). Must stay browser-safe: no node imports. */
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

export const CREDENTIAL_TYPES = ["password", "passphrase", "id", "token", "recovery"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export type StorageStatus = "pending" | "saved" | "failed";
export const FAILURE_CODES = ["generation_failed", "encryption_failed", "save_failed", "key_locked", "aborted"] as const;

export class SkError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface Identity {
  /** Stable owner key. Every query is scoped by it. */
  ownerId: string;
}

export interface SkRequest {
  method: string;
  /** Path below /sentinel, e.g. "/aliases/123". */
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  identity?: Identity;
  isApiKey?: boolean;
}
export interface SkResponse {
  status: number;
  body?: unknown;
}
