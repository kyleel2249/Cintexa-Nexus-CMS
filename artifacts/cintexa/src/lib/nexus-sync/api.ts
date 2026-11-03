import { apiJson } from "@/lib/api";

const SYNC = "/sync";

export function syncGet<T>(path: string): Promise<T> {
  return apiJson<T>(`${SYNC}${path.startsWith("/") ? path : `/${path}`}`);
}

export function syncPost<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${SYNC}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Publish a domain event into the Nexus outbox (idempotent). */
export async function publishNexusEvent(input: {
  eventType: string;
  sourceModule: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  return syncPost<{ event: unknown; duplicate?: boolean }>("/events", input);
}

/** Query keys to invalidate after a successful sync publish. */
export const NEXUS_SYNC_QUERY_KEYS = [
  ["bd"],
  ["fi"],
  ["sync"],
  ["bd", "dashboard"],
  ["fi", "dashboard"],
  ["bd", "widget"],
  ["fi", "widget"],
] as const;
