import { Link } from "wouter";
import { useSalesQuery } from "@/lib/sales/hooks";
import { useSales } from "@/context/SalesContext";
import { money, moneyCompact, num, percent } from "@/lib/sales/format";
import { KpiCard, Panel, Spinner } from "./ui";
import { LineChart } from "./charts";

interface Kpi { key: string; value: string | number | null; href?: string; available?: boolean; reliability?: string; changePercent?: number | null; [k: string]: unknown }
interface Def { key: string; label: string; definition: string; formula?: string; source?: string; basis?: string }
export interface DashboardData {
  range: { label: string };
  currency: string;
  kpis: Kpi[];
  trend: { d: string; a: string; n: number }[];
  definitions: Def[];
  target: null | { label: string; target: string; actual: string; attainmentPercent: number | null; periodFrom: string; periodTo: string };
}

/** Formats a KPI by its key. Money keys use the business currency; null always renders as "—" (never zero). */
export function formatKpi(k: Kpi, currency: string): string {
  if (k.value === null || k.value === undefined) return "—";
  const moneyKeys = ["sales_today", "revenue_mtd", "gross_profit", "open_pipeline", "weighted_pipeline", "avg_deal_size", "repeat_revenue", "receivables", "forecast"];
  const pctKeys = ["gross_margin", "lead_conversion", "win_rate", "quote_conversion"];
  if (moneyKeys.includes(k.key)) return moneyCompact(String(k.value), currency);
  if (pctKeys.includes(k.key)) return percent(Number(k.value));
  if (k.key === "sales_cycle") return `${num(Number(k.value), 0)} days`;
  return num(Number(k.value));
}

export const KPI_ORDER = ["revenue_mtd", "sales_today", "open_pipeline", "weighted_pipeline", "new_leads", "lead_conversion", "win_rate", "avg_deal_size", "gross_profit", "gross_margin", "new_customers", "overdue_followups", "overdue_quotes", "quote_conversion", "receivables", "forecast", "qualified_opps", "repeat_revenue", "sales_cycle"];

/** Dashboard widget: headline KPIs with drill-down links into the owning list, honest "not available" for unknowns. */
export function SalesOverviewWidget({ compact = false }: { compact?: boolean }) {
  const { can, access, error, reload } = useSales();
  const q = useSalesQuery<DashboardData>(can("dashboard:read") ? "/dashboard" : null);
  if (access !== "ready" || !can("dashboard:read")) {
    const msg =
      access === "loading" ? null
      : access === "unauthenticated" ? "The Sales API refused the request."
      : access === "not_member" ? "You are not part of the sales team yet. Ask a Sales Administrator to add you."
      : access === "error" ? (error?.message ?? "Sales data could not be loaded. The on-device database may be blocked by the browser; try reloading.")
      : "Your role does not include the sales dashboard.";
    return (
      <Panel title="Sales overview" actions={<Link href="/sales"><span className="cursor-pointer text-xs text-primary hover:underline">Open Sales →</span></Link>}>
        {msg === null ? <div className="flex justify-center py-8"><Spinner /></div> : (
          <div className="flex flex-wrap items-center gap-3 py-4 text-sm text-muted-foreground">
            <p role="status">{msg}</p>
            {access === "error" && <button type="button" onClick={reload} className="text-primary hover:underline">Retry</button>}
          </div>
        )}
      </Panel>
    );
  }
  const d = q.data;
  const defs = new Map((d?.definitions ?? []).map((x) => [x.key, x]));
  const by = new Map((d?.kpis ?? []).map((x) => [x.key, x]));
  const shown = (compact ? ["revenue_mtd", "open_pipeline", "new_leads", "win_rate", "overdue_followups", "forecast"] : KPI_ORDER).filter((k) => by.has(k));
  return (
    <Panel
      title="Sales overview"
      description={d ? `${d.range.label} · amounts in ${d.currency}` : undefined}
      actions={<Link href="/sales"><span className="cursor-pointer text-xs text-primary hover:underline">Open Sales →</span></Link>}
    >
      {q.error && !d ? (
        <p role="alert" className="py-4 text-sm text-muted-foreground">{q.error.isNotMember ? "You are not part of the sales team yet." : q.error.message}</p>
      ) : !d ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {shown.map((key) => {
              const k = by.get(key)!;
              const def = defs.get(key);
              const unavailable = k.available === false ? "Needs finance data" : undefined;
              return <KpiCard key={key} label={def?.label ?? key} value={formatKpi(k, d.currency)} href={k.href} unavailable={unavailable} hint={k.key === "forecast" && k.reliability ? `Reliability: ${k.reliability}` : k.changePercent != null ? `${k.changePercent > 0 ? "+" : ""}${percent(k.changePercent)} vs previous` : undefined} tone={key.startsWith("overdue") && Number(k.value) > 0 ? "danger" : undefined} />;
            })}
          </div>
          {!compact && d.trend.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs text-muted-foreground">Daily booked revenue</p>
              <LineChart data={d.trend.map((t) => ({ label: t.d.slice(5), value: Number(t.a) }))} fmt={(n) => money(String(n), d.currency)} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
