/**
 * Shared analysis page for Financial Intelligence sections.
 * Uses live Finance APIs only; never invents company results.
 */
import { Link } from "wouter";
import { PageHeader, Panel, KpiCard, QueryBoundary, EmptyState, DataTable } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { fin, fmtMoney } from "@/lib/finance/api";

interface Kpi { value: string; formula: string }
interface Dash {
  currency: string;
  as_of: string;
  has_postings: boolean;
  kpis: Record<string, Kpi | null>;
  monthly: { period: string; revenue: string; expenses: string; net: string }[];
}

type RV =
  | { value: string; unit: string; formula: string }
  | { value: null; reason: string; formula: string };

interface RatiosPayload {
  currency: string;
  as_of: string;
  has_postings: boolean;
  profitability: Record<string, RV>;
  liquidity: Record<string, RV>;
  solvency: Record<string, RV>;
  efficiency: Record<string, RV>;
  acquisition: Record<string, RV | string | { value?: string; unit?: string; formula?: string; reason?: string }>;
  components: Record<string, string>;
}

interface StmtLine { key: string; label: string; kind: string; amount: string | null; code?: string; indent?: number }
interface StatementPayload {
  statement: string;
  title: string;
  currency: string;
  as_of?: string;
  period?: { from: string; to: string };
  has_postings: boolean;
  balanced?: boolean;
  lines: StmtLine[];
  totals: Record<string, string>;
  basis?: string;
}

export type AnalysisKind =
  | "ratios" | "pnl" | "cashflow" | "balance-sheet" | "revenue" | "cac" | "expenses"
  | "budget" | "working-capital" | "health" | "investors" | "shareholders"
  | "dividends" | "valuation" | "reports" | "settings";

const META: Record<AnalysisKind, { title: string; description: string }> = {
  ratios: { title: "Financial Ratios", description: "Profitability, liquidity, solvency and efficiency from posted ledger balances only." },
  pnl: { title: "Profit & Loss Analysis", description: "Formal statement of profit or loss from posted journals (closing entries excluded)." },
  cashflow: { title: "Cashflow Analysis", description: "Indirect statement of cash flows from posted ledger balances." },
  "balance-sheet": { title: "Balance Sheet Analysis", description: "Statement of financial position from posted ledger balances." },
  revenue: { title: "Revenue & Sales Analytics", description: "Recognised revenue from Finance, linked to Sales where synchronisation has run." },
  cac: { title: "Customer Acquisition & Retention", description: "CAC and related signals from marketing-named expenses and customer records. Null when inputs are missing." },
  expenses: { title: "Cost & Expense Analysis", description: "Expense totals from posted ledger entries." },
  budget: { title: "Budget & Forecasting", description: "Use Budget & Forecasting for budget vs actual and scenarios." },
  "working-capital": { title: "Working Capital", description: "Current assets less current liabilities from posted balances." },
  health: { title: "Financial Health & Risk", description: "Use Financial Health & Risk for KPI signals and rule-based alerts." },
  investors: { title: "Investor Management", description: "Use Investor Management to register investors and contributions." },
  shareholders: { title: "Shareholder Management", description: "Use Shareholder Management for the share register and capitalisation table." },
  dividends: { title: "Dividends & Investor Returns", description: "Use Dividends for declarations, approval, and payment tracking." },
  valuation: { title: "Business Valuation", description: "Use Business Valuation for book NAV and saved scenarios." },
  reports: { title: "Financial Reports", description: "Statements and exports via the analysis pages and CINTEXA Finance trial balance / ledger." },
  settings: { title: "Financial Settings", description: "Use Financial Settings for intelligence preferences and integration links." },
};

function fmtRatio(r: RV | undefined | null): string {
  if (!r || r.value === null || r.value === undefined) return "—";
  if (r.unit === "percent") return `${r.value}%`;
  if (r.unit === "money") return r.value;
  if (r.unit === "days") return `${r.value}d`;
  return String(r.value);
}

