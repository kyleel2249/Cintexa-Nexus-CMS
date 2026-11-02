/**
 * Shared analysis page shell for Financial Intelligence sections.
 * Connects to live Finance APIs where available; never invents company results.
 */
import { Link } from "wouter";
import { PageHeader, Panel, KpiCard, QueryBoundary, EmptyState, DataTable } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { fmtMoney } from "@/lib/finance/api";

interface Kpi { value: string; formula: string }
interface Dash {
  currency: string;
  as_of: string;
  has_postings: boolean;
  kpis: Record<string, Kpi | null>;
  monthly: { period: string; revenue: string; expenses: string; net: string }[];
}

export type AnalysisKind =
  | "ratios"
  | "pnl"
  | "cashflow"
  | "balance-sheet"
  | "revenue"
  | "cac"
  | "expenses"
  | "budget"
  | "working-capital"
  | "health"
  | "investors"
  | "shareholders"
  | "dividends"
  | "valuation"
  | "reports"
  | "settings";

const META: Record<AnalysisKind, { title: string; description: string }> = {
  ratios: {
    title: "Financial Ratios",
    description: "Profitability, liquidity and efficiency ratios derived only from posted ledger balances. Full ratio engine arrives in Phase 4.",
  },
  pnl: {
    title: "Profit & Loss Analysis",
    description: "Revenue, costs and profit from posted journals. Formal statement export arrives in Phase 5.",
  },
  cashflow: {
    title: "Cashflow Analysis",
    description: "Cash and bank position from posted ledger entries. Operating/investing/financing classification expands in Phase 5.",
  },
  "balance-sheet": {
    title: "Balance Sheet Analysis",
    description: "Assets, liabilities and equity from the chart of accounts and posted ledger. Formal statement in Phase 5.",
  },
  revenue: {
    title: "Revenue & Sales Analytics",
    description: "Recognised revenue from Finance, linked to Sales orders where synchronisation has run.",
  },
  cac: {
    title: "Customer Acquisition & Retention",
    description: "CAC, LTV and retention require marketing cost attribution and cohort data (Phase 4). Current view shows available party and invoice signals only.",
  },
  expenses: {
    title: "Cost & Expense Analysis",
    description: "Expense totals from posted ledger entries and Finance expenses module.",
  },
  budget: {
    title: "Budget & Forecasting",
    description: "Use Budget & Forecasting for budget vs actual and scenarios. Actuals always come from the posted ledger.",
  },
  "working-capital": {
    title: "Working Capital",
    description: "Current assets less current liabilities from posted balances (receivables, payables, cash).",
  },
  health: {
    title: "Financial Health & Risk",
    description: "Use Financial Health & Risk for KPI signals and rule-based alerts. Thresholds are configurable.",
  },
  investors: {
    title: "Investor Management",
    description: "Investor profiles and contributions. Structured investor records ship in Phase 6. Ownership is never auto-assigned from contribution ratios.",
  },
  shareholders: {
    title: "Shareholder Management",
    description: "Share register and cap table. Legal ownership remains unassigned until formally recorded (Phase 6).",
  },
  dividends: {
    title: "Dividends & Investor Returns",
    description: "Use Dividends & Investor Returns for declarations, approval, and payment tracking. No dividends are assumed payable.",
  },
  valuation: {
    title: "Business Valuation",
    description: "Use Business Valuation for book NAV and saved scenarios. Net asset signals use posted equity balances only.",
  },
  reports: {
    title: "Financial Reports",
    description: "Downloadable statements and management packs expand in Phase 5. Use CINTEXA Finance for trial balance and ledger exports today.",
  },
  settings: {
    title: "Financial Settings",
    description: "Intelligence preferences. Organisation accounting settings remain under CINTEXA Finance → Company Settings.",
  },
};

