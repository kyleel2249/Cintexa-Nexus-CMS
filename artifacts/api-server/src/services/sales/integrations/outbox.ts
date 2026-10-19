/**
 * Transactional outbox for every external side effect (stock reservation, invoice creation, e-mail, WhatsApp).
 *
 * The business transaction writes an outbox row in the same commit as the change. A worker then calls the provider
 * with a stable idempotency key (so a retry can never double-post an invoice). Rows are:
 *   pending       waiting for the next attempt
 *   unconfigured  no provider is connected - kept so it can run if one is connected later; UI shows "not connected"
 *   sent          provider confirmed (provider_ref stored)
 *   failed        last attempt failed, will retry with back-off
 *   dead          retry limit reached - appears in the failure queue
 *   manual        a person recorded the outcome by hand
 */
import type { Db, Queryable } from "../core/types";
import type { Deps } from "../core/router";
import type { ProviderResult, OrderPayload, EmailMessage, WhatsAppMessage } from "./providers";

export type OutboxKind = "inventory.reserve" | "inventory.release" | "finance.invoice" | "finance.void_invoice" | "email.send" | "whatsapp.send";

export const MAX_ATTEMPTS = 5;

export interface EnqueueInput {
  kind: OutboxKind;
  entityType: string;
  entityId: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

const PROVIDER_OF: Record<OutboxKind, string> = {
  "inventory.reserve": "inventory",
  "inventory.release": "inventory",
  "finance.invoice": "finance",
  "finance.void_invoice": "finance",
  "email.send": "email",
  "whatsapp.send": "whatsapp",
};

/** Idempotent: enqueueing the same key twice returns the existing row's id. */
export async function enqueue(q: Queryable, input: EnqueueInput): Promise<number> {
  const ins = await q.query<{ id: number }>(
    `INSERT INTO sales_outbox (kind, provider, entity_type, entity_id, payload, idempotency_key, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5::text::jsonb,$6, now())
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [input.kind, PROVIDER_OF[input.kind], input.entityType, String(input.entityId), JSON.stringify(input.payload), input.idempotencyKey],
  );
  if (ins.rows[0]) return ins.rows[0].id;
  const ex = await q.query<{ id: number }>("SELECT id FROM sales_outbox WHERE idempotency_key = $1", [input.idempotencyKey]);
  return ex.rows[0]!.id;
}

interface OutboxRow {
  id: number;
  kind: OutboxKind;
  entity_type: string;
  entity_id: number;
  payload: Record<string, any>;
  attempts: number;
  idempotency_key: string;
}

/** Called by the scheduler (and by tests). Returns counts per resulting status. */
export async function processOutbox(db: Db, deps: Deps, limit = 25): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  // Claim rows with SKIP LOCKED so two workers never process the same row.
  const claimed = await db.tx(async (q) => {
    const r = await q.query<OutboxRow>(
      `SELECT id, kind, entity_type, entity_id, payload, attempts, idempotency_key FROM sales_outbox
       WHERE status IN ('pending','failed','unconfigured') AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY id LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))} FOR UPDATE SKIP LOCKED`,
    );
    if (r.rows.length) await q.query(`UPDATE sales_outbox SET next_attempt_at = now() + interval '2 minutes' WHERE id IN (${r.rows.map((x) => Number(x.id)).join(",")})`);
    return r.rows.map((x) => ({ ...x, id: Number(x.id), entity_id: Number(x.entity_id) }));
  });

  for (const row of claimed) {
    const providerName = PROVIDER_OF[row.kind];
    const provider = (deps.integrations as Record<string, unknown>)[providerName] as { name: string } | undefined;
    if (!provider) {
      await db.query(`UPDATE sales_outbox SET status = 'unconfigured', last_error = $2, next_attempt_at = now() + interval '1 hour' WHERE id = $1`, [row.id, `No ${providerName} provider is connected`]);
      await onOutcome(db, row, { ok: false, error: `No ${providerName} provider is connected`, retryable: true }, "unconfigured");
      bump("unconfigured");
      continue;
    }
    let result: ProviderResult;
    try {
      result = await callProvider(deps, row);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : "Provider error", retryable: true };
    }
    if (result.ok) {
      await db.query(`UPDATE sales_outbox SET status = 'sent', provider_ref = $2, attempts = attempts + 1, sent_at = now(), last_error = NULL WHERE id = $1`, [row.id, result.ref ?? null]);
      await onOutcome(db, row, result, "sent");
      bump("sent");
    } else {
      const attempts = row.attempts + 1;
      const dead = result.retryable === false || attempts >= MAX_ATTEMPTS;
      const backoffMin = Math.min(240, 2 ** attempts);
      await db.query(
        `UPDATE sales_outbox SET status = $2, attempts = $3, last_error = $4, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $1`,
        [row.id, dead ? "dead" : "failed", attempts, (result.error ?? "Failed").slice(0, 500), String(backoffMin)],
      );
      await onOutcome(db, row, result, dead ? "dead" : "failed");
      bump(dead ? "dead" : "failed");
    }
  }
  return counts;
}

async function callProvider(deps: Deps, row: OutboxRow): Promise<ProviderResult> {
  const i = deps.integrations;
  const p = row.payload;
  switch (row.kind) {
    case "inventory.reserve": return i.inventory!.reserve(p.order as OrderPayload, row.idempotency_key);
    case "inventory.release": return i.inventory!.release(p.order as OrderPayload, row.idempotency_key);
    case "finance.invoice": return i.finance!.createInvoice(p.order as OrderPayload, row.idempotency_key);
    case "finance.void_invoice": return i.finance!.voidInvoice(String(p.invoiceRef), String(p.reason ?? ""), row.idempotency_key);
    case "email.send": return i.email!.send(p.message as EmailMessage, row.idempotency_key);
    case "whatsapp.send": return i.whatsapp!.sendTemplate(p.message as WhatsAppMessage, row.idempotency_key);
  }
}

/** Reflect confirmed (or failed) outcomes back onto the business record - never before the provider answers. */
async function onOutcome(db: Db, row: OutboxRow, result: ProviderResult, status: "sent" | "failed" | "dead" | "unconfigured"): Promise<void> {
  if (row.entity_type === "order") {
    if (row.kind === "inventory.reserve") {
      const s = status === "sent" ? "reserved" : status === "dead" || status === "unconfigured" ? "unavailable" : "pending";
      await db.query("UPDATE sales_orders SET inventory_status = $2, updated_at = now() WHERE id = $1 AND inventory_status <> 'released'", [row.entity_id, s]);
    } else if (row.kind === "inventory.release" && status === "sent") {
      await db.query("UPDATE sales_orders SET inventory_status = 'released', updated_at = now() WHERE id = $1", [row.entity_id]);
    } else if (row.kind === "finance.invoice") {
      if (status === "sent") await db.query("UPDATE sales_orders SET invoice_status = 'issued', invoice_ref = COALESCE($2, invoice_ref), updated_at = now() WHERE id = $1", [row.entity_id, result.ref ?? null]);
      else if (status === "dead" || status === "unconfigured") await db.query("UPDATE sales_orders SET invoice_status = 'unavailable', updated_at = now() WHERE id = $1 AND invoice_status <> 'issued'", [row.entity_id]);
    }
  } else if (row.entity_type === "campaign_member" && row.kind === "email.send" && status === "sent") {
    await db.query("UPDATE sales_campaign_members SET status = CASE WHEN status = 'targeted' THEN 'sent' ELSE status END WHERE id = $1", [row.entity_id]);
  } else if (row.entity_type === "quotation" && row.kind === "email.send" && status === "sent") {
    await db.query(
      `UPDATE sales_quotations SET status = CASE WHEN status IN ('approved','draft') THEN 'sent' ELSE status END,
         sent_at = COALESCE(sent_at, now()), sent_via = 'email', updated_at = now() WHERE id = $1`,
      [row.entity_id],
    );
  }
}
