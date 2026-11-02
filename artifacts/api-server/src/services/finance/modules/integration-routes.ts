/** Read-only integration status and reconciliation endpoints. */
import { route, ok, type Route } from "../core/route";
import { asObject, qstr } from "../core/validate";
import { runPeriodReconciliation } from "../integration/reconciliation";

const status = route("GET", "/integration/status", { perm: "ledger:read" }, async (c) => {
  const events = (await c.q.query<any>(
    `SELECT status, count(*)::int AS n FROM finance_integration_events
      WHERE org_id = $1 OR org_id IS NULL
      GROUP BY status`,
    [c.org.orgId],
  )).rows;
  const links = Number(
    (await c.q.query<any>(
      `SELECT count(*)::int AS n FROM finance_party_links WHERE org_id = $1`,
      [c.org.orgId],
    )).rows[0]?.n ?? 0,
  );
  const recent = (await c.q.query<any>(
    `SELECT id, event_type, source_module, source_entity_type, source_entity_id, status, result_ref, last_error, created_at, processed_at
       FROM finance_integration_events
      WHERE org_id = $1 OR org_id IS NULL
      ORDER BY id DESC LIMIT 50`,
    [c.org.orgId],
  )).rows;
  return ok({
    partyLinks: links,
    eventsByStatus: Object.fromEntries(events.map((e: any) => [e.status, e.n])),
    recentEvents: recent,
  });
});

const reconcile = route("POST", "/integration/reconcile", { perm: "finance:admin" }, async (c) => {
  const b = asObject(c.body);
  const from = (typeof b.period_start === "string" ? b.period_start : undefined) || qstr(c.query.period_start);
  const to = (typeof b.period_end === "string" ? b.period_end : undefined) || qstr(c.query.period_end);
  const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
  if (!isDate(from) || !isDate(to)) {
    return ok({ error: "period_start and period_end (YYYY-MM-DD) are required", code: "validation_failed" }, 422);
  }
  if (from! > to!) return ok({ error: "period_start must not be after period_end", code: "validation_failed" }, 422);
  const result = await runPeriodReconciliation(c.q, c.org.orgId, from!, to!, c.actor.sub);
  return ok({ reconciliation: result });
});

const listLinks = route("GET", "/integration/party-links", { perm: "ledger:read" }, async (c) => {
  const rows = (await c.q.query<any>(
    `SELECT l.id, l.sales_account_id, l.finance_customer_id, l.link_type, l.match_method, l.is_primary,
            c.code AS finance_code, c.name AS finance_name,
            a.number AS sales_number, a.name AS sales_name
       FROM finance_party_links l
       JOIN finance_customers c ON c.id = l.finance_customer_id AND c.org_id = l.org_id
       LEFT JOIN sales_accounts a ON a.id = l.sales_account_id
      WHERE l.org_id = $1
      ORDER BY l.id DESC LIMIT 200`,
    [c.org.orgId],
  )).rows;
  return ok({ items: rows });
});

export const integrationRoutes: Route[] = [status, reconcile, listLinks];
