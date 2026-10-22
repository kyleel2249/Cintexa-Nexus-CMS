import { S } from './validate';
import { ToolRegistry } from './tools';
import type { IntelDb } from './sql-store';

/**
 * Read-only Sales tools. Every number comes from SQL over the Sales tables (never from a model). Sales data is a single
 * business database (the tenant boundary is the database / the signed-in deployment), so these queries carry no org column;
 * the orchestrator still scopes tasks, findings, approvals and audit by org_id.
 * Output conventions: money as float8 (display only - ledgers stay NUMERIC), dates as 'YYYY-MM-DD', timestamps as ISO-8601 UTC.
 */
const TS = (c: string) => `to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const D = (c: string) => `to_char(${c},'YYYY-MM-DD')`;
const DAY = 86_400_000;

export interface SalesToolOptions { now?: () => Date }

export function registerSalesTools(reg: ToolRegistry, db: IntelDb, opts: SalesToolOptions = {}): void {
  const now = () => (opts.now ?? (() => new Date()))();
  const iso = (d: Date) => d.toISOString();
  const ago = (days: number) => iso(new Date(now().getTime() - days * DAY));
  const today = () => iso(now()).slice(0, 10);
  const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
  const days = S.obj({ days: S.num({ min: 1, max: 730, int: true }) }, ['days']);
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

  reg.register({
    name: 'sales.revenue', risk: 'read', description: 'Booked / collected / outstanding revenue by currency for a window and the equal window before it.', args: days,
    async handler(a: { days?: number }) {
      const n = a.days ?? 90;
      const cur = ago(n), prev = ago(n * 2);
      const win = async (from: string, to: string) => q(
        `SELECT currency, COUNT(*)::int orders, COALESCE(SUM(total),0)::float8 booked, COALESCE(SUM(paid_total),0)::float8 collected, COALESCE(SUM(returned_total),0)::float8 returned
         FROM sales_orders WHERE booked_at >= $1 AND booked_at < $2 AND status NOT IN ('draft','cancelled') GROUP BY currency ORDER BY currency`, [from, to]);
      const monthly = await q(
        `SELECT currency, to_char(booked_at AT TIME ZONE 'UTC','YYYY-MM') AS month, COALESCE(SUM(total),0)::float8 booked, COUNT(*)::int orders
         FROM sales_orders WHERE booked_at >= $1 AND status NOT IN ('draft','cancelled') GROUP BY currency, month ORDER BY month`, [ago(400)]);
      const outstanding = await q(
        `SELECT currency, COUNT(*)::int orders, COALESCE(SUM(total - paid_total - returned_total),0)::float8 amount,
                COALESCE(SUM(total - paid_total - returned_total) FILTER (WHERE invoice_due_on < $1::date),0)::float8 overdue_amount,
                COUNT(*) FILTER (WHERE invoice_due_on < $1::date)::int overdue_orders
         FROM sales_orders WHERE status NOT IN ('draft','cancelled') AND payment_status IN ('unpaid','partial') GROUP BY currency`, [today()]);
      return { windowDays: n, current: await win(cur, iso(now())), previous: await win(prev, cur), monthly, outstanding, asOf: iso(now()), source: 'sales_orders.booked_at/total/paid_total' };
    },
  });

  reg.register({
    name: 'sales.pipeline', risk: 'read', description: 'Open opportunities with stage age, close-date and qualification signals.', args: S.obj({}),
    async handler() {
      const rows = await q(
        `SELECT o.id, o.number, o.name, o.amount::float8 amount, o.currency, o.probability::float8 probability, ${D('o.expected_close_date')} close_date, o.owner_id,
                s.name stage, s.stalled_after_days stall_days, o.forecast_category, o.close_date_changes::int close_date_changes,
                (o.stakeholders IS NULL OR btrim(o.stakeholders) = '') no_stakeholders, (o.next_action IS NULL OR btrim(o.next_action) = '') no_next_action,
                ${D('o.next_action_date')} next_action_date, ${TS('o.created_at')} created_at,
                (SELECT ${TS('max(h.at)')} FROM sales_opportunity_stage_history h WHERE h.opportunity_id = o.id) last_stage_change,
                (SELECT ${TS('max(a.completed_at)')} FROM sales_activities a WHERE a.opportunity_id = o.id AND a.status = 'done') last_activity
         FROM sales_opportunities o JOIN sales_pipeline_stages s ON s.id = o.stage_id WHERE o.status = 'open' ORDER BY o.amount DESC LIMIT 1000`);
      return { opportunities: rows, asOf: iso(now()), today: today(), source: 'sales_opportunities' };
    },
  });

  reg.register({
    name: 'sales.outcomes', risk: 'read', description: 'Won/lost counts, amounts, average cycle and loss reasons.', args: days,
    async handler(a: { days?: number }) {
      const from = ago(a.days ?? 180);
      const byCur = await q(
        `SELECT currency, COUNT(*) FILTER (WHERE status='won')::int won, COUNT(*) FILTER (WHERE status='lost')::int lost,
                COALESCE(SUM(amount) FILTER (WHERE status='won'),0)::float8 won_amount, COALESCE(SUM(amount) FILTER (WHERE status='lost'),0)::float8 lost_amount,
                AVG(EXTRACT(EPOCH FROM (closed_at - created_at))/86400) FILTER (WHERE status='won')::float8 avg_cycle_days
         FROM sales_opportunities WHERE status IN ('won','lost') AND closed_at >= $1 GROUP BY currency ORDER BY currency`, [from]);
      const reasons = await q(`SELECT COALESCE(lost_reason,'(none)') reason, COUNT(*)::int n FROM sales_opportunities WHERE status='lost' AND closed_at >= $1 GROUP BY 1 ORDER BY n DESC LIMIT 5`, [from]);
      return { windowDays: a.days ?? 180, byCurrency: byCur, lossReasons: reasons, asOf: iso(now()), source: 'sales_opportunities.status/closed_at' };
    },
  });

  reg.register({
    name: 'sales.leads', risk: 'read', description: 'Lead funnel, stale leads, overdue follow-ups and missing qualification data.', args: S.obj({}),
    async handler() {
      const funnel = await q(`SELECT status, COUNT(*)::int n FROM sales_leads WHERE archived_at IS NULL AND merged_into_id IS NULL GROUP BY status`);
      const bySource = await q(`SELECT COALESCE(source,'(unknown)') source, COUNT(*)::int total, COUNT(*) FILTER (WHERE status='converted')::int converted FROM sales_leads WHERE archived_at IS NULL AND merged_into_id IS NULL GROUP BY 1 ORDER BY total DESC LIMIT 10`);
      const open = `archived_at IS NULL AND merged_into_id IS NULL AND status NOT IN ('converted','disqualified')`;
      const stale = await q(`SELECT id, number, first_name, last_name, company, score::int score, status, ${TS('COALESCE(last_contact_at, created_at)')} last_touch FROM sales_leads
        WHERE ${open} AND COALESCE(last_contact_at, created_at) < $1 ORDER BY score DESC, id LIMIT 25`, [ago(7)]);
      const overdue = await q(`SELECT id, number, first_name, last_name, company, score::int score, ${TS('next_follow_up_at')} due FROM sales_leads
        WHERE ${open} AND next_follow_up_at < $1 ORDER BY next_follow_up_at LIMIT 25`, [iso(now())]);
      const counts = await q(`SELECT COUNT(*)::int open_leads,
          COUNT(*) FILTER (WHERE COALESCE(last_contact_at, created_at) < $1)::int stale,
          COUNT(*) FILTER (WHERE next_follow_up_at < $2)::int overdue_followups,
          COUNT(*) FILTER (WHERE (email IS NULL OR btrim(email)='') AND (phone IS NULL OR btrim(phone)=''))::int no_contact_info,
          COUNT(*) FILTER (WHERE score >= 70)::int hot FROM sales_leads WHERE ${open}`, [ago(7), iso(now())]);
      const created = await q(`SELECT COUNT(*)::int n FROM sales_leads WHERE archived_at IS NULL AND created_at >= $1`, [ago(30)]);
      return { funnel, bySource, stale, overdueFollowups: overdue, counts: counts[0], created30d: num(created[0]?.n), asOf: iso(now()), source: 'sales_leads' };
    },
  });

  reg.register({
    name: 'sales.activities', risk: 'read', description: 'Overdue and recently completed sales activities.', args: S.obj({}),
    async handler() {
      const overdue = await q(`SELECT type, COUNT(*)::int n, MIN(${TS('due_at')}) oldest FROM sales_activities WHERE status='open' AND due_at < $1 GROUP BY type ORDER BY n DESC`, [iso(now())]);
      const total = await q(`SELECT COUNT(*) FILTER (WHERE status='open' AND due_at < $1)::int overdue, COUNT(*) FILTER (WHERE status='open')::int open,
        COUNT(*) FILTER (WHERE status='done' AND completed_at >= $2)::int done7d FROM sales_activities`, [iso(now()), ago(7)]);
      return { overdueByType: overdue, totals: total[0], asOf: iso(now()), source: 'sales_activities' };
    },
  });

  reg.register({
    name: 'sales.targets', risk: 'read', description: 'Company revenue target vs booked revenue for the approved period containing today.', args: S.obj({}),
    async handler() {
      const periods = await q(`SELECT p.id, p.name, ${D('p.starts_on')} starts_on, ${D('p.ends_on')} ends_on, t.amount::float8 target, t.alert_threshold_percent::float8 threshold, t.basis
        FROM sales_target_periods p JOIN sales_targets t ON t.period_id = p.id AND t.scope='company' AND t.metric='revenue'
        WHERE p.status='approved' AND p.starts_on <= $1::date AND p.ends_on >= $1::date ORDER BY p.starts_on DESC LIMIT 1`, [today()]);
      if (!periods[0]) return { period: null, reason: 'no_approved_company_revenue_target_for_today', asOf: iso(now()), source: 'sales_targets' };
      const p = periods[0];
      const actual = await q(`SELECT currency, COALESCE(SUM(total),0)::float8 booked, COALESCE(SUM(paid_total),0)::float8 collected FROM sales_orders
        WHERE booked_at >= $1::date AND booked_at < ($2::date + 1) AND status NOT IN ('draft','cancelled') GROUP BY currency`, [p.starts_on, p.ends_on]);
      return { period: p, actualByCurrency: actual, asOf: iso(now()), today: today(), source: 'sales_targets + sales_orders' };
    },
  });

  reg.register({
    name: 'sales.accounts', risk: 'read', description: 'Account revenue concentration, reorder overdue and silent active accounts.', args: S.obj({}),
    async handler() {
      const top = await q(`SELECT a.id, a.name, o.currency, COALESCE(SUM(o.total),0)::float8 revenue FROM sales_orders o JOIN sales_accounts a ON a.id=o.account_id
        WHERE o.booked_at >= $1 AND o.status NOT IN ('draft','cancelled') GROUP BY a.id, a.name, o.currency ORDER BY revenue DESC LIMIT 10`, [ago(365)]);
      const totals = await q(`SELECT currency, COALESCE(SUM(total),0)::float8 revenue FROM sales_orders WHERE booked_at >= $1 AND status NOT IN ('draft','cancelled') GROUP BY currency`, [ago(365)]);
      const reorder = await q(`SELECT id, name, ${D('expected_reorder_on')} expected_reorder_on FROM sales_accounts WHERE archived_at IS NULL AND status='active' AND expected_reorder_on < $1::date ORDER BY expected_reorder_on LIMIT 25`, [today()]);
      const silent = await q(`SELECT a.id, a.name, ${TS('max(o.booked_at)')} last_order FROM sales_accounts a LEFT JOIN sales_orders o ON o.account_id=a.id AND o.status NOT IN ('draft','cancelled')
        WHERE a.archived_at IS NULL AND a.status='active' GROUP BY a.id, a.name HAVING max(o.booked_at) IS NOT NULL AND max(o.booked_at) < $1 ORDER BY max(o.booked_at) LIMIT 25`, [ago(120)]);
      const counts = await q(`SELECT COUNT(*) FILTER (WHERE status='active')::int active, COUNT(*)::int total FROM sales_accounts WHERE archived_at IS NULL`);
      return { topAccounts: top, revenue365ByCurrency: totals, reorderOverdue: reorder, silentActive: silent, counts: counts[0], asOf: iso(now()), source: 'sales_accounts + sales_orders' };
    },
  });

  reg.register({
    name: 'sales.quotes', risk: 'read', description: 'Quotation outcomes, expired open quotes and heavy discounting.', args: S.obj({}),
    async handler() {
      const status = await q(`SELECT status, COUNT(*)::int n FROM sales_quotations GROUP BY status`);
      const expired = await q(`SELECT id, number, currency, total::float8 total, ${D('validity_date')} validity_date FROM sales_quotations WHERE status IN ('sent','viewed','approved') AND validity_date < $1::date ORDER BY validity_date LIMIT 25`, [today()]);
      const heavy = await q(`SELECT id, number, effective_discount_percent::float8 discount, requires_approval, status FROM sales_quotations WHERE effective_discount_percent > 20 AND status NOT IN ('rejected','expired') ORDER BY effective_discount_percent DESC LIMIT 25`);
      const pendingApproval = await q(`SELECT COUNT(*)::int n FROM sales_quotations WHERE status='pending_approval'`);
      return { statusCounts: status, expiredOpen: expired, heavyDiscount: heavy, pendingApproval: num(pendingApproval[0]?.n), asOf: iso(now()), source: 'sales_quotations' };
    },
  });

  reg.register({
    name: 'sales.data_quality', risk: 'read', description: 'Counts of structural data defects that would distort analytics.', args: S.obj({}),
    async handler() {
      const one = async (sql: string, p: unknown[] = []) => num((await q(sql, p))[0]?.n);
      const dupEmails = await one(`SELECT COUNT(*)::int n FROM (SELECT lower(email) FROM sales_leads WHERE archived_at IS NULL AND merged_into_id IS NULL AND email IS NOT NULL AND btrim(email) <> '' GROUP BY 1 HAVING COUNT(*) > 1) d`);
      const rows = {
        openOpportunities: await one(`SELECT COUNT(*)::int n FROM sales_opportunities WHERE status='open'`),
        oppsZeroAmount: await one(`SELECT COUNT(*)::int n FROM sales_opportunities WHERE status='open' AND amount = 0`),
        oppsNoCloseDate: await one(`SELECT COUNT(*)::int n FROM sales_opportunities WHERE status='open' AND expected_close_date IS NULL`),
        oppsNoOwner: await one(`SELECT COUNT(*)::int n FROM sales_opportunities WHERE status='open' AND owner_id IS NULL`),
        leads: await one(`SELECT COUNT(*)::int n FROM sales_leads WHERE archived_at IS NULL`),
        leadsNoContact: await one(`SELECT COUNT(*)::int n FROM sales_leads WHERE archived_at IS NULL AND (email IS NULL OR btrim(email)='') AND (phone IS NULL OR btrim(phone)='')`),
        leadsNoOwner: await one(`SELECT COUNT(*)::int n FROM sales_leads WHERE archived_at IS NULL AND status NOT IN ('converted','disqualified') AND owner_id IS NULL`),
        duplicateLeadEmails: dupEmails,
        accounts: await one(`SELECT COUNT(*)::int n FROM sales_accounts WHERE archived_at IS NULL`),
        accountsNoOwner: await one(`SELECT COUNT(*)::int n FROM sales_accounts WHERE archived_at IS NULL AND status='active' AND owner_id IS NULL`),
        orders: await one(`SELECT COUNT(*)::int n FROM sales_orders WHERE status NOT IN ('draft','cancelled')`),
        ordersNoBookedAt: await one(`SELECT COUNT(*)::int n FROM sales_orders WHERE status NOT IN ('draft','cancelled') AND booked_at IS NULL`),
      };
      return { ...rows, asOf: iso(now()), source: 'sales_* structural checks' };
    },
  });
}
