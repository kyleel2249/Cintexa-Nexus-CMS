import type { AnalyzerCtx } from "../types";

export const ACTIVE_LEAD = "l.status IN ('new','contacted','qualified','nurturing') AND l.archived_at IS NULL AND l.merged_into_id IS NULL";
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The active sales rep with the lightest open workload (leads + opportunities). Null when no rep exists. */
export async function lightestRep(ctx: AnalyzerCtx): Promise<{ id: number; load: number } | null> {
  const r = await ctx.q.query<{ id: number; load: number }>(
    `SELECT m.id,
      ((SELECT count(*) FROM sales_leads l WHERE l.owner_id = m.id AND ${ACTIVE_LEAD})
     + (SELECT count(*) FROM sales_opportunities o WHERE o.owner_id = m.id AND o.status = 'open' AND o.archived_at IS NULL))::int AS load
     FROM sales_members m WHERE m.active AND m.role = 'sales_rep' ORDER BY load ASC, m.id ASC LIMIT 1`);
  return r.rows[0] ?? null;
}

export const money2 = (x: unknown): string => { const n = Number(x); return Number.isFinite(n) ? n.toFixed(2) : "0.00"; };
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
