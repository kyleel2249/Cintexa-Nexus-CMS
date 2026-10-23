/**
 * Approval & execution framework.
 *
 *  Every proposed action is stored with the exact payload (hashed) and a fingerprint of the record it concerns.
 *  PENDING → APPROVED → EXECUTING → COMPLETED | FAILED, or REJECTED / CANCELLED / EXPIRED.
 *  Before executing, the approval is re-validated: not expired, record fingerprint unchanged, policy still valid,
 *  and the handler re-checks live business rules. A failed or interrupted execution is never retried automatically.
 *  Actions without a built-in executor are approved as decisions only and must be performed (and attested) by a person.
 */
import { createHash } from "../core/portable";
import type { Actor, Db, Queryable } from "../core/types";
import type { Deps } from "../core/router";
import { audit } from "../core/audit";
import { conflict, forbidden, notFound, badRequest, unprocessable } from "../core/errors";
import { v, parse } from "../core/validate";
import { notify } from "../modules/activities";
import { enqueue } from "../integrations/outbox";
import type { Proposal } from "./types";
import { seedPolicies } from "./policy-seed";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED";

export interface Policy { action_type: string; label: string; requires_approval: boolean; always_protected: boolean; auto_executable: boolean; has_executor: boolean; approver_role: string; threshold_amount: string | null; ttl_hours: number }
export interface ApprovalRow {
  id: number; action_type: string; agent_key: string | null; recommendation_id: number | null; entity_type: string | null; entity_id: number | null; summary: string; payload: Record<string, any>;
  payload_hash: string; data_version: string | null; amount: string | null; currency: string | null; required_role: string; status: ApprovalStatus; requested_by: string; decided_by: string | null;
  decided_at: string | null; decision_note: string | null; expires_at: string; executed_at: string | null; execution_mode: string | null; result: unknown; error: string | null; idempotency_key: string; created_at: string;
}

const RANK: Record<string, number> = { sales_manager: 1, sales_director: 2, sales_admin: 3 };
const SYSTEM_ACTOR = (agentKey: string): Pick<Actor, "userSub" | "label"> => ({ userSub: `agent:${agentKey}`, label: `agent:${agentKey}` });

/** Can this person decide an approval that needs `requiredRole`? Finance-gated actions need finance (or an administrator). */
export function canDecide(actor: Pick<Actor, "role">, requiredRole: string): boolean {
  if (actor.role === "sales_admin") return true;
  if (requiredRole === "finance") return actor.role === "finance";
  return (RANK[actor.role] ?? 0) >= (RANK[requiredRole] ?? 99);
}

function stable(x: unknown): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x ?? null);
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  return `{${Object.keys(x as object).sort().map((k) => `${JSON.stringify(k)}:${stable((x as any)[k])}`).join(",")}}`;
}
export const hashPayload = (payload: unknown): string => createHash("sha256").update(stable(payload)).digest("hex");

/** Fingerprint of the *material* fields of a record. Any change invalidates an outstanding approval. */
const VERSION_SQL: Record<string, string> = {
  lead: "SELECT md5(concat_ws('|', owner_id, status, email, converted_opportunity_id)) v FROM sales_leads WHERE id = $1",
  account: "SELECT md5(concat_ws('|', owner_id, status, name)) v FROM sales_accounts WHERE id = $1",
  opportunity: "SELECT md5(concat_ws('|', stage_id, amount, status, owner_id, expected_close_date)) v FROM sales_opportunities WHERE id = $1",
  quotation: "SELECT md5(concat_ws('|', status, total, validity_date, version)) v FROM sales_quotations WHERE id = $1",
  order: "SELECT md5(concat_ws('|', status, total, payment_status)) v FROM sales_orders WHERE id = $1",
  activity: "SELECT md5(concat_ws('|', status, due_at, owner_id)) v FROM sales_activities WHERE id = $1",
};
export async function dataVersion(q: Queryable, entityType: string | null | undefined, entityId: number | null | undefined): Promise<string | null> {
  if (!entityType || !entityId || !VERSION_SQL[entityType]) return null;
  return (await q.query<{ v: string }>(VERSION_SQL[entityType]!, [entityId])).rows[0]?.v ?? null;
}

export async function getPolicy(q: Queryable, actionType: string): Promise<Policy> {
  let p = (await q.query<Policy>("SELECT * FROM sales_approval_policies WHERE action_type = $1", [actionType])).rows[0];
  if (!p) { await seedPolicies(q); p = (await q.query<Policy>("SELECT * FROM sales_approval_policies WHERE action_type = $1", [actionType])).rows[0]; }
  if (!p) throw badRequest(`Unknown action type "${actionType}"`);
  return p;
}

