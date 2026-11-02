import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Panel, KpiCard, QueryBoundary, EmptyState } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { fmtMoney } from "@/lib/finance/api";
import { FI_NAV } from "@/lib/financial-intelligence/nav";

interface Kpi { value: string; formula: string }
interface Dash {
  currency: string;
  as_of: string;
  has_postings: boolean;
  fiscal_year: { name: string; from: string } | null;
  kpis: Record<string, Kpi | null>;
  monthly: { period: string; revenue: string; expenses: string; net: string }[];
}

export default function FiOverview() {
  const { can, currency } = useFinance();
  const q = useFinanceQuery<Dash>("/dashboard");
  const integ = useFinanceQuery<{ partyLinks: number; eventsByStatus: Record<string, number> }>("/integration/status");

  return (
    <>
      <PageHeader
        title="Financial Intelligence"
        description="Live indicators from posted CINTEXA Finance ledger entries and Sales synchronisation. Drafts and unposted journals are never counted as results."
        actions={
          can("finance:create") ? (
            <Link href="/finance/journals?new=1"><Button size="sm" variant="outline">Open Finance</Button></Link>
          ) : undefined
        }
      />
      <QueryBoundary q={q}>
        {(d) => {
          const k = d.kpis;
          const money = (x: Kpi | null | undefined) => (x ? fmtMoney(x.value, d.currency || currency) : "—");
          const tone = (x: Kpi | null | undefined) => (x && String(x.value).startsWith("-") ? ("danger" as const) : undefined);
          const chart = d.monthly.map((m) => ({
            period: m.period.split(" ")[0],
            Revenue: Number(m.revenue),
            Expenses: Number(m.expenses),
            Net: Number(m.net),
          }));
          return (
            <>
              {!d.has_postings && (
                <Panel className="mb-4">
                  <EmptyState
                    title="No posted financial activity yet"
                    description="Post opening balances and journals in CINTEXA Finance, or complete Sales orders that sync to Finance. Nothing on this page is sample data."
                    action={can("finance:create") ? <Link href="/finance"><Button size="sm">Go to Finance</Button></Link> : undefined}
                  />
                </Panel>
              )}
              <p className="mb-3 text-xs text-muted-foreground">
                {d.fiscal_year
                  ? `${d.fiscal_year.name}: ${d.fiscal_year.from} → ${d.as_of}`
                  : `As of ${d.as_of}`}
                {integ.data ? ` · ${integ.data.partyLinks} party link(s) · sync events: ${JSON.stringify(integ.data.eventsByStatus ?? {})}` : ""}
              </p>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Link href="/financial-intelligence/revenue"><KpiCard label="Revenue" value={money(k.revenue)} hint={k.revenue?.formula} /></Link>
                <Link href="/financial-intelligence/profit-loss"><KpiCard label="Gross profit" value={money(k.gross_profit)} hint={k.gross_profit?.formula} tone={tone(k.gross_profit)} /></Link>
                <Link href="/financial-intelligence/expenses"><KpiCard label="Total expenses" value={money(k.expenses)} hint={k.expenses?.formula} /></Link>
                <Link href="/financial-intelligence/profit-loss"><KpiCard label="Net profit" value={money(k.net_profit)} hint={k.net_profit?.formula} tone={tone(k.net_profit)} /></Link>
                <Link href="/financial-intelligence/cashflow"><KpiCard label="Cash & bank" value={money(k.cash_and_bank)} hint={k.cash_and_bank?.formula} tone={tone(k.cash_and_bank)} /></Link>
                <Link href="/financial-intelligence/working-capital"><KpiCard label="Receivables" value={money(k.receivables)} hint={k.receivables?.formula} /></Link>
                <Link href="/financial-intelligence/working-capital"><KpiCard label="Payables" value={money(k.payables)} hint={k.payables?.formula} /></Link>
                <Link href="/financial-intelligence/ratios"><KpiCard label="Net margin" value={k.net_margin_pct ? `${k.net_margin_pct.value}%` : "—"} hint={k.net_margin_pct?.formula ?? "Needs revenue"} /></Link>
              </div>
              <Panel title="Revenue vs expenses" description="Posted ledger activity by accounting period">
                <div className="h-72 p-3" role="img" aria-label="Revenue and expenses by period">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="period" fontSize={12} />
                      <YAxis fontSize={12} width={64} />
                      <Tooltip formatter={(v) => fmtMoney(Number(v), d.currency)} />
                      <Legend />
                      <Bar dataKey="Revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FI_NAV.filter((i) => i.key !== "overview").slice(0, 9).map((i) => (
                  <Link key={i.key} href={i.href}>
                    <Panel className="cursor-pointer transition hover:border-primary/40">
                      <div className="p-4">
                        <div className="text-sm font-semibold">{i.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{i.section}</div>
                      </div>
                    </Panel>
                  </Link>
                ))}
              </div>
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}
