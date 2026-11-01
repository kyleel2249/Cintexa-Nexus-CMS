import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Panel, KpiCard, QueryBoundary, EmptyState } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { fmtMoney } from "@/lib/finance/api";

interface Kpi { value: string; formula: string }
interface Dash { currency: string; as_of: string; has_postings: boolean; fiscal_year: { name: string; from: string } | null; kpis: Record<string, Kpi | null>; monthly: { period: string; revenue: string; expenses: string; net: string }[] }
interface Overview { current_period: { name: string; status: string } | null; journals: Record<string, number>; trial_balance: { balanced: boolean } }

export default function FinanceDashboard() {
  const { can, currency } = useFinance();
  const q = useFinanceQuery<Dash>("/dashboard");
  const ov = useFinanceQuery<Overview>("/overview");
  const pending = ov.data?.journals?.draft ?? 0;
  return (
    <>
      <PageHeader title="Finance dashboard" description="Every figure is calculated from posted ledger entries by the server. Hover a card to see its formula; drafts and unapproved journals are never counted."
        actions={can("finance:create") ? <Link href="/finance/journals?new=1"><Button size="sm">New journal</Button></Link> : undefined} />
      <QueryBoundary q={q}>{(d) => {
        const k = d.kpis;
        const money = (x: Kpi | null) => (x ? fmtMoney(x.value, d.currency || currency) : "—");
        const tone = (x: Kpi | null) => (x && x.value.startsWith("-") ? "danger" as const : undefined);
        const data = d.monthly.map((m) => ({ period: m.period.split(" ")[0], Revenue: Number(m.revenue), Expenses: Number(m.expenses) }));
        return (
          <>
            {!d.has_postings && <Panel className="mb-4"><EmptyState title="No posted transactions yet" description="Post your opening balances and first journals to populate the dashboard. Nothing on this page is sample data." action={can("finance:create") ? <Link href="/finance/journals?new=1"><Button size="sm">Create a journal</Button></Link> : undefined} /></Panel>}
            <p className="mb-2 text-xs text-muted-foreground">{d.fiscal_year ? `${d.fiscal_year.name}: ${d.fiscal_year.from} to ${d.as_of}` : `As of ${d.as_of} (no fiscal year covers today - create one under Accounting Periods)`}</p>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Revenue" value={money(k.revenue!)} hint={k.revenue?.formula} />
              <KpiCard label="Gross profit" value={money(k.gross_profit!)} hint={k.gross_profit?.formula} tone={tone(k.gross_profit!)} />
              <KpiCard label="Total expenses" value={money(k.expenses!)} hint={k.expenses?.formula} />
              <KpiCard label="Net profit" value={money(k.net_profit!)} hint={k.net_profit?.formula} tone={tone(k.net_profit!)} />
              <KpiCard label="Cash & bank" value={money(k.cash_and_bank!)} hint={k.cash_and_bank?.formula} tone={tone(k.cash_and_bank!)} />
              <KpiCard label="Receivables" value={money(k.receivables!)} hint={k.receivables?.formula} />
              <KpiCard label="Payables" value={money(k.payables!)} hint={k.payables?.formula} />
              <KpiCard label="Tax liabilities" value={money(k.tax_liabilities!)} hint={k.tax_liabilities?.formula} />
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <KpiCard label="Gross margin" value={k.gross_margin_pct ? `${k.gross_margin_pct.value}%` : "—"} hint={k.gross_margin_pct?.formula ?? "Needs revenue"} />
              <KpiCard label="Net margin" value={k.net_margin_pct ? `${k.net_margin_pct.value}%` : "—"} hint={k.net_margin_pct?.formula ?? "Needs revenue"} />
            </div>
            <Panel title="Revenue and expenses by period" description="Posted entries per accounting period of the current fiscal year">
              <div className="h-72 p-3" role="img" aria-label="Bar chart of revenue and expenses by month">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="period" fontSize={12} /><YAxis fontSize={12} width={64} /><Tooltip formatter={(v) => fmtMoney(Number(v), d.currency)} /><Legend /><Bar dataKey="Revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} /><Bar dataKey="Expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </>
        );
      }}</QueryBoundary>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Panel title="Books"><p className="p-4 text-sm">{ov.data ? (ov.data.trial_balance.balanced ? <span className="text-emerald-500">Trial balance is balanced</span> : <span className="text-rose-500">Trial balance is OUT of balance - investigate</span>) : "Checking…"}</p></Panel>
        <Panel title="Current period"><p className="p-4 text-sm">{ov.data?.current_period ? `${ov.data.current_period.name} · ${ov.data.current_period.status.replace("_", " ")}` : "No period covers today"}</p></Panel>
        <Panel title="Awaiting approval"><p className="p-4 text-sm">{can("finance:approve") ? <Link href="/finance/approvals" className="underline">{pending} draft journal(s)</Link> : `${pending} draft journal(s)`}</p></Panel>
      </div>
    </>
  );
}
