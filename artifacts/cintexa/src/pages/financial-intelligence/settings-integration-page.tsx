/** Phase 9 — FI settings and Sales↔Finance integration centre. */
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader, Panel, QueryBoundary, EmptyState, DataTable, Field, Input } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceMutation, useFinanceQuery, invalidateFinance } from "@/lib/finance/hooks";
import { fin } from "@/lib/finance/api";

type Mode = "settings" | "integration";

export default function SettingsIntegrationPage({ mode }: { mode: Mode }) {
  const { can, currency, org } = useFinance();
  if (mode === "integration") return <IntegrationView can={can} />;
  return <SettingsView can={can} currency={currency} org={org} />;
}

function SettingsView({ can, currency, org }: { can: (p: string) => boolean; currency: string; org: any }) {
  const health = useFinanceQuery<any>("/health/summary");
  const rules = useFinanceQuery<{ items: any[] }>("/alerts/rules");
  const integ = useFinanceQuery<any>("/integration/status");

  return (
    <>
      <PageHeader
        title="Financial Settings"
        description="Intelligence preferences, alert posture, and links to organisation accounting settings."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/integration">Integration</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/finance/settings">Finance settings</Link></Button>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Organisation">
          <div className="p-4 space-y-2 text-sm">
            <p><span className="text-muted-foreground">Legal name:</span> {org?.legal_name || "—"}</p>
            <p><span className="text-muted-foreground">Trading name:</span> {org?.trading_name || "—"}</p>
            <p><span className="text-muted-foreground">Functional currency:</span> {currency}</p>
            <p className="text-xs text-muted-foreground pt-2">
              Chart of accounts, fiscal periods, tax codes, and approval policies are managed in CINTEXA Finance.
            </p>
          </div>
        </Panel>
        <Panel title="Quick links">
          <div className="p-4 grid gap-2">
            {[
              { href: "/financial-intelligence/health", label: "Alert rules & health signals" },
              { href: "/financial-intelligence/budget", label: "Budgets & scenarios" },
              { href: "/financial-intelligence/integration", label: "Sales ↔ Finance integration" },
              { href: "/financial-intelligence/ratios", label: "Ratio engine" },
              { href: "/finance/settings", label: "Company settings (Finance)" },
              { href: "/finance/periods", label: "Accounting periods" },
            ].map((x) => (
              <Link key={x.href} href={x.href}><Button variant="outline" className="w-full justify-start">{x.label}</Button></Link>
            ))}
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <Panel title="Alert posture">
          <QueryBoundary q={health}>{(s) => (
            <div className="p-4 space-y-2 text-sm">
              <p>Open critical: <strong>{s.open_alerts?.critical ?? 0}</strong> · warnings: <strong>{s.open_alerts?.warning ?? 0}</strong></p>
              <ul className="space-y-1">
                {(s.signals ?? []).slice(0, 4).map((sig: any, i: number) => (
                  <li key={i} className="text-muted-foreground"><span className="uppercase text-xs font-medium mr-1">{sig.level}</span>{sig.text}</li>
                ))}
              </ul>
              <Button size="sm" variant="outline" asChild><Link href="/financial-intelligence/health">Manage alerts</Link></Button>
            </div>
          )}</QueryBoundary>
        </Panel>
        <Panel title="Configured rules">
          <QueryBoundary q={rules}>{(d) => d.items.length === 0
            ? <EmptyState title="No custom rules" description="Create threshold rules on the Health page." action={<Link href="/financial-intelligence/health"><Button size="sm">Open Health</Button></Link>} />
            : <DataTable
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", header: "Name", render: (r: any) => r.name },
                  { key: "rule", header: "Rule", render: (r: any) => `${r.metric} ${r.operator} ${r.threshold}` },
                  { key: "active", header: "Active", render: (r: any) => r.is_active ? "Yes" : "No" },
                ]}
                rows={d.items.slice(0, 8)}
              />
          }</QueryBoundary>
        </Panel>
      </div>
      <Panel title="Integration snapshot" className="mt-4">
        <QueryBoundary q={integ}>{(s) => (
          <div className="p-4 text-sm space-y-1">
            <p>Party links: <strong>{s.partyLinks ?? 0}</strong></p>
            <p className="text-muted-foreground">Event status: {JSON.stringify(s.eventsByStatus ?? {})}</p>
            <Button size="sm" variant="outline" asChild><Link href="/financial-intelligence/integration">Open integration centre</Link></Button>
          </div>
        )}</QueryBoundary>
      </Panel>
      {!can("ledger:read") && <p className="text-sm text-muted-foreground mt-2">Some panels require ledger:read.</p>}
    </>
  );
}

