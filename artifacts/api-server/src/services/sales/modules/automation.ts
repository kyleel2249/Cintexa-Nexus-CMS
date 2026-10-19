import { randomUUID } from "node:crypto";
import { v, parse } from "../core/validate";
import { created, noContent, type Route, type Deps, type DomainEvent } from "../core/router";
import { notFound, conflict, badRequest, validationFailed } from "../core/errors";
import { audit } from "../core/audit";
import { loadSettings, type SalesSettings } from "../core/settings";
import { businessDate, rangeFromDates, elapsedFraction } from "../core/time";
import { pageOf, str } from "../core/http";
import { attainmentPercent } from "../domain/targets";
import {
  TRIGGERS, TRIGGER_LIST, ACTION_TYPES, CONDITION_OPS, SENSITIVE_ACTIONS, UPDATABLE_FIELDS, SCHEDULED_TRIGGERS, validateRule, entityOf, evaluateConditions, renderTemplate, runKey,
  type RuleDef, type Trigger, type Action, type Condition,
} from "../domain/automation-engine";
import { routeLead } from "./leads";
import { changeOwner, Where } from "./common";
import { notify } from "./activities";
import { actualFor } from "./targets";
import { enqueue } from "../integrations/outbox";
import type { Actor, Db, Queryable } from "../core/types";

const SYSTEM_ACTOR: Actor = { memberId: 0, userSub: "automation", email: "", name: "Automation", role: "sales_admin", teamId: null, teamMemberIds: [], label: "Automation", isApiKey: false };

const TABLE: Record<string, string> = { lead: "sales_leads", opportunity: "sales_opportunities", quotation: "sales_quotations", order: "sales_orders", activity: "sales_activities", account: "sales_accounts", renewal: "sales_renewals", target: "sales_targets" };
const ENTITY_LABEL: Record<string, string> = { lead: "Lead", opportunity: "Opportunity", quotation: "Quotation", order: "Order", activity: "Activity", account: "Account", renewal: "Renewal", target: "Target" };
const LINK: Record<string, (id: number) => string> = {
  lead: (id) => `/sales/leads/${id}`, opportunity: (id) => `/sales/pipeline/${id}`, quotation: (id) => `/sales/quotations/${id}`, order: (id) => `/sales/orders/${id}`,
  activity: () => "/sales/activities", account: (id) => `/sales/accounts/${id}`, renewal: () => "/sales/retention", target: () => "/sales/targets",
};

/** Map what modules emit to the trigger names rules use. */
export function triggersFor(e: DomainEvent): Trigger[] {
  switch (e.type) {
    case "lead.status_changed": return e.data?.to === "qualified" ? ["lead.qualified"] : [];
    case "quotation.approval_requested": return ["quotation.pending_approval"];
    case "order.paid": return ["payment.status_changed"];
    default: return (TRIGGER_LIST as string[]).includes(e.type) ? [e.type as Trigger] : [];
  }
}

interface RuleRow { id: number; name: string; trigger: Trigger; conditions: Condition[]; actions: Action[]; status: string; version: number; max_attempts: number; requires_approval: boolean; approved_by: string | null; created_by: string | null }
const defOf = (r: RuleRow): RuleDef => ({ id: r.id, name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions, status: r.status, version: r.version });

