import type { Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";
import { assessHealth, type Health, type HealthInput } from "../domain/health";

interface Agg {
  last_purchase: string | null;
  orders365: number;
  rev90: string;
  rev_prev90: string;
  complaints: number;
  acts60: number;
  reorder_interval_days: number | null;
  expected_reorder_on: string | null;
  status: HealthInput["status"];
}

/** Gather the observable signals for one account (booked orders, complaints, touchpoints) and rate it. */
export async function accountHealth(q: Queryable, accountId: number, cfg: SalesSettings["retention"], now: Date): Promise<Health> {
  const r = await q.query<Agg>(
    `SELECT a.status, a.reorder_interval_days, a.expected_reorder_on,
       (SELECT max(o.booked_at) FROM sales_orders o WHERE o.account_id = a.id AND o.booked_at IS NOT NULL AND o.status <> 'cancelled') AS last_purchase,
       (SELECT count(*)::int FROM sales_orders o WHERE o.account_id = a.id AND o.booked_at >= $2::timestamptz - interval '365 days' AND o.status <> 'cancelled') AS orders365,
       (SELECT COALESCE(sum(o.net_total),0)::text FROM sales_orders o WHERE o.account_id = a.id AND o.booked_at >= $2::timestamptz - interval '90 days' AND o.status <> 'cancelled') AS rev90,
       (SELECT COALESCE(sum(o.net_total),0)::text FROM sales_orders o WHERE o.account_id = a.id AND o.booked_at >= $2::timestamptz - interval '180 days' AND o.booked_at < $2::timestamptz - interval '90 days' AND o.status <> 'cancelled') AS rev_prev90,
       (SELECT count(*)::int FROM sales_feedback f WHERE f.account_id = a.id AND f.kind = 'complaint' AND f.status IN ('open','in_progress')) AS complaints,
       (SELECT count(*)::int FROM sales_activities x WHERE x.account_id = a.id AND x.status IN ('done','open') AND COALESCE(x.completed_at, x.start_at, x.due_at, x.created_at) >= $2::timestamptz - interval '60 days') AS acts60
     FROM sales_accounts a WHERE a.id = $1`,
    [accountId, now.toISOString()],
  );
  const a = r.rows[0];
  if (!a) throw new Error("Account not found");
  const dsl = a.last_purchase ? Math.floor((now.getTime() - Date.parse(a.last_purchase)) / 86_400_000) : null;
  const pastReorder = a.expected_reorder_on ? Math.floor((now.getTime() - Date.parse(`${String(a.expected_reorder_on).slice(0, 10)}T00:00:00Z`)) / 86_400_000) : null;
  return assessHealth(
    {
      daysSinceLastPurchase: dsl, ordersLast365: a.orders365, revenueLast90: Number(a.rev90), revenuePrev90: Number(a.rev_prev90), openComplaints: a.complaints,
      activitiesLast60: a.acts60, reorderIntervalDays: a.reorder_interval_days, daysPastExpectedReorder: pastReorder, status: a.status,
    },
    cfg,
  );
}