function IntegrationView({ can }: { can: (p: string) => boolean }) {
  const status = useFinanceQuery<any>("/integration/status");
  const links = useFinanceQuery<{ items: any[] }>("/integration/party-links");
  const [period, setPeriod] = useState({
    period_start: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
  });
  const [lastResult, setLastResult] = useState<any>(null);
  const refresh = () => { invalidateFinance("/integration"); };
  const reconcile = useFinanceMutation(
    () => fin.post("/integration/reconcile", period),
    {
      success: "Reconciliation completed",
      onSuccess: (r) => { setLastResult(r); refresh(); },
    },
  );

  return (
    <>
      <PageHeader
        title="Sales ↔ Finance Integration"
        description="Event log, party links, and period reconciliation between Sales Management and CINTEXA Finance. No duplicate postings: source_ref uniqueness is enforced."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/settings">Settings</Link></Button>
          </div>
        }
      />
      <QueryBoundary q={status}>{(s) => (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
          <div className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">Party links</div>
            <div className="text-lg font-semibold mt-1 tabular-nums">{s.partyLinks ?? 0}</div>
          </div>
          {Object.entries(s.eventsByStatus ?? {}).map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground capitalize">{k}</div>
              <div className="text-lg font-semibold mt-1 tabular-nums">{String(v)}</div>
            </div>
          ))}
        </div>
      )}</QueryBoundary>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Run reconciliation" description="Compares Sales and Finance for the selected period (finance:admin).">
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period start" required><Input type="date" value={period.period_start} onChange={(e) => setPeriod((p) => ({ ...p, period_start: e.target.value }))} /></Field>
              <Field label="Period end" required><Input type="date" value={period.period_end} onChange={(e) => setPeriod((p) => ({ ...p, period_end: e.target.value }))} /></Field>
            </div>
            <Button
              disabled={!can("finance:admin") || reconcile.pending}
              onClick={() => void reconcile.run()}
            >
              {reconcile.pending ? "Running…" : "Reconcile period"}
            </Button>
            {!can("finance:admin") && <p className="text-xs text-muted-foreground">Requires finance:admin.</p>}
            {lastResult?.reconciliation && (
              <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-auto max-h-48">{JSON.stringify(lastResult.reconciliation, null, 2)}</pre>
            )}
          </div>
        </Panel>
        <Panel title="Party links" description="Sales accounts linked to Finance customers">
          <QueryBoundary q={links}>{(d) => (d.items?.length ?? 0) === 0
            ? <EmptyState title="No party links" description="Links appear when Sales accounts sync to Finance customers." />
            : <DataTable
                rowKey={(r) => r.id}
                columns={[
                  { key: "sales", header: "Sales", render: (r: any) => r.sales_number ? `${r.sales_number} — ${r.sales_name}` : String(r.sales_account_id) },
                  { key: "finance", header: "Finance customer", render: (r: any) => `${r.finance_code} — ${r.finance_name}` },
                  { key: "type", header: "Type", render: (r: any) => r.link_type },
                  { key: "method", header: "Match", render: (r: any) => r.match_method },
                ]}
                rows={d.items}
              />
          }</QueryBoundary>
        </Panel>
      </div>

      <Panel title="Recent integration events" className="mt-4" description="Last 50 events for this organisation">
        <QueryBoundary q={status}>{(s) => (s.recentEvents?.length ?? 0) === 0
          ? <EmptyState title="No events yet" description="Events are written when Sales outbox items are processed into Finance." />
          : <DataTable
              rowKey={(r) => r.id}
              columns={[
                { key: "id", header: "ID", render: (r: any) => r.id },
                { key: "type", header: "Type", render: (r: any) => r.event_type },
                { key: "source", header: "Source", render: (r: any) => `${r.source_module}/${r.source_entity_type}` },
                { key: "status", header: "Status", render: (r: any) => r.status },
                { key: "err", header: "Error", render: (r: any) => r.last_error || "—" },
                { key: "at", header: "Created", render: (r: any) => String(r.created_at).slice(0, 19).replace("T", " ") },
              ]}
              rows={s.recentEvents}
            />
        }</QueryBoundary>
      </Panel>
    </>
  );
}
