/**
 * Durable integration event log.
 * Every Sales → Finance (and future Finance → Intelligence) action is recorded here with an idempotency key.
 */
import type { Q } from "../core/types";

export type IntegrationEventStatus = "pending" | "processing" | "succeeded" | "failed" | "skipped" | "dead";

export interface EmitInput {
  orgId?: number | null;
  eventType: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string | number;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}

export async function emitIntegrationEvent(q: Q, input: EmitInput): Promise<{ id: number; duplicate: boolean }> {
  const ins = await q.query<{ id: number }>(
    `INSERT INTO finance_integration_events
       (org_id, event_type, source_module, source_entity_type, source_entity_id, payload, idempotency_key, status)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'pending')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.orgId ?? null,
      input.eventType,
      input.sourceModule,
      input.sourceEntityType,
      String(input.sourceEntityId),
      JSON.stringify(input.payload ?? {}),
      input.idempotencyKey,
    ],
  );
  if (ins.rows[0]) return { id: Number(ins.rows[0].id), duplicate: false };
  const ex = await q.query<{ id: number }>(
    `SELECT id FROM finance_integration_events WHERE idempotency_key = $1`,
    [input.idempotencyKey],
  );
  return { id: Number(ex.rows[0]!.id), duplicate: true };
}

export async function markEventProcessing(q: Q, id: number): Promise<void> {
  await q.query(
    `UPDATE finance_integration_events SET status = 'processing', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
    [id],
  );
}

export async function markEventSucceeded(
  q: Q,
  id: number,
  resultRef?: string | null,
  resultPayload?: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `UPDATE finance_integration_events
        SET status = 'succeeded', result_ref = $2, result_payload = $3::jsonb,
            processed_at = now(), last_error = NULL, updated_at = now()
      WHERE id = $1`,
    [id, resultRef ?? null, JSON.stringify(resultPayload ?? {})],
  );
}

export async function markEventFailed(q: Q, id: number, error: string, dead = false): Promise<void> {
  await q.query(
    `UPDATE finance_integration_events
        SET status = $2, last_error = $3, updated_at = now()
      WHERE id = $1`,
    [id, dead ? "dead" : "failed", error.slice(0, 1000)],
  );
}

export async function markEventSkipped(q: Q, id: number, reason: string): Promise<void> {
  await q.query(
    `UPDATE finance_integration_events
        SET status = 'skipped', last_error = $2, processed_at = now(), updated_at = now()
      WHERE id = $1`,
    [id, reason.slice(0, 500)],
  );
}