export default function AnalysisPage({ kind }: { kind: AnalysisKind }) {
  const meta = META[kind];
  const { can, currency } = useFinance();
  const q = useFinanceQuery<Dash>("/dashboard");
  const ageing = useFinanceQuery<{ items?: any[] }>(
    kind === "working-capital" || kind === "health" ? "/receivables/ageing" : null,
  );

  return (
    <>
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={
          <div className="flex gap-2">
            <Link href="/financial-intelligence"><Button size="sm" variant="outline">Overview</Button></Link>
            <Link href="/finance"><Button size="sm" variant="outline">Finance module</Button></Link>
          </div>
        }
      />
      <QueryBoundary q={q}>
        {(d) => {
          const k = d.kpis;
          const money = (x: Kpi | null | undefined) => (x ? fmtMoney(x.value, d.currency || currency) : "—");
          if (!d.has_postings) {
            return (
              <Panel>
                <EmptyState
                  title="Insufficient posted data"
                  description="This analysis only uses posted ledger entries. Post journals or complete Sales→Finance synchronisation first."
                  action={can("finance:create") ? <Link href="/finance/journals?new=1"><Button size="sm">Create journal</Button></Link> : undefined}
                />
              </Panel>
            );
          }

          if (kind === "investors" || kind === "shareholders" || kind === "dividends" || kind === "valuation") {
            return (
              <div className="space-y-4">
                <Panel>
                  <EmptyState
                    title="Capital module not yet configured"
                    description={
                      kind === "investors"
                        ? "Use Investor Management to register investors and contributions. Ownership is assigned only via the share register."
                        : kind === "shareholders"
                          ? "Use Shareholder Management to maintain the share register and capitalisation table."
                          : kind === "dividends"
                            ? "Dividend planning and approval workflows ship in Phase 7. No payout is calculated or authorised from this page."
                            : "Valuation models ship in Phase 7. Equity book value below uses posted ledger equity accounts only when present."
                    }
                  />
                </Panel>
                {kind === "valuation" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <KpiCard label="Cash & bank (posted)" value={money(k.cash_and_bank)} hint={k.cash_and_bank?.formula} />
                    <KpiCard label="Net profit (posted)" value={money(k.net_profit)} hint={k.net_profit?.formula} />
                  </div>
                )}
              </div>
            );
          }

          if (kind === "cac") {
            return (
              <Panel>
                <EmptyState
                  title="Customer acquisition metrics require Phase 4"
                  description="CAC, LTV, LTV:CAC and payback need attributable marketing costs and new-customer cohorts. Sales campaign spend and Finance expense categories will feed this view once the ratio engine is live. No placeholder CAC is shown."
                  action={<Link href="/sales"><Button size="sm" variant="outline">Open Sales Management</Button></Link>}
                />
              </Panel>
            );
          }

          if (kind === "budget" || kind === "settings") {
            return (
              <Panel>
                <EmptyState
                  title={kind === "budget" ? "Budget & Forecasting" : "Intelligence settings"}
                  description={
                    kind === "budget"
                      ? "Open Budget & Forecasting to manage budgets, scenarios, and variance analysis."
                      : "Reporting currency, alert thresholds and AI analyst preferences will be configurable here. Accounting policies remain under CINTEXA Finance → Company Settings."
                  }
                  action={
                    kind === "settings" ? (
                      <Link href="/finance/settings"><Button size="sm">Finance settings</Button></Link>
                    ) : undefined
                  }
                />
              </Panel>
            );
          }

          if (kind === "reports") {
            return (
              <div className="grid gap-3 sm:grid-cols-2">
                <Panel title="Available now">
                  <ul className="space-y-2 p-4 text-sm">
                    <li><Link href="/finance/trial-balance" className="underline">Trial balance</Link></li>
                    <li><Link href="/finance/ledger" className="underline">General ledger</Link></li>
                    <li><Link href="/finance/receivables" className="underline">Receivables ageing</Link></li>
                    <li><Link href="/finance/payables" className="underline">Payables ageing</Link></li>
                    <li><Link href="/finance/audit" className="underline">Audit trail</Link></li>
                  </ul>
                </Panel>
                <Panel title="Coming in Phase 5">
                  <p className="p-4 text-sm text-muted-foreground">
                    Formal Profit &amp; Loss, Balance Sheet and Cashflow statement PDFs/Excel with CINTEXA branding, period filters and formula notes.
                  </p>
                </Panel>
              </div>
            );
          }

          // ratios / pnl / cashflow / balance-sheet / revenue / expenses / working-capital / health
          const cards: { label: string; key: string }[] =
            kind === "ratios" || kind === "health"
              ? [
                  { label: "Gross margin", key: "gross_margin_pct" },
                  { label: "Net margin", key: "net_margin_pct" },
                  { label: "Revenue", key: "revenue" },
                  { label: "Net profit", key: "net_profit" },
                  { label: "Cash & bank", key: "cash_and_bank" },
                  { label: "Receivables", key: "receivables" },
                  { label: "Payables", key: "payables" },
                ]
              : kind === "working-capital"
                ? [
                    { label: "Cash & bank", key: "cash_and_bank" },
                    { label: "Receivables", key: "receivables" },
                    { label: "Payables", key: "payables" },
                  ]
                : kind === "cashflow"
                  ? [
                      { label: "Cash & bank", key: "cash_and_bank" },
                      { label: "Net profit", key: "net_profit" },
                    ]
                  : kind === "expenses"
                    ? [
                        { label: "Total expenses", key: "expenses" },
                        { label: "Revenue", key: "revenue" },
                        { label: "Net profit", key: "net_profit" },
                      ]
                    : [
                        { label: "Revenue", key: "revenue" },
                        { label: "Gross profit", key: "gross_profit" },
                        { label: "Expenses", key: "expenses" },
                        { label: "Net profit", key: "net_profit" },
                      ];

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {cards.map((c) => {
                  const kpi = k[c.key];
                  const isPct = c.key.includes("margin");
                  return (
                    <KpiCard
                      key={c.key}
                      label={c.label}
                      value={kpi ? (isPct ? `${kpi.value}%` : money(kpi)) : "—"}
                      hint={kpi?.formula ?? "Not available from posted data"}
                      tone={kpi && String(kpi.value).startsWith("-") ? "danger" : undefined}
                    />
                  );
                })}
              </div>
              {d.monthly.length > 0 && (kind === "pnl" || kind === "revenue" || kind === "expenses") && (
                <Panel title="Period movement" description="Posted amounts only">
                  <DataTable
                    columns={
                      [
                        { key: "period", header: "Period" },
                        { key: "revenue", header: "Revenue", align: "right" as const },
                        { key: "expenses", header: "Expenses", align: "right" as const },
                        { key: "net", header: "Net", align: "right" as const },
                      ] as any
                    }
                    rows={d.monthly.map((m) => ({
                      period: m.period,
                      revenue: fmtMoney(m.revenue, d.currency),
                      expenses: fmtMoney(m.expenses, d.currency),
                      net: fmtMoney(m.net, d.currency),
                    }))}
                  />
                </Panel>
              )}
              {(kind === "working-capital" || kind === "health") && ageing.data?.items && (
                <Panel title="Receivables signal" description="From Finance ageing report when available">
                  <p className="p-4 text-sm text-muted-foreground">
                    {ageing.data.items.length} ageing bucket row(s) loaded. Open{" "}
                    <Link href="/finance/receivables" className="underline">Receivables ageing</Link> for detail.
                  </p>
                </Panel>
              )}
              <p className="text-xs text-muted-foreground">
                As of {d.as_of}. Advanced ratios (ROA, ROE, DSO, CAC, etc.) are implemented in Phase 4 using these same data sources.
              </p>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
