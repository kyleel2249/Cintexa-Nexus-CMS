import type { ActionExecutor } from './orchestrator';
import type { IntelDb } from './sql-store';

/**
 * Executors run ONLY after the orchestrator's approval/autonomy gate. Only actions that are reversible, internal and
 * low-risk have one. Anything else (e-mail, discounts, orders, payouts, website changes ...) has no executor, so approving
 * it is recorded as `no_executor_configured` rather than falsely reporting success.
 */
export function salesExecutors(db: IntelDb, now: () => Date = () => new Date()): Record<string, ActionExecutor> {
  return {
    async create_followup_activity(action, ctx) {
      const p = action.payload as { leadId?: unknown; opportunityId?: unknown; subject?: unknown; reason?: unknown; dueInDays?: unknown };
      const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
      if ((isId(p.leadId) ? 1 : 0) + (isId(p.opportunityId) ? 1 : 0) !== 1) return { ok: false, detail: 'invalid_payload: exactly one of leadId / opportunityId required' };
      if (typeof p.subject !== 'string' || !p.subject.trim() || p.subject.length > 200) return { ok: false, detail: 'invalid_payload: subject' };
      const days = typeof p.dueInDays === 'number' && Number.isInteger(p.dueInDays) && p.dueInDays >= 0 && p.dueInDays <= 30 ? p.dueInDays : 1;
      const isLead = isId(p.leadId), table = isLead ? 'sales_leads' : 'sales_opportunities', id = (isLead ? p.leadId : p.opportunityId) as number;
      const target = (await db.query(`SELECT id FROM ${table} WHERE id=$1`, [id])).rows;
      if (!target.length) return { ok: false, detail: 'target_not_found' };
      const due = new Date(now().getTime() + days * 86_400_000).toISOString();
      const key = `intel:${ctx.idempotencyKey}`;
      const ins = await db.query<{ id: number }>(
        `INSERT INTO sales_activities (type, subject, description, ${isLead ? 'lead_id' : 'opportunity_id'}, due_at, status, priority, dedupe_key, created_by)
         VALUES ('follow_up', $1, $2, $3, $4, 'open', 'medium', $5, $6)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
        [p.subject.trim(), typeof p.reason === 'string' ? p.reason.slice(0, 500) : null, id, due, key, `intelligence:${ctx.approvedBy}`]);
      if (!ins.rows.length) return { ok: true, detail: 'already_created' }; // idempotent replay
      try {
        await db.query(`INSERT INTO sales_audit_events (actor_id, actor_label, action, entity_type, entity_id, summary) VALUES ($1,$2,'activity.create','activity',$3,$4)`,
          [ctx.approvedBy, 'Intelligence (approved action)', String(ins.rows[0].id), `Follow-up created for ${isLead ? 'lead' : 'opportunity'} #${id}: ${p.subject.trim()}`]);
      } catch { /* the activity exists; the Sales audit table being absent must not hide that */ }
      return { ok: true, detail: `activity_${ins.rows[0].id}_created` };
    },
  };
}