function ratioHint(r: RV | undefined | null): string {
  if (!r) return "Not available";
  if (r.value === null) return ("reason" in r && r.reason) ? `${r.formula} (${r.reason})` : r.formula;
  return r.formula;
}

export default function AnalysisPage({ kind }: { kind: AnalysisKind }) {
  const meta = META[kind];
  const { can, currency } = useFinance();
  const dash = useFinanceQuery<Dash>("/dashboard");
  const ratios = useFinanceQuery<RatiosPayload>(
    kind === "ratios" || kind === "cac" || kind === "working-capital" ? "/ratios" : null,
  );
  const stmtPath =
    kind === "pnl" ? "/statements/profit-loss"
    : kind === "balance-sheet" ? "/statements/balance-sheet"
    : kind === "cashflow" ? "/statements/cash-flow"
    : null;
  const statement = useFinanceQuery<StatementPayload>(stmtPath);
  const ageing = useFinanceQuery<{ items?: any[] }>(
    kind === "working-capital" ? "/receivables/ageing" : null,
  );

  const redirectKinds: AnalysisKind[] = ["budget", "health", "investors", "shareholders", "dividends", "valuation"];
  const redirectHref: Partial<Record<AnalysisKind, string>> = {
    budget: "/financial-intelligence/budget",
    health: "/financial-intelligence/health",
    investors: "/financial-intelligence/investors",
    shareholders: "/financial-intelligence/shareholders",
    dividends: "/financial-intelligence/dividends",
    valuation: "/financial-intelligence/valuation",
  };

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

      {redirectKinds.includes(kind) && (
        <Panel>
          <EmptyState
            title={meta.title}
            description={`This section has a dedicated workspace.`}
            action={<Link href={redirectHref[kind]!}><Button size="sm">Open {meta.title}</Button></Link>}
          />
        </Panel>
      )}

      {kind === "settings" && (
        <Panel>
          <EmptyState
            title="Intelligence settings"
            description="Reporting preferences stay with your organisation policies. Accounting policies are under CINTEXA Finance → Company Settings."
            action={<Link href="/finance/settings"><Button size="sm" variant="outline">Open Finance settings</Button></Link>}
          />
        </Panel>
      )}

      {kind === "reports" && (
        <div className="space-y-4">
          <Panel title="Open interactive reports">
            <div className="p-4 grid gap-2 sm:grid-cols-2">
              {[
                { href: "/financial-intelligence/profit-loss", label: "Profit & Loss" },
                { href: "/financial-intelligence/balance-sheet", label: "Balance Sheet" },
                { href: "/financial-intelligence/cashflow", label: "Cash Flow" },
                { href: "/financial-intelligence/ratios", label: "Ratios" },
                { href: "/finance/trial-balance", label: "Trial Balance (Finance)" },
                { href: "/finance/ledger", label: "General Ledger (Finance)" },
              ].map((x) => (
                <Link key={x.href} href={x.href}><Button variant="outline" className="w-full justify-start">{x.label}</Button></Link>
              ))}
            </div>
          </Panel>
          <Panel title="CSV exports" description="Downloads use posted ledger data only">
            <div className="p-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void fin.download("/statements/profit-loss", {}, "profit-loss.csv")}>P&amp;L CSV</Button>
              <Button size="sm" variant="outline" onClick={() => void fin.download("/statements/balance-sheet", {}, "balance-sheet.csv")}>Balance sheet CSV</Button>
              <Button size="sm" variant="outline" onClick={() => void fin.download("/statements/cash-flow", {}, "cash-flow.csv")}>Cash flow CSV</Button>
              <Button size="sm" variant="outline" onClick={() => void fin.download("/trial-balance", {}, "trial-balance.csv")}>Trial balance CSV</Button>
            </div>
          </Panel>
        </div>
      )}

      {(kind === "ratios" || kind === "cac") && (
        <QueryBoundary q={ratios}>
          {(d) => {
            if (!d.has_postings) {
              return (
                <Panel>
                  <EmptyState
                    title="Insufficient posted data"
                    description="Ratios only use posted ledger entries. Post journals or complete Sales→Finance synchronisation first."
                    action={can("finance:create") ? <Link href="/finance/journals?new=1"><Button size="sm">Create journal</Button></Link> : undefined}
                  />
                </Panel>
              );
            }
            const groups: { title: string; keys: [string, RV | undefined][] }[] = [
              { title: "Profitability", keys: Object.entries(d.profitability || {}) as [string, RV][] },
              { title: "Liquidity", keys: Object.entries(d.liquidity || {}) as [string, RV][] },
              { title: "Solvency", keys: Object.entries(d.solvency || {}) as [string, RV][] },
              { title: "Efficiency", keys: Object.entries(d.efficiency || {}) as [string, RV][] },
            ];
            const acqEntries = Object.entries(d.acquisition || {}).filter(([, v]) => v && typeof v === "object" && "formula" in (v as object));
            if (kind === "cac") {
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    {acqEntries.map(([k, v]) => {
                      const r = v as RV;
                      return (
                        <KpiCard key={k} label={k.replace(/_/g, " ")} value={fmtRatio(r)} hint={ratioHint(r)} />
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">As of {d.as_of}. {(d.acquisition as any)?.notes}</p>
                </div>
              );
            }
            return (
              <div className="space-y-4">
                {groups.map((g) => (
                  <Panel key={g.title} title={g.title}>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 p-3">
                      {g.keys.map(([k, v]) => (
                        <KpiCard key={k} label={k.replace(/_/g, " ")} value={fmtRatio(v)} hint={ratioHint(v)} />
                      ))}
                    </div>
                  </Panel>
                ))}
                <Panel title="Components (posted)">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 p-3">
                    {Object.entries(d.components || {}).map(([k, v]) => (
                      <KpiCard key={k} label={k.replace(/_/g, " ")} value={fmtMoney(v, d.currency || currency)} />
                    ))}
                  </div>
                </Panel>
                <p className="text-xs text-muted-foreground">As of {d.as_of}. Null metrics mean the denominator is zero or source data is missing — values are never estimated.</p>
              </div>
            );
          }}
        </QueryBoundary>
      )}

      {(kind === "pnl" || kind === "balance-sheet" || kind === "cashflow") && (
        <QueryBoundary q={statement}>
          {(d) => {
            if (!d.has_postings) {
              return (
                <Panel>
                  <EmptyState
                    title="Insufficient posted data"
                    description="Statements only use posted ledger entries."
                    action={can("finance:create") ? <Link href="/finance/journals?new=1"><Button size="sm">Create journal</Button></Link> : undefined}
                  />
                </Panel>
              );
            }
            const lines = (d.lines || []).filter((l) => l.kind !== "spacer");
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span>{d.title}</span>
                  {d.period && <span>· {d.period.from} → {d.period.to}</span>}
                  {d.as_of && <span>· as of {d.as_of}</span>}
                  {d.balanced != null && <span>· {d.balanced ? "Balanced" : "Out of balance"}</span>}
                  {stmtPath && (
                    <button type="button" className="underline text-primary" onClick={() => void fin.download(stmtPath, {}, `${kind}.csv`)}>
                      Download CSV
                    </button>
                  )}
                </div>
                <Panel title="Statement lines" flush>
                  <DataTable
                    rowKey={(r) => r.key}
                    columns={[
                      { key: "code", header: "Code", render: (r: StmtLine) => r.code || "" },
                      { key: "label", header: "Label", render: (r: StmtLine) => (
                        <span style={{ paddingLeft: `${(r.indent || 0) * 12}px` }} className={r.kind === "total" || r.kind === "subtotal" ? "font-semibold" : r.kind === "header" ? "font-medium text-muted-foreground" : ""}>
                          {r.label}
                        </span>
                      ) },
                      { key: "amount", header: "Amount", align: "right", render: (r: StmtLine) => r.amount != null ? fmtMoney(r.amount, d.currency || currency) : "" },
                    ]}
                    rows={lines}
                  />
                </Panel>
                {d.basis && <p className="text-xs text-muted-foreground">{d.basis}</p>}
              </div>
            );
          }}
        </QueryBoundary>
      )}

      {(kind === "revenue" || kind === "expenses" || kind === "working-capital") && (
        <QueryBoundary q={dash}>
          {(d) => {
            const k = d.kpis || {};
            const money = (x: Kpi | null | undefined) => (x ? fmtMoney(x.value, d.currency || currency) : "—");
            if (!d.has_postings) {
              return (
                <Panel>
                  <EmptyState
                    title="Insufficient posted data"
                    description="This analysis only uses posted ledger entries."
                    action={can("finance:create") ? <Link href="/finance/journals?new=1"><Button size="sm">Create journal</Button></Link> : undefined}
                  />
                </Panel>
              );
            }
            const cards =
              kind === "revenue" ? [
                { key: "revenue", label: "Revenue" },
                { key: "gross_profit", label: "Gross profit" },
                { key: "net_profit", label: "Net profit" },
                { key: "net_margin_pct", label: "Net margin" },
              ] : kind === "expenses" ? [
                { key: "expenses", label: "Total expenses" },
                { key: "gross_profit", label: "Gross profit" },
                { key: "net_profit", label: "Net profit" },
              ] : [
                { key: "cash_and_bank", label: "Cash & bank" },
                { key: "receivables", label: "Receivables" },
                { key: "payables", label: "Payables" },
                { key: "net_profit", label: "Net profit" },
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
                {kind === "working-capital" && (
                  <QueryBoundary q={ratios}>
                    {(r) => (
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <KpiCard label="Current ratio" value={fmtRatio(r.liquidity?.current_ratio)} hint={ratioHint(r.liquidity?.current_ratio)} />
                        <KpiCard label="Quick ratio" value={fmtRatio(r.liquidity?.quick_ratio)} hint={ratioHint(r.liquidity?.quick_ratio)} />
                        <KpiCard label="Cash ratio" value={fmtRatio(r.liquidity?.cash_ratio)} hint={ratioHint(r.liquidity?.cash_ratio)} />
                        <KpiCard label="Working capital" value={fmtRatio(r.liquidity?.working_capital)} hint={ratioHint(r.liquidity?.working_capital)} />
                      </div>
                    )}
                  </QueryBoundary>
                )}
                {d.monthly?.length > 0 && (kind === "revenue" || kind === "expenses") && (
                  <Panel title="Period movement" description="Posted amounts only" flush>
                    <DataTable
                      rowKey={(m) => m.period}
                      columns={[
                        { key: "period", header: "Period", render: (m: Dash["monthly"][0]) => m.period },
                        { key: "revenue", header: "Revenue", align: "right", render: (m) => fmtMoney(m.revenue, d.currency) },
                        { key: "expenses", header: "Expenses", align: "right", render: (m) => fmtMoney(m.expenses, d.currency) },
                        { key: "net", header: "Net", align: "right", render: (m) => fmtMoney(m.net, d.currency) },
                      ]}
                      rows={d.monthly}
                    />
                  </Panel>
                )}
                {kind === "working-capital" && ageing.data?.items && (
                  <Panel title="Receivables signal">
                    <p className="p-4 text-sm text-muted-foreground">
                      {ageing.data.items.length} ageing bucket row(s) loaded. Open{" "}
                      <Link href="/finance/receivables" className="underline">Receivables ageing</Link> for detail.
                    </p>
                  </Panel>
                )}
                <p className="text-xs text-muted-foreground">As of {d.as_of}.</p>
              </div>
            );
          }}
        </QueryBoundary>
      )}
    </>
  );
}