export interface RequestInput { proposal: Proposal; agentKey?: string; requestedBy?: string; recommendationId?: number | null; now: Date; idempotencyKey?: string }

/** Create the approval record (idempotent). Returns the row and whether policy allows automatic execution. */
export async function requestAction(q: Queryable, input: RequestInput): Promise<{ approval: ApprovalRow; created: boolean; policy: Policy }> {
  const { proposal: p } = input;
  const policy = await getPolicy(q, p.actionType);
  const payload = JSON.parse(JSON.stringify(p.payload ?? {}));
  if (JSON.stringify(payload).length > 8000) throw badRequest("Proposed action payload is too large");
  const version = await dataVersion(q, p.entityType, p.entityId);
  const hash = hashPayload(payload);
  const requires = policy.always_protected || policy.requires_approval || (policy.threshold_amount !== null && p.amount !== undefined && Number(p.amount) >= Number(policy.threshold_amount));
  const requestedBy = input.requestedBy ?? (input.agentKey ? `agent:${input.agentKey}` : "system");
  const cycle = Math.floor(input.now.getTime() / (policy.ttl_hours * 3600_000)); // an unanswered request may be raised again after one TTL window
  const key = input.idempotencyKey ?? `${p.actionType}:${p.entityType}:${p.entityId}:${hash.slice(0, 16)}:${version ?? "-"}:${cycle}`;
  const expires = new Date(input.now.getTime() + policy.ttl_hours * 3600_000).toISOString();
  const ins = await q.query<ApprovalRow>(
    `INSERT INTO sales_approvals (action_type, agent_key, recommendation_id, entity_type, entity_id, summary, payload, payload_hash, data_version, amount, currency, required_role, status, requested_by, decided_by, decided_at, decision_note, expires_at, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [p.actionType, input.agentKey ?? null, input.recommendationId ?? null, p.entityType, p.entityId, p.summary.slice(0, 300), JSON.stringify(payload), hash, version, p.amount ?? null, p.currency ?? null, policy.approver_role,
      requires ? "PENDING" : "APPROVED", requestedBy, requires ? null : "policy:auto", requires ? null : input.now.toISOString(), requires ? null : "Approved automatically: this action type does not require approval under current policy", expires, key]);
  if (ins.rows[0]) {
    await audit(q, SYSTEM_ACTOR(input.agentKey ?? "system"), { action: requires ? "approval.request" : "approval.auto_approve", entityType: "approval", entityId: ins.rows[0].id, summary: `${policy.label}: ${p.summary}` });
    return { approval: ins.rows[0], created: true, policy };
  }
  const ex = (await q.query<ApprovalRow>("SELECT * FROM sales_approvals WHERE idempotency_key = $1", [key])).rows[0]!;
  return { approval: ex, created: false, policy };
}

async function lock(q: Queryable, id: number): Promise<ApprovalRow> {
  const a = (await q.query<ApprovalRow>("SELECT * FROM sales_approvals WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!a) throw notFound("Approval");
  return a;
}

export async function decideApproval(q: Queryable, actor: Actor, id: number, decision: "approve" | "reject", note: string | undefined, now: Date, requestId?: string): Promise<ApprovalRow> {
  const a = await lock(q, id);
  if (a.status !== "PENDING") throw conflict(`This approval is already ${a.status}`, "approval_not_pending");
  if (new Date(a.expires_at) < now) {
    await q.query("UPDATE sales_approvals SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [id]);
    throw conflict("This approval has expired. Ask the agent to propose it again.", "approval_expired");
  }
  if (!canDecide(actor, a.required_role)) throw forbidden(`This approval needs the ${a.required_role.replace("_", " ")} role`, "approver_role_required");
  if (a.requested_by === actor.userSub) throw forbidden("You cannot decide an approval you requested yourself", "self_approval");
  if (decision === "reject" && !(note && note.trim().length >= 3)) throw unprocessable("Give a reason for rejecting");
  const row = (await q.query<ApprovalRow>("UPDATE sales_approvals SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5, updated_at = now() WHERE id = $1 RETURNING *", [id, decision === "approve" ? "APPROVED" : "REJECTED", actor.userSub, now.toISOString(), note ?? null])).rows[0]!;
  await audit(q, actor, { action: `approval.${decision}`, entityType: "approval", entityId: id, summary: `${decision === "approve" ? "Approved" : "Rejected"}: ${a.summary}`, before: { status: a.status }, after: { status: row.status, note } }, requestId);
  if (a.recommendation_id) await q.query(`UPDATE sales_agent_recommendations SET status = $2, decided_by = $3, decided_at = $4, updated_at = now() WHERE id = $1 AND status IN ('open','accepted')`, [a.recommendation_id, decision === "approve" ? "accepted" : "dismissed", actor.userSub, now.toISOString()]);
  return row;
}

export async function cancelApproval(q: Queryable, actor: Actor, id: number, now: Date, requestId?: string): Promise<ApprovalRow> {
  const a = await lock(q, id);
  if (!["PENDING", "APPROVED"].includes(a.status)) throw conflict(`A ${a.status} approval cannot be cancelled`);
  if (a.requested_by !== actor.userSub && !canDecide(actor, a.required_role)) throw forbidden("Only the requester or an approver can cancel");
  const row = (await q.query<ApprovalRow>("UPDATE sales_approvals SET status = 'CANCELLED', decided_by = COALESCE(decided_by, $2), decided_at = COALESCE(decided_at, $3), updated_at = now() WHERE id = $1 RETURNING *", [id, actor.userSub, now.toISOString()])).rows[0]!;
  await audit(q, actor, { action: "approval.cancel", entityType: "approval", entityId: id, summary: `Cancelled: ${a.summary}` }, requestId);
  return row;
}

// ───────────────────────────── executors ─────────────────────────────
interface ExecCtx { q: Queryable; deps: Deps; now: Date; approval: ApprovalRow; payload: Record<string, any> }
type Handler = (c: ExecCtx) => Promise<Record<string, unknown>>;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const HANDLERS: Record<string, Handler> = {
  async "activity.create_followup"({ q, payload }) {
    const b = parse(v.object({ subject: v.string({ min: 2, max: 200 }), description: v.optional(v.string({ max: 1000 })), due_on: v.date(), owner_id: v.id(), opportunity_id: v.optional(v.id()), lead_id: v.optional(v.id()), account_id: v.optional(v.id()), priority: v.enumOf(PRIORITIES), dedupe_key: v.string({ min: 4, max: 160 }) }), payload);
    const owner = (await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [b.owner_id])).rows[0];
    if (!owner) throw unprocessable("The task owner is no longer an active member");
    let accountId = b.account_id ?? null;
    if (b.opportunity_id) {
      const o = (await q.query<any>("SELECT status, account_id FROM sales_opportunities WHERE id = $1 AND archived_at IS NULL", [b.opportunity_id])).rows[0];
      if (!o || o.status !== "open") throw unprocessable("The opportunity is no longer open");
      accountId = accountId ?? o.account_id;
    }
    if (b.lead_id) {
      const l = (await q.query<any>("SELECT status FROM sales_leads WHERE id = $1 AND archived_at IS NULL", [b.lead_id])).rows[0];
      if (!l || ["converted", "disqualified"].includes(l.status)) throw unprocessable("The lead is no longer active");
    }
    const r = await q.query<{ id: number }>(`INSERT INTO sales_activities (type, subject, description, owner_id, lead_id, account_id, opportunity_id, due_at, status, priority, dedupe_key, created_by) VALUES ('follow_up',$1,$2,$3,$4,$5,$6,$7,'open',$8,$9,'agent') ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
      [b.subject, b.description ?? null, b.owner_id, b.lead_id ?? null, accountId, b.opportunity_id ?? null, `${b.due_on}T09:00:00Z`, b.priority, b.dedupe_key]);
    return r.rows[0] ? { created: true, activity_id: r.rows[0].id } : { created: false, reason: "An identical task already exists" };
  },
  async "notification.internal"({ q, payload }) {
    const b = parse(v.object({ member_id: v.id(), kind: v.string({ max: 60 }), title: v.string({ min: 2, max: 200 }), body: v.optional(v.string({ max: 500 })), link: v.optional(v.string({ max: 300 })), severity: v.enumOf(["info", "warning", "critical"] as const), dedupe_key: v.string({ min: 4, max: 160 }) }), payload);
    const m = (await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [b.member_id])).rows[0];
    if (!m) throw unprocessable("The recipient is no longer an active member");
    const delivered = await notify(q, b.member_id, { kind: b.kind, title: b.title, body: b.body, link: b.link?.startsWith("/sales") ? b.link : undefined, severity: b.severity, dedupeKey: b.dedupe_key });
    return { delivered, note: delivered ? "In-app notification created" : "Already notified (duplicate suppressed)" };
  },
  async "lead.assign"({ q, payload, approval }) {
    const b = parse(v.object({ lead_id: v.id(), owner_id: v.id(), reason: v.optional(v.string({ max: 300 })) }), payload);
    const l = (await q.query<any>("SELECT id, number, owner_id, status FROM sales_leads WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [b.lead_id])).rows[0];
    if (!l) throw unprocessable("The lead no longer exists");
    if (l.owner_id !== null) throw unprocessable("The lead already has an owner; nothing was changed");
    if (["converted", "disqualified"].includes(l.status)) throw unprocessable("The lead is no longer active");
    const m = (await q.query("SELECT 1 FROM sales_members WHERE id = $1 AND active", [b.owner_id])).rows[0];
    if (!m) throw unprocessable("The new owner is no longer an active member");
    await q.query("UPDATE sales_leads SET owner_id = $2, updated_at = now() WHERE id = $1", [b.lead_id, b.owner_id]);
    await q.query("INSERT INTO sales_ownership_history (entity_type, entity_id, from_owner_id, to_owner_id, changed_by, reason) VALUES ('lead',$1,NULL,$2,$3,$4)", [b.lead_id, b.owner_id, approval.agent_key ? `agent:${approval.agent_key}` : "system", b.reason ?? "Assigned by agent"]);
    await notify(q, b.owner_id, { kind: "lead_assigned", title: `New lead assigned: ${l.number}`, link: `/sales/leads/${b.lead_id}`, severity: "info", dedupeKey: `agent-assign:${b.lead_id}:${b.owner_id}` });
    return { assigned: true, lead_id: b.lead_id, owner_id: b.owner_id };
  },
  async "message.customer"({ q, payload, approval }) {
    const b = parse(v.object({ channel: v.enumOf(["email"] as const), to: v.email(), subject: v.string({ min: 2, max: 200 }), body: v.string({ min: 2, max: 4000, raw: true }), contact_id: v.optional(v.id()), quotation_id: v.optional(v.id()) }), payload);
    const c = b.contact_id ? (await q.query<any>("SELECT email, consent_email, unsubscribed_at FROM sales_contacts WHERE id = $1 AND archived_at IS NULL", [b.contact_id])).rows[0] : undefined;
    if (!c || String(c.email).toLowerCase() !== b.to.toLowerCase() || !c.consent_email || c.unsubscribed_at) throw unprocessable("The recipient has no current recorded email consent, so nothing was queued");
    if (b.quotation_id) {
      const x = (await q.query<any>("SELECT status, validity_date FROM sales_quotations WHERE id = $1", [b.quotation_id])).rows[0];
      if (!x || !["sent", "viewed"].includes(x.status)) throw unprocessable("The quotation is no longer awaiting a customer response");
    }
    const id = await enqueue(q, { kind: "email.send", entityType: "agent_approval", entityId: approval.id, idempotencyKey: `agent-msg:${approval.id}`, payload: { message: { to: b.to, subject: b.subject, html: `<p>${esc(b.body).replace(/\n/g, "<br>")}</p>`, text: b.body } } });
    return { queued: true, outbox_id: id, delivery: "queued", note: "Queued for the email provider. It is not delivered until the provider confirms; check the outbox for the real status." };
  },
};
export const EXECUTOR_TYPES = Object.keys(HANDLERS);

/** Final validation, then execute. Two transactions so EXECUTING is a durable, visible state. */
export async function executeApproval(db: Db, deps: Deps, id: number, by: Pick<Actor, "userSub" | "label">, mode: "automatic" | "manual" = "automatic"): Promise<ApprovalRow> {
  const now = deps.now();
  // Validation failures that must be *recorded* (expired / altered / changed) are returned from the transaction and thrown
  // afterwards, so the state change is committed instead of being rolled back by the exception.
  const checked = await db.tx(async (q): Promise<{ row: ApprovalRow } | { error: Error }> => {
    const row = await lock(q, id);
    if (row.status !== "APPROVED") return { error: conflict(`Only APPROVED actions can be executed (this one is ${row.status})`, "not_approved") };
    if (new Date(row.expires_at) < now) {
      await q.query("UPDATE sales_approvals SET status = 'EXPIRED', error = 'Approval expired before execution', updated_at = now() WHERE id = $1", [id]);
      return { error: conflict("The approval expired before it was executed", "approval_expired") };
    }
    const policy = await getPolicy(q, row.action_type);
    if (!policy.has_executor) return { error: conflict("This action type has no automatic executor. Perform it in the relevant screen, then record it as completed manually.", "no_executor") };
    if (hashPayload(row.payload) !== row.payload_hash) {
      await q.query("UPDATE sales_approvals SET status = 'FAILED', error = 'Payload no longer matches what was approved', updated_at = now() WHERE id = $1", [id]);
      await audit(q, by, { action: "approval.invalidate", entityType: "approval", entityId: id, summary: "Payload altered after approval; execution refused" });
      return { error: conflict("The approved payload was altered; execution refused", "payload_changed") };
    }
    const current = await dataVersion(q, row.entity_type, row.entity_id);
    if (row.data_version !== null && current !== row.data_version) {
      await q.query("UPDATE sales_approvals SET status = 'EXPIRED', error = 'The record changed after approval; ask for a fresh approval', updated_at = now() WHERE id = $1", [id]);
      await audit(q, by, { action: "approval.invalidate", entityType: "approval", entityId: id, summary: "Record changed after approval; approval invalidated" });
      return { error: conflict("The record changed after approval, so the approval was invalidated. A fresh request is needed.", "data_changed") };
    }
    return { row: (await q.query<ApprovalRow>("UPDATE sales_approvals SET status = 'EXECUTING', execution_mode = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, mode])).rows[0]! };
  });
  if ("error" in checked) throw checked.error;
  const a = checked.row;
  try {
    return await db.tx(async (q) => {
      const result = await HANDLERS[a.action_type]!({ q, deps, now, approval: a, payload: a.payload });
      const row = (await q.query<ApprovalRow>("UPDATE sales_approvals SET status = 'COMPLETED', executed_at = $2, result = $3::text::jsonb, error = NULL, updated_at = now() WHERE id = $1 RETURNING *", [id, now.toISOString(), JSON.stringify(result)])).rows[0]!;
      await audit(q, by, { action: "approval.execute", entityType: "approval", entityId: id, summary: `Executed ${a.action_type}: ${a.summary}`, after: result });
      if (a.recommendation_id) await q.query("UPDATE sales_agent_recommendations SET status = 'actioned', updated_at = now() WHERE id = $1 AND status IN ('open','accepted')", [a.recommendation_id]);
      return row;
    });
  } catch (err) {
    const msg = (err instanceof Error ? err.message : "Execution failed").slice(0, 400);
    const row = (await db.query<ApprovalRow>("UPDATE sales_approvals SET status = 'FAILED', error = $2, updated_at = now() WHERE id = $1 RETURNING *", [id, msg])).rows[0]!;
    await db.query("INSERT INTO sales_audit_events (actor_id, actor_label, action, entity_type, entity_id, summary) VALUES ($1,$2,'approval.execute_failed','approval',$3,$4)", [by.userSub, by.label, String(id), `Execution failed: ${msg}`]).catch(() => undefined);
    return row;
  }
}

/** A person did the work in the normal screens and attests it. Recorded as manual; the system makes no claim about the result. */
export async function completeManually(q: Queryable, actor: Actor, id: number, note: string | undefined, now: Date, requestId?: string): Promise<ApprovalRow> {
  const a = await lock(q, id);
  if (a.status !== "APPROVED") throw conflict(`Only APPROVED actions can be marked completed (this one is ${a.status})`);
  if (!canDecide(actor, a.required_role)) throw forbidden("Only an authorised approver can attest completion");
  if (!(note && note.trim().length >= 3)) throw unprocessable("Describe what was done");
  const row = (await q.query<ApprovalRow>("UPDATE sales_approvals SET status = 'COMPLETED', execution_mode = 'manual', executed_at = $2, result = $3::text::jsonb, updated_at = now() WHERE id = $1 RETURNING *", [id, now.toISOString(), JSON.stringify({ attestedBy: actor.label, note })])).rows[0]!;
  await audit(q, actor, { action: "approval.complete_manually", entityType: "approval", entityId: id, summary: `Manually completed: ${a.summary}`, after: { note } }, requestId);
  if (a.recommendation_id) await q.query("UPDATE sales_agent_recommendations SET status = 'actioned', updated_at = now() WHERE id = $1 AND status IN ('open','accepted')", [a.recommendation_id]);
  return row;
}

/** Housekeeping: expire stale approvals; interrupted executions are failed, never retried. */
export async function sweepApprovals(db: Db, now: Date): Promise<{ expired: number; interrupted: number }> {
  const e = await db.query("UPDATE sales_approvals SET status = 'EXPIRED', updated_at = now() WHERE status IN ('PENDING','APPROVED') AND expires_at < $1::timestamptz RETURNING id", [now.toISOString()]);
  const s = await db.query("UPDATE sales_approvals SET status = 'FAILED', error = 'Execution was interrupted (no result recorded). Verify the real-world effect before re-requesting.', updated_at = now() WHERE status = 'EXECUTING' AND updated_at < $1::timestamptz - interval '15 minutes' RETURNING id", [now.toISOString()]);
  return { expired: e.rowCount, interrupted: s.rowCount };
}
