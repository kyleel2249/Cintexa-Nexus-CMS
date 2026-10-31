import { v, parse } from "../core/validate";
import { created, type Route } from "../core/router";
import { badRequest, conflict } from "../core/errors";
import { audit } from "../core/audit";
import { businessDate } from "../core/time";
import { catalogue, isKnownCurrency } from "./currencies";
import { findRate, convertPrecise, fromScaled, toScaled } from "./rates";
import { resolveRange, ownerFilter } from "../modules/analytics";
import { ownerScopeSql } from "../core/rbac";

const str = (q: Record<string, string | string[] | undefined>, k: string) => { const x = q[k]; return Array.isArray(x) ? x[0] : x; };
const code = (label: string) => v.string({ min: 3, max: 3, pattern: /^[A-Za-z]{3}$/, patternMessage: `${label} must be a 3-letter currency code` });

interface Bucket { currency: string; date: string; amount: string; records: number }
type Metric = { key: string; label: string; kind: "actual" | "receivable" | "forecast" | "quoted"; buckets: Bucket[] };

export const fxRoutes: Route[] = [
  { method: "GET", path: "/currencies", permission: "dashboard:read", tx: false, async handler() { return { items: catalogue() }; } },
  {
    method: "GET", path: "/fx/rates", permission: "reports:read", tx: false,
    async handler({ q, query }) {
      const b = str(query, "base")?.toUpperCase(), c = str(query, "quote")?.toUpperCase();
      const rows = (await q.query("SELECT id, base, quote, rate::text rate, effective_on, source, entered_by, note, created_at FROM sales_exchange_rates WHERE ($1::text IS NULL OR base = $1) AND ($2::text IS NULL OR quote = $2) ORDER BY effective_on DESC, id DESC LIMIT 300", [b ?? null, c ?? null])).rows;
      return { items: rows };
    },
  },
  {
    method: "POST", path: "/fx/rates", permission: "fx:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ base: code("Base currency"), quote: code("Quote currency"), rate: v.string({ min: 1, max: 30, pattern: /^\d{1,14}(\.\d{1,10})?$/, patternMessage: "Rate must be a positive number with up to 10 decimals" }), effective_on: v.date(), note: v.optional(v.string({ max: 300 })) }), body);
      const base = b.base.toUpperCase(), quote = b.quote.toUpperCase();
      if (base === quote) throw badRequest("Base and quote currencies must differ");
      if (!isKnownCurrency(base) || !isKnownCurrency(quote)) throw badRequest("Unknown currency code");
      if (toScaled(b.rate, 10) <= 0n) throw badRequest("Rate must be greater than zero");
      const r = await q.query<{ id: number }>("INSERT INTO sales_exchange_rates (base, quote, rate, effective_on, source, entered_by, note) VALUES ($1,$2,$3,$4,'manual',$5,$6) ON CONFLICT (base, quote, effective_on, source) DO NOTHING RETURNING id", [base, quote, b.rate, b.effective_on, actor.label, b.note ?? null]);
      if (!r.rows[0]) throw conflict(`A manual rate for ${base}/${quote} on ${b.effective_on} already exists. Rates are never overwritten; enter a rate for a later date to change it going forward.`, "rate_exists");
      await audit(q, actor, { action: "fx.rate_added", entityType: "fx_rate", entityId: r.rows[0].id, summary: `1 ${base} = ${b.rate} ${quote} from ${b.effective_on}`, after: { base, quote, rate: b.rate, effective_on: b.effective_on } }, requestId);
      return created({ id: r.rows[0].id });
    },
  },
  {
    method: "GET", path: "/fx/convert", permission: "reports:read", tx: false,
    async handler({ q, query, now, settings }) {
      const amount = parse(v.string({ min: 1, max: 24, pattern: /^-?\d{1,15}(\.\d{1,2})?$/, patternMessage: "amount must be a number with up to 2 decimals" }), str(query, "amount") ?? "");
      const from = parse(code("from"), str(query, "from") ?? "").toUpperCase(), to = parse(code("to"), str(query, "to") ?? "").toUpperCase();
      const on = str(query, "on") ? parse(v.date(), str(query, "on")) : businessDate(now, settings.business.timezone);
      const hit = await findRate(q, from, to, on);
      if (!hit) return { ok: false, reason: `No ${from}/${to} rate on or before ${on}. Add one under exchange rates.`, from, to, on };
      return { ok: true, from, to, on, original: amount, converted: convertPrecise(amount, hit.rate), rate: hit.rate, source: hit.source, rateDate: hit.effectiveOn, via: hit.via, kind: hit.kind };
    },
  },
  {
    // Per-currency totals (never mixed) + an optional consolidated total in ONE reporting currency using the rate in force on each record's own date.
    method: "GET", path: "/fx/summary", permission: "reports:read", tx: false,
    async handler({ q, actor, query, now, settings }) {
      const range = resolveRange(query, now, settings);
      const tz = settings.business.timezone;
      const reporting = (str(query, "reporting") ?? settings.business.currency).toUpperCase();
      const oOwner = ownerFilter(actor, "o.owner_id", query), qOwner = ownerFilter(actor, "qt.owner_id", query), pOwner = ownerFilter(actor, "op.owner_id", query);
      void ownerScopeSql;
      const rows = async (sql: string, p: unknown[]) => (await q.query<{ currency: string; d: any; amount: string; n: number }>(sql, p)).rows.map((r): Bucket => ({ currency: r.currency, date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10), amount: r.amount, records: r.n }));
      const metrics: Metric[] = [
        { key: "quoted", label: "Quoted value (sent, viewed or accepted quotations)", kind: "quoted", buckets: await rows(`SELECT qt.currency, (qt.sent_at AT TIME ZONE $3)::date d, COALESCE(sum(qt.total),0)::numeric(18,2)::text amount, count(*)::int n FROM sales_quotations qt WHERE ${qOwner} AND qt.status IN ('sent','viewed','accepted') AND qt.sent_at >= $1 AND qt.sent_at < $2 GROUP BY 1,2 ORDER BY 1,2`, [range.from, range.to, tz]) },
        { key: "booked", label: "Booked sales (confirmed orders, excl. tax, net of returns)", kind: "actual", buckets: await rows(`SELECT o.currency, (o.booked_at AT TIME ZONE $3)::date d, COALESCE(sum(o.net_total - o.returned_total),0)::numeric(18,2)::text amount, count(*)::int n FROM sales_orders o WHERE ${oOwner} AND o.status <> 'cancelled' AND o.booked_at >= $1 AND o.booked_at < $2 GROUP BY 1,2 ORDER BY 1,2`, [range.from, range.to, tz]) },
        { key: "cash", label: "Cash received (recorded payments)", kind: "actual", buckets: await rows(`SELECT o.currency, p.received_on d, COALESCE(sum(p.amount),0)::numeric(18,2)::text amount, count(*)::int n FROM sales_order_payments p JOIN sales_orders o ON o.id = p.order_id WHERE ${oOwner} AND p.status = 'recorded' AND p.received_on >= ($1::timestamptz AT TIME ZONE $3)::date AND p.received_on < ($2::timestamptz AT TIME ZONE $3)::date GROUP BY 1,2 ORDER BY 1,2`, [range.from, range.to, tz]) },
        { key: "receivables", label: "Outstanding receivables today (all unpaid order balances)", kind: "receivable", buckets: await rows(`SELECT o.currency, ($1::timestamptz AT TIME ZONE $2)::date d, COALESCE(sum(o.total - o.paid_total),0)::numeric(18,2)::text amount, count(*)::int n FROM sales_orders o WHERE ${oOwner} AND o.status <> 'cancelled' AND o.booked_at IS NOT NULL AND o.total - o.paid_total > 0 GROUP BY 1 ORDER BY 1`, [now.toISOString(), tz]) },
        { key: "pipeline", label: "Open pipeline expected to close in the period (forecast, NOT revenue)", kind: "forecast", buckets: await rows(`SELECT op.currency, op.expected_close_date d, COALESCE(sum(op.amount),0)::numeric(18,2)::text amount, count(*)::int n FROM sales_opportunities op WHERE ${pOwner} AND op.archived_at IS NULL AND op.status = 'open' AND op.expected_close_date >= ($1::timestamptz AT TIME ZONE $3)::date AND op.expected_close_date < ($2::timestamptz AT TIME ZONE $3)::date GROUP BY 1,2 ORDER BY 1,2`, [range.from, range.to, tz]) },
      ];
      const out = [];
      for (const m of metrics) {
        const byCur = new Map<string, { amount: bigint; records: number }>();
        for (const b of m.buckets) { const c = byCur.get(b.currency) ?? { amount: 0n, records: 0 }; c.amount += toScaled(b.amount, 2); c.records += b.records; byCur.set(b.currency, c); }
        let total = 0n; const missing: { currency: string; date: string; amount: string }[] = []; const used: { from: string; date: string; rate: string; source: string; rateDate: string; via: string | null; original: string; converted: string }[] = [];
        for (const b of m.buckets) {
          const hit = await findRate(q, b.currency, reporting, m.kind === "receivable" ? b.date : b.date);
          if (!hit) { missing.push({ currency: b.currency, date: b.date, amount: b.amount }); continue; }
          const conv = convertPrecise(b.amount, hit.rate); total += toScaled(conv, 2);
          if (hit.kind !== "same" && used.length < 60) used.push({ from: b.currency, date: b.date, rate: hit.rate, source: hit.source, rateDate: hit.effectiveOn, via: hit.via, original: b.amount, converted: conv });
        }
        out.push({ key: m.key, label: m.label, kind: m.kind, byCurrency: [...byCur].map(([currency, x]) => ({ currency, amount: fromScaled(x.amount, 2), records: x.records })), consolidated: { currency: reporting, amount: fromScaled(total, 2), complete: missing.length === 0, missingRates: missing, conversions: used } });
      }
      return { period: { from: range.from, to: range.to, label: range.label }, reportingCurrency: reporting, note: "Each currency is totalled on its own. The consolidated figure converts every record at the rate in force on its own date and excludes (and lists) any record with no rate; it is marked incomplete in that case.", metrics: out };
    },
  },
];