async function activeDefs(q: Queryable): Promise<RuleDef[]> {
  return (await q.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE status = 'active' AND archived_at IS NULL")).rows.map(defOf);
}

async function loadContext(q: Queryable, entityType: string, id: number, data: Record<string, unknown> | undefined, now: Date, settings: SalesSettings): Promise<Record<string, unknown> | null> {
  const table = TABLE[entityType];
  if (!table) return null;
  const row = (await q.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0];
  if (!row) return null;
  const ctx: Record<string, unknown> = { ...row, event: data ?? {} };
  if (entityType === "target") {
    const t = row as any;
    const p = (await q.query<any>("SELECT starts_on, ends_on FROM sales_target_periods WHERE id = $1", [t.period_id])).rows[0];
    if (p) {
      const rg = rangeFromDates(String(p.starts_on).slice(0, 10), String(p.ends_on).slice(0, 10), settings.business.timezone);
      const act = await actualFor(q, t, rg);
      ctx.actual = act.actual;
      ctx.attainment_percent = attainmentPercent(act.actual, t.amount);
      ctx.pace_percent = Math.round(elapsedFraction(rg, now) * 1000) / 10;
    }
  }
  return ctx;
}

interface ExecEnv { q: Queryable; now: Date; settings: SalesSettings; deps: Deps; runId: number; requestId: string; events: DomainEvent[]; depth: number }
type StepResult = { status: "ok" | "skipped"; detail: string };

async function managerOf(q: Queryable, ownerId: number | null, level: "manager" | "director"): Promise<number[]> {
  if (level === "manager" && ownerId) {
    const m = (await q.query<{ id: number }>("SELECT t.manager_member_id AS id FROM sales_members m JOIN sales_teams t ON t.id = m.team_id WHERE m.id = $1 AND t.manager_member_id IS NOT NULL AND t.manager_member_id <> $1", [ownerId])).rows;
    if (m.length) return m.map((x) => x.id);
  }
  const roles = level === "director" ? "('sales_director')" : "('sales_manager','sales_director')";
  return (await q.query<{ id: number }>(`SELECT id FROM sales_members WHERE active AND role IN ${roles}`)).rows.map((x) => x.id);
}

async function execAction(a: Action, i: number, entityType: string, entityId: number, ctx: Record<string, unknown>, env: ExecEnv): Promise<StepResult> {
  const { q, now, settings } = env;
  const p = a.params;
  const ownerId = (ctx.owner_id as number | null | undefined) ?? null;
  const dedupe = `auto:${env.runId}:${i}`;
  switch (a.type) {
    case "create_task":
    case "create_reminder": {
      const subject = renderTemplate(String(p.subject), ctx).slice(0, 200) || "Follow up";
      const due = new Date(now.getTime() + Number(p.dueInDays ?? 1) * 86_400_000).toISOString();
      const link = entityType === "lead" ? "lead_id" : entityType === "account" ? "account_id" : entityType === "opportunity" ? "opportunity_id" : null;
      const accountId = entityType === "account" ? entityId : (ctx.account_id as number | undefined) ?? null;
      const owner = Number.isInteger(p.owner) ? (p.owner as number) : ownerId;
      await q.query(
        `INSERT INTO sales_activities (type, subject, owner_id, ${link ?? "account_id"}, account_id, due_at, priority, dedupe_key, automation_run_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Automation') ON CONFLICT DO NOTHING`,
        [a.type === "create_task" ? "task" : "follow_up", subject, owner, link ? entityId : accountId, accountId, due, ["low", "medium", "high", "urgent"].includes(String(p.priority)) ? p.priority : "medium", dedupe, env.runId]);
      return { status: "ok", detail: `${a.type === "create_task" ? "Task" : "Reminder"} "${subject}" created${owner ? "" : " (unassigned: record has no owner)"}` };
    }
    case "notify": {
      const title = renderTemplate(String(p.title), ctx).slice(0, 160);
      const body = p.body ? renderTemplate(String(p.body), ctx).slice(0, 500) : undefined;
      const targets = Number.isInteger(p.to) ? [p.to as number] : p.to === "manager" || p.to === "director" ? await managerOf(q, ownerId, p.to as "manager" | "director") : ownerId ? [ownerId] : [];
      if (!targets.length) return { status: "skipped", detail: "No recipient: the record has no owner" };
      let n = 0;
      for (const t of targets) if (await notify(q, t, { kind: "automation", title, body, link: LINK[entityType]?.(entityId), severity: p.severity === "critical" || p.severity === "warning" ? (p.severity as "warning" | "critical") : "info", dedupeKey: dedupe })) n++;
      return { status: "ok", detail: `Notified ${n} member(s)` };
    }
    case "escalate": {
      const targets = await managerOf(q, ownerId, p.to as "manager" | "director");
      if (!targets.length) return { status: "skipped", detail: `No active ${p.to} to escalate to` };
      for (const t of targets) await notify(q, t, { kind: "escalation", title: `Escalation: ${ENTITY_LABEL[entityType]} #${entityId}`, body: renderTemplate(String(p.note ?? "{{event.reason}}"), ctx).slice(0, 500) || "Escalated by automation", link: LINK[entityType]?.(entityId), severity: "warning", dedupeKey: dedupe });
      return { status: "ok", detail: `Escalated to ${targets.length} ${p.to}(s)` };
    }
    case "assign": {
      let to: number | null = null;
      if (Number.isInteger(p.to)) to = p.to as number;
      else if (entityType === "lead") to = (await routeLead(q, { ...settings, leads: { ...settings.leads, assignment: p.to === "territory" ? "territory" : "round_robin" } }, ctx as any)).ownerId;
      else {
        const reps = (await q.query<{ id: number }>("SELECT id FROM sales_members WHERE active AND role IN ('sales_rep','sales_manager') ORDER BY id")).rows;
        to = reps.length ? reps[entityId % reps.length]!.id : null;
      }
      if (to === null) return { status: "skipped", detail: "No eligible owner found" };
      if (to === ownerId) return { status: "skipped", detail: "Already owned by that member" };
      await changeOwner(q, SYSTEM_ACTOR, entityType as "lead" | "account" | "opportunity", TABLE[entityType]!, entityId, to, "Automation rule", env.requestId);
      if (entityType === "lead") env.events.push({ type: "lead.assigned", entityType, entityId, data: { owner_id: to }, depth: env.depth + 1 });
      return { status: "ok", detail: `Assigned to member #${to}` };
    }
    case "update_field": {
      const field = String(p.field);
      if (!(UPDATABLE_FIELDS[entityType] ?? []).includes(field)) return { status: "skipped", detail: `Field ${field} cannot be updated` };
      let value = p.value;
      if (typeof value === "string") value = renderTemplate(value, ctx).slice(0, 500);
      const enums: Record<string, string[]> = { priority: ["low", "medium", "high", "urgent"], forecast_category: ["omitted", "pipeline", "best_case", "commit"], status: ["contacted", "nurturing"] };
      if (enums[field] && !enums[field]!.includes(String(value))) return { status: "skipped", detail: `Value "${String(value)}" is not allowed for ${field}` };
      await q.query(`UPDATE ${TABLE[entityType]} SET ${field} = $2, updated_at = now() WHERE id = $1`, [entityId, value]);
      return { status: "ok", detail: `${field} set to ${String(value)}` };
    }
    case "add_tag": {
      await q.query("UPDATE sales_accounts SET tags = CASE WHEN $2 = ANY(tags) THEN tags ELSE array_append(tags, $2) END, updated_at = now() WHERE id = $1", [entityId, String(p.tag)]);
      return { status: "ok", detail: `Tag "${String(p.tag)}" ensured` };
    }
    case "request_approval": {
      const targets = await managerOf(q, ownerId, "manager");
      if (!targets.length) return { status: "skipped", detail: "No manager available to review" };
      for (const t of targets) await notify(q, t, { kind: "approval", title: `Review requested: ${ENTITY_LABEL[entityType]} #${entityId}`, body: "An automation rule asked for a manager review. Nothing was approved automatically.", link: LINK[entityType]?.(entityId), severity: "warning", dedupeKey: dedupe });
      return { status: "ok", detail: `Asked ${targets.length} manager(s) to review (no approval is granted by automation)` };
    }
    case "generate_report": {
      const targets = ownerId ? [ownerId] : await managerOf(q, null, "manager");
      for (const t of targets) await notify(q, t, { kind: "report", title: `Report ready to open: ${String(p.report)}`, link: `/sales/reports?report=${encodeURIComponent(String(p.report))}`, dedupeKey: dedupe });
      return { status: "ok", detail: `Pointed ${targets.length} member(s) to the ${String(p.report)} report` };
    }
    case "send_message": {
      const channel = String(p.channel);
      const prov = channel === "email" ? settings.integrations.email.enabled && env.deps.integrations.email : settings.integrations.whatsapp.enabled && env.deps.integrations.whatsapp;
      if (!prov) return { status: "skipped", detail: `${channel} is not connected, so no message was sent` };
      let to: string | null = null, consent = false;
      if (entityType === "lead") { to = String(channel === "email" ? ctx.email ?? "" : ctx.phone ?? "") || null; consent = Boolean(channel === "email" ? ctx.consent_email : ctx.consent_whatsapp); }
      else if (ctx.account_id || entityType === "account") {
        const c = (await q.query<any>("SELECT email, phone FROM sales_contacts WHERE account_id = $1 AND archived_at IS NULL AND is_primary ORDER BY id LIMIT 1", [entityType === "account" ? entityId : ctx.account_id])).rows[0];
        to = (channel === "email" ? c?.email : c?.phone) ?? null; consent = Boolean(to);
      }
      if (!to) return { status: "skipped", detail: "No recipient address on record" };
      if (!consent) return { status: "skipped", detail: "No recorded consent to contact this person" };
      const text = renderTemplate(String(p.template), ctx).slice(0, 2000);
      const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
      if (channel === "email") await enqueue(q, { kind: "email.send", entityType: "automation_run", entityId: env.runId, idempotencyKey: `auto-msg:${env.runId}:${i}`, payload: { message: { to, subject: renderTemplate(String(p.subject ?? "A message from our sales team"), ctx).slice(0, 150), html: `<p>${esc(text).replace(/\n/g, "<br>")}</p>`, text } } });
      else await enqueue(q, { kind: "whatsapp.send", entityType: "automation_run", entityId: env.runId, idempotencyKey: `auto-msg:${env.runId}:${i}`, payload: { message: { to, template: String(p.template).slice(0, 80), variables: {} } } });
      return { status: "ok", detail: `${channel} message queued (delivery is confirmed by the provider, not by this run)` };
    }
    case "call_integration":
      throw Object.assign(new Error(`No integration named "${String(p.name)}" is registered on this server`), { permanent: true });
  }
}

interface RunOutcome { status: "success" | "failed" | "skipped" | "retrying" | "dead"; result: unknown; error?: string }

async function executeRule(db: Db, deps: Deps, rule: RuleRow, entityType: string, entityId: number, ctx: Record<string, unknown>, runId: number, depth: number, now: Date, settings: SalesSettings): Promise<{ outcome: RunOutcome; events: DomainEvent[] }> {
  const events: DomainEvent[] = [];
  const steps: Array<{ action: string; status: string; detail: string }> = [];
  try {
    await db.tx(async (q) => {
      const env: ExecEnv = { q, now, settings, deps, runId, requestId: `automation-${runId}`, events, depth };
      for (let i = 0; i < rule.actions.length; i++) {
        const a = rule.actions[i]!;
        const r = await execAction(a, i, entityType, entityId, ctx, env);
        steps.push({ action: a.type, ...r });
      }
      await audit(q, SYSTEM_ACTOR, { action: "automation.run", entityType, entityId, summary: `Rule "${rule.name}" v${rule.version}: ${steps.map((s) => `${s.action}=${s.status}`).join(", ")}` }, `automation-${runId}`);
    });
    return { outcome: { status: steps.every((s) => s.status === "skipped") ? "skipped" : "success", result: { steps } }, events };
  } catch (err) {
    const e = err as Error & { permanent?: boolean };
    return { outcome: { status: e.permanent ? "dead" : "failed", result: { steps }, error: String(e.message).slice(0, 500) }, events: [] };
  }
}

async function finishRun(db: Db, runId: number, o: RunOutcome, attempts: number, maxAttempts: number, now: Date): Promise<RunOutcome["status"]> {
  let status = o.status;
  if (status === "failed") status = attempts >= maxAttempts ? "dead" : "retrying";
  const backoff = Math.min(240, 2 ** attempts);
  await db.query(
    "UPDATE sales_automation_runs SET status = $2, attempts = $3, error = $4, result = $5::text::jsonb, finished_at = $6, locked_until = NULL, next_attempt_at = CASE WHEN $2 = 'retrying' THEN $6::timestamptz + ($7 || ' minutes')::interval ELSE NULL END WHERE id = $1",
    [runId, status, attempts, o.error ?? null, JSON.stringify(o.result ?? null), now.toISOString(), String(backoff)]);
  return status;
}

/** Entry point from Deps.onCommitted and from the scheduled scan. Never throws: automation must not break the user's request. */
export async function handleEvents(events: DomainEvent[], ctx: { db: Db; deps: Deps }): Promise<void> {
  const { db, deps } = ctx;
  try {
    const now = deps.now();
    const settings = await loadSettings(db);
    if (!settings.automation.enabled) return;
    for (const e of events) {
      const depth = e.depth ?? 0;
      for (const trig of triggersFor(e)) {
        const only = Number((e.data as any)?.onlyRuleId) || null;
        const rules = (await db.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE status = 'active' AND archived_at IS NULL AND trigger = $1 AND ($2::int IS NULL OR id = $2::int) ORDER BY id", [trig, only])).rows;
        if (!rules.length) continue;
        const entityType = entityOf(trig);
        const context = await loadContext(db, entityType, e.entityId, e.data, now, settings);
        if (!context) continue;
        for (const rule of rules) {
          try {
            if (!evaluateConditions(rule.conditions, context)) continue;
            const key = runKey(rule, trig, entityType, e.entityId, String((e.data as any)?.eventKey ?? `${e.type}:${JSON.stringify(e.data ?? {})}:${now.toISOString().slice(0, 16)}`));
            const ins = await db.query<{ id: number }>(
              "INSERT INTO sales_automation_runs (rule_id, rule_version, idempotency_key, trigger, entity_type, entity_id, depth, status, attempts, started_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'running',0,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id",
              [rule.id, rule.version, key, trig, entityType, e.entityId, depth, now.toISOString()]);
            if (!ins.rows[0]) continue;
            const runId = Number(ins.rows[0].id);
            if (depth >= settings.automation.maxDepth) { await finishRun(db, runId, { status: "skipped", result: { reason: "Maximum automation chain depth reached" } }, 0, 1, now); continue; }
            const today = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_automation_runs WHERE entity_type = $1 AND entity_id = $2 AND started_at >= $3::timestamptz - interval '24 hours' AND is_test = FALSE", [entityType, e.entityId, now.toISOString()])).rows[0]!.n;
            if (today > settings.automation.maxRunsPerRecordPerDay) { await finishRun(db, runId, { status: "skipped", result: { reason: "Daily run limit for this record reached" } }, 0, 1, now); continue; }
            const res = await executeRule(db, deps, rule, entityType, e.entityId, context, runId, depth, now, settings);
            await finishRun(db, runId, res.outcome, 1, rule.max_attempts, now);
            if (res.events.length) await handleEvents(res.events, ctx);
          } catch (err) {
            deps.log.error({ err, rule: rule.id }, "automation rule failed");
          }
        }
      }
    }
  } catch (err) {
    deps.log.error({ err }, "automation dispatch failed");
  }
}

/** Retry runs whose backoff has elapsed. Safe to call repeatedly (each run is claimed with a lease). */
export async function retryRuns(db: Db, deps: Deps, limit = 20): Promise<number> {
  const now = deps.now();
  const settings = await loadSettings(db);
  if (!settings.automation.enabled) return 0;
  const due = (await db.query<any>(
    `UPDATE sales_automation_runs SET locked_until = $2::timestamptz + ($3 || ' seconds')::interval WHERE id IN (
       SELECT id FROM sales_automation_runs WHERE status = 'retrying' AND next_attempt_at <= $2 AND (locked_until IS NULL OR locked_until < $2) ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`,
    [limit, now.toISOString(), String(settings.automation.runLeaseSeconds)])).rows;
  let n = 0;
  for (const run of due) {
    const rule = (await db.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE id = $1", [run.rule_id])).rows[0];
    if (!rule || rule.status !== "active" || rule.version !== run.rule_version) { await finishRun(db, Number(run.id), { status: "dead", result: null, error: "The rule changed or was deactivated before the retry" }, run.attempts, 1, now); continue; }
    const ctx = await loadContext(db, run.entity_type, run.entity_id, undefined, now, settings);
    if (!ctx) { await finishRun(db, Number(run.id), { status: "dead", result: null, error: "The record no longer exists" }, run.attempts, 1, now); continue; }
    const res = await executeRule(db, deps, rule, run.entity_type, run.entity_id, ctx, Number(run.id), run.depth, now, settings);
    await finishRun(db, Number(run.id), res.outcome, run.attempts + 1, rule.max_attempts, now);
    if (res.events.length) await handleEvents(res.events, { db, deps });
    n++;
  }
  return n;
}

/** Clock-driven triggers. Each (rule, entity, day) runs at most once because the event key includes the business date. */
export async function runScheduledTriggers(db: Db, deps: Deps): Promise<number> {
  const now = deps.now();
  const settings = await loadSettings(db);
  if (!settings.automation.enabled) return 0;
  const active = new Set((await db.query<{ trigger: string }>("SELECT DISTINCT trigger FROM sales_automation_rules WHERE status = 'active' AND archived_at IS NULL")).rows.map((r) => r.trigger));
  const today = businessDate(now, settings.business.timezone);
  const iso = now.toISOString();
  const out: DomainEvent[] = [];
  const push = (type: Trigger, rows: Array<{ id: number }>, extra: (r: any) => Record<string, unknown> = () => ({})) => {
    for (const r of rows) out.push({ type, entityType: entityOf(type), entityId: Number(r.id), data: { eventKey: `${type}:${today}`, ...extra(r) } });
  };
  const want = (t: Trigger) => active.has(t) && SCHEDULED_TRIGGERS.includes(t);
  if (want("lead.uncontacted")) push("lead.uncontacted", (await db.query(`SELECT id, EXTRACT(EPOCH FROM ($1::timestamptz - created_at))/3600 AS hours FROM sales_leads WHERE status = 'new' AND last_contact_at IS NULL AND archived_at IS NULL AND merged_into_id IS NULL AND created_at < $1::timestamptz - ($2 || ' hours')::interval LIMIT 500`, [iso, String(settings.leads.responseSlaHours)])).rows, (r) => ({ reason: `No contact for ${Math.floor(Number(r.hours))} hours`, hours: Math.floor(Number(r.hours)) }));
  if (want("opportunity.close_date_approaching")) push("opportunity.close_date_approaching", (await db.query(`SELECT id, (expected_close_date - $1::date)::int AS days FROM sales_opportunities WHERE status = 'open' AND archived_at IS NULL AND expected_close_date BETWEEN $1::date AND $1::date + 7 LIMIT 500`, [today])).rows, (r) => ({ days: r.days, reason: `Close date in ${r.days} day(s)` }));
  if (want("quotation.expiring")) push("quotation.expiring", (await db.query(`SELECT id, (validity_date - $1::date)::int AS days FROM sales_quotations WHERE status IN ('sent','viewed') AND validity_date BETWEEN $1::date AND $1::date + $2::int LIMIT 500`, [today, settings.quotations.expiryReminderDays])).rows, (r) => ({ days: r.days, reason: `Expires in ${r.days} day(s)` }));
  if (want("activity.overdue")) push("activity.overdue", (await db.query(`SELECT id FROM sales_activities WHERE status = 'open' AND COALESCE(due_at, start_at) < $1 LIMIT 500`, [iso])).rows, () => ({ reason: "Activity is overdue" }));
  if (want("account.inactive")) push("account.inactive", (await db.query(`SELECT a.id, (($1::timestamptz - max(o.booked_at)) / interval '1 day')::int AS days FROM sales_accounts a JOIN sales_orders o ON o.account_id = a.id AND o.status <> 'cancelled' AND o.booked_at IS NOT NULL WHERE a.status = 'active' AND a.archived_at IS NULL GROUP BY a.id HAVING max(o.booked_at) < $1::timestamptz - ($2 || ' days')::interval LIMIT 500`, [iso, String(settings.retention.inactiveDays)])).rows, (r) => ({ days: r.days, reason: `No purchase for ${r.days} days` }));
  if (want("renewal.approaching")) push("renewal.approaching", (await db.query(`SELECT id, (renewal_on - $1::date)::int AS days FROM sales_renewals WHERE status = 'upcoming' AND renewal_on BETWEEN $1::date AND $1::date + $2::int LIMIT 500`, [today, Math.max(30, settings.retention.reorderLeadDays)])).rows, (r) => ({ days: r.days, reason: `Renewal in ${r.days} day(s)` }));
  if (want("target.threshold_crossed")) {
    const ts = (await db.query<{ id: number }>(`SELECT t.id FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE p.status = 'approved' AND p.starts_on <= $1::date AND p.ends_on >= $1::date LIMIT 500`, [today])).rows;
    push("target.threshold_crossed", ts, () => ({ eventKey: `target.threshold_crossed:${today}` }));
  }
  if (out.length) await handleEvents(out, { db, deps });
  return out.length;
}

// ───── routes
const condSchema = v.object({ field: v.string({ min: 1, max: 49 }), op: v.enumOf(CONDITION_OPS), value: v.optional(v.any()) });
const actionSchema = v.object({ type: v.enumOf(ACTION_TYPES), params: v.withDefault(v.record(v.any(), { maxKeys: 12 }), {}) });
const ruleBody = v.object({
  name: v.string({ min: 3, max: 120 }), description: v.optional(v.string({ max: 500 })), trigger: v.enumOf(TRIGGER_LIST as [Trigger, ...Trigger[]]),
  conditions: v.withDefault(v.array(condSchema, { max: 10 }), []), actions: v.array(actionSchema, { min: 1, max: 5 }), max_attempts: v.withDefault(v.int({ min: 1, max: 10 }), 3),
});

function issuesOrThrow(def: RuleDef, others: RuleDef[]) {
  const issues = validateRule(def, others);
  if (issues.length) throw validationFailed(issues.map((i) => ({ path: i.path, message: i.message })));
}
const hasSensitive = (actions: Action[]) => actions.some((a) => (SENSITIVE_ACTIONS as string[]).includes(a.type));

export const automationRoutes: Route[] = [
  {
    method: "GET", path: "/automation/meta", permission: "automation:read", tx: false,
    async handler({ settings, deps }) {
      return {
        triggers: TRIGGER_LIST.map((t) => ({ key: t, entity: TRIGGERS[t], scheduled: SCHEDULED_TRIGGERS.includes(t) })), actions: ACTION_TYPES.map((a) => ({ key: a, sensitive: (SENSITIVE_ACTIONS as string[]).includes(a) })),
        operators: CONDITION_OPS, updatableFields: UPDATABLE_FIELDS, enabled: settings.automation.enabled, limits: { maxDepth: settings.automation.maxDepth, maxRunsPerRecordPerDay: settings.automation.maxRunsPerRecordPerDay },
        messaging: { email: Boolean(settings.integrations.email.enabled && deps.integrations.email), whatsapp: Boolean(settings.integrations.whatsapp.enabled && deps.integrations.whatsapp) },
        notes: ["Rules with messaging, integration, report or approval actions need activation by a second person.", "Messages are only sent when a provider is connected and the recipient has recorded consent."],
      };
    },
  },
  {
    method: "GET", path: "/automation/rules", permission: "automation:read", tx: false,
    async handler({ q, query }) {
      const w = new Where().raw("r.archived_at IS NULL");
      if (str(query, "status")) w.and("r.status = ?", parse(v.enumOf(["draft", "active", "paused", "disabled"] as const), str(query, "status")));
      const items = (await q.query(`SELECT r.id, r.name, r.description, r.trigger, r.status, r.version, r.requires_approval, r.approved_by, r.max_attempts, r.updated_at, r.actions, r.conditions,
        (SELECT count(*)::int FROM sales_automation_runs x WHERE x.rule_id = r.id AND x.is_test = FALSE) AS runs,
        (SELECT count(*)::int FROM sales_automation_runs x WHERE x.rule_id = r.id AND x.status IN ('failed','dead','retrying')) AS problems FROM sales_automation_rules r WHERE ${w.sql} ORDER BY r.id DESC`, w.params)).rows;
      return { items };
    },
  },
  {
    method: "POST", path: "/automation/rules", permission: "automation:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(ruleBody, body);
      issuesOrThrow({ name: b.name, trigger: b.trigger, conditions: b.conditions as Condition[], actions: b.actions as Action[] }, await activeDefs(q));
      const r = await q.query<{ id: number }>("INSERT INTO sales_automation_rules (name, description, trigger, conditions, actions, max_attempts, requires_approval, created_by) VALUES ($1,$2,$3,$4::text::jsonb,$5::text::jsonb,$6,$7,$8) RETURNING id",
        [b.name, b.description ?? null, b.trigger, JSON.stringify(b.conditions), JSON.stringify(b.actions), b.max_attempts, hasSensitive(b.actions as Action[]), actor.label]);
      await audit(q, actor, { action: "automation.create", entityType: "automation_rule", entityId: r.rows[0]!.id, summary: `Created rule "${b.name}" (draft)` }, requestId);
      return created({ id: r.rows[0]!.id, status: "draft" });
    },
  },
  {
    method: "GET", path: "/automation/runs", permission: "automation:read", tx: false,
    async handler({ q, query }) {
      const pg = pageOf(query);
      const w = new Where();
      if (str(query, "rule_id")) w.and("x.rule_id = ?", parse(v.id(), str(query, "rule_id")));
      if (str(query, "status")) w.and("x.status = ?", parse(v.enumOf(["running", "success", "failed", "skipped", "retrying", "dead"] as const), str(query, "status")));
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_automation_runs x WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(`SELECT x.id, x.rule_id, r.name AS rule_name, x.rule_version, x.trigger, x.entity_type, x.entity_id, x.status, x.attempts, x.error, x.result, x.is_test, x.depth, x.started_at, x.finished_at, x.next_attempt_at FROM sales_automation_runs x JOIN sales_automation_rules r ON r.id = x.rule_id WHERE ${w.sql} ORDER BY x.id DESC LIMIT $${w.next()} OFFSET $${w.next() + 1}`, [...w.params, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "POST", path: "/automation/runs/:id/retry", permission: "automation:run",
    async handler({ q, actor, params, now, requestId }) {
      const id = parse(v.id(), params.id);
      const run = (await q.query<any>("SELECT * FROM sales_automation_runs WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!run) throw notFound("Run");
      if (!["failed", "dead"].includes(run.status)) throw conflict(`A ${run.status} run cannot be retried`, "invalid_state");
      await q.query("UPDATE sales_automation_runs SET status = 'retrying', next_attempt_at = $2, locked_until = NULL WHERE id = $1", [id, now.toISOString()]);
      await audit(q, actor, { action: "automation.retry", entityType: "automation_run", entityId: id, summary: "Manual retry requested" }, requestId);
      return { ok: true, note: "Queued; the background worker will run it shortly." };
    },
  },
  {
    method: "GET", path: "/automation/rules/:id", permission: "automation:read", tx: false,
    async handler({ q, params }) {
      const id = parse(v.id(), params.id);
      const r = (await q.query<any>("SELECT * FROM sales_automation_rules WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!r) throw notFound("Rule");
      const runs = (await q.query("SELECT id, status, entity_type, entity_id, attempts, error, started_at FROM sales_automation_runs WHERE rule_id = $1 ORDER BY id DESC LIMIT 20", [id])).rows;
      return { rule: r, recentRuns: runs, sensitive: hasSensitive(r.actions) };
    },
  },
  {
    method: "PATCH", path: "/automation/rules/:id", permission: "automation:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const cur = (await q.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Rule");
      const b = parse(ruleBody, { name: cur.name, trigger: cur.trigger, conditions: cur.conditions, actions: cur.actions, max_attempts: cur.max_attempts, ...(body as object) });
      issuesOrThrow({ id, name: b.name, trigger: b.trigger, conditions: b.conditions as Condition[], actions: b.actions as Action[] }, await activeDefs(q));
      // any change creates a new version and returns the rule to draft: it must be re-activated (and re-approved if sensitive)
      await q.query("UPDATE sales_automation_rules SET name=$2, description=COALESCE($3, description), trigger=$4, conditions=$5::text::jsonb, actions=$6::text::jsonb, max_attempts=$7, requires_approval=$8, approved_by=NULL, status='draft', version=version+1, updated_at=now() WHERE id=$1",
        [id, b.name, b.description ?? null, b.trigger, JSON.stringify(b.conditions), JSON.stringify(b.actions), b.max_attempts, hasSensitive(b.actions as Action[])]);
      await audit(q, actor, { action: "automation.update", entityType: "automation_rule", entityId: id, summary: `Updated rule "${b.name}" to v${cur.version + 1}; it is a draft until re-activated` }, requestId);
      return { ok: true, version: cur.version + 1, status: "draft" };
    },
  },
  {
    method: "POST", path: "/automation/rules/:id/activate", permission: "automation:activate",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = (await q.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!r) throw notFound("Rule");
      if (r.status === "active") throw conflict("The rule is already active", "invalid_state");
      issuesOrThrow(defOf(r), (await activeDefs(q)).filter((d) => d.id !== id));
      const sensitive = hasSensitive(r.actions);
      if (sensitive && r.created_by === actor.label) throw conflict("This rule can message customers, call integrations or request approvals, so a different person must activate it", "second_approver_required");
      await q.query("UPDATE sales_automation_rules SET status = 'active', approved_by = $2, updated_at = now() WHERE id = $1", [id, sensitive ? actor.label : null]);
      await audit(q, actor, { action: "automation.activate", entityType: "automation_rule", entityId: id, summary: `Activated "${r.name}" v${r.version}${sensitive ? " (second-person approval)" : ""}` }, requestId);
      return { ok: true, status: "active" };
    },
  },
  {
    method: "POST", path: "/automation/rules/:id/pause", permission: "automation:activate",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_automation_rules SET status = 'paused', updated_at = now() WHERE id = $1 AND status = 'active' AND archived_at IS NULL RETURNING id", [id]);
      if (!r.rows[0]) throw conflict("Only an active rule can be paused", "invalid_state");
      await audit(q, actor, { action: "automation.pause", entityType: "automation_rule", entityId: id, summary: "Paused rule" }, requestId);
      return { ok: true, status: "paused" };
    },
  },
  {
    method: "DELETE", path: "/automation/rules/:id", permission: "automation:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_automation_rules SET archived_at = now(), status = 'disabled', updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Rule");
      await audit(q, actor, { action: "automation.delete", entityType: "automation_rule", entityId: id, summary: "Archived rule (run history is kept)" }, requestId);
      return noContent();
    },
  },
  {
    method: "POST", path: "/automation/rules/:id/test", permission: "automation:write",
    async handler({ q, params, body, now, settings }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ entity_id: v.id() }), body);
      const r = (await q.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!r) throw notFound("Rule");
      const entity = entityOf(r.trigger);
      const ctx = await loadContext(q, entity, b.entity_id, { test: true }, now, settings);
      if (!ctx) throw notFound(ENTITY_LABEL[entity] ?? "Record");
      const matches = evaluateConditions(r.conditions, ctx);
      const plan = r.actions.map((a) => ({ action: a.type, willRun: matches, params: JSON.parse(renderTemplate(JSON.stringify(a.params), ctx).replace(/[\u0000-\u001f]/g, " ")) as unknown }));
      await q.query("INSERT INTO sales_automation_runs (rule_id, rule_version, idempotency_key, trigger, entity_type, entity_id, status, is_test, result, started_at, finished_at) VALUES ($1,$2,$3,$4,$5,$6,'skipped',TRUE,$7::text::jsonb,$8,$8)",
        [id, r.version, `test:${randomUUID()}`, r.trigger, entity, b.entity_id, JSON.stringify({ dryRun: true, matches, plan }), now.toISOString()]);
      return { dryRun: true, matches, conditions: r.conditions.map((c) => ({ ...c, passed: evaluateConditions([c], ctx) })), plan, note: "Nothing was changed. This is what the rule would do right now for this record." };
    },
  },
  {
    method: "POST", path: "/automation/rules/:id/run", permission: "automation:run",
    async handler({ q, actor, params, body, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ entity_id: v.id() }), body);
      const r = (await q.query<RuleRow>("SELECT * FROM sales_automation_rules WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!r) throw notFound("Rule");
      if (r.status !== "active") throw conflict("Only an active rule can be run", "invalid_state");
      const entity = entityOf(r.trigger);
      const ctx = await loadContext(q, entity, b.entity_id, { manual: true }, now, settings);
      if (!ctx) throw notFound(ENTITY_LABEL[entity] ?? "Record");
      if (!evaluateConditions(r.conditions, ctx)) throw conflict("The record does not meet the rule's conditions", "conditions_not_met");
      await audit(q, actor, { action: "automation.manual_run", entityType: "automation_rule", entityId: id, summary: `Manual run on ${entity} #${b.entity_id}` }, requestId);
      events.push({ type: r.trigger, entityType: entity, entityId: b.entity_id, data: { eventKey: `manual:${requestId}`, manual: true, onlyRuleId: id } });
      return { ok: true, queued: true, note: "The rule runs right after this request completes. See Runs for the result." };
    },
  },
];
void db_unused;
function db_unused() {}
