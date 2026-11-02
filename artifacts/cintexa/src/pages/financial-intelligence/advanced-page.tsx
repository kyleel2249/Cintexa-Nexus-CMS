/** Phases 22–35 — saved views, KPI targets, exports, stress, WC, tax, concentration, API index. */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader, Panel, QueryBoundary, EmptyState, DataTable, Field, Input, Select } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceMutation, useFinanceQuery, invalidateFinance } from "@/lib/finance/hooks";
import { fin, fmtMoney } from "@/lib/finance/api";

export type AdvMode =
  | "views" | "kpi-targets" | "exports" | "stress" | "wc"
  | "tax" | "concentration" | "api-index" | "version";

export default function AdvancedPage({ mode }: { mode: AdvMode }) {
  const { can, currency } = useFinance();
  switch (mode) {
    case "views": return <Views can={can} />;
    case "kpi-targets": return <Targets can={can} />;
    case "exports": return <Exports can={can} />;
    case "stress": return <Stress can={can} currency={currency} />;
    case "wc": return <Wc can={can} currency={currency} />;
    case "tax": return <Tax />;
    case "concentration": return <Concentration />;
    case "api-index": return <ApiIndex />;
    case "version": return <Version />;
  }
}

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <>
      <PageHeader title={title} description={description} actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/system-health">System health</Link></Button>
        </div>
      } />
      {children}
    </>
  );
}

function Views({ can }: { can: (p: string) => boolean }) {
  const q = useFinanceQuery<{ items: any[] }>("/intelligence/views");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", view_type: "dashboard", path: "/financial-intelligence" });
  const refresh = () => invalidateFinance("/intelligence/views");
  const create = useFinanceMutation(() => fin.post("/intelligence/views", form), { success: "View saved", onSuccess: () => { setShow(false); refresh(); } });
  return (
    <Shell title="Saved views" description="Bookmarks for FI screens and query presets.">
      <Panel title="Views" actions={can("finance:create") ? <Button size="sm" onClick={() => setShow((v) => !v)}>{show ? "Cancel" : "Save view"}</Button> : undefined}>
        {show && (
          <div className="p-4 border-b grid md:grid-cols-3 gap-3">
            <Field label="Name" required><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="Type"><Select value={form.view_type} onChange={(e) => setForm((p) => ({ ...p, view_type: e.target.value }))}>{["dashboard","ratios","statement","comparative","board_pack","custom"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="Path"><Input value={form.path} onChange={(e) => setForm((p) => ({ ...p, path: e.target.value }))} /></Field>
            <Button disabled={create.pending || !form.name.trim()} onClick={() => void create.run()}>{create.pending ? "Saving…" : "Save"}</Button>
          </div>
        )}
        <QueryBoundary q={q}>{(d) => d.items.length === 0
          ? <EmptyState title="No saved views" description="Save frequently used FI screens here." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "name", header: "Name", render: (r: any) => r.name },
              { key: "type", header: "Type", render: (r: any) => r.view_type },
              { key: "path", header: "Path", render: (r: any) => <Link href={r.path} className="underline">{r.path}</Link> },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Targets({ can }: { can: (p: string) => boolean }) {
  const list = useFinanceQuery<{ items: any[] }>("/intelligence/kpi-targets");
  const evalQ = useFinanceQuery<any>("/intelligence/kpi-targets/evaluate");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ metric: "net_margin_pct", target_value: "10", operator: "gte", period_label: "YTD" });
  const refresh = () => { invalidateFinance("/intelligence/kpi-targets"); };
  const create = useFinanceMutation(() => fin.post("/intelligence/kpi-targets", form), { success: "Target saved", onSuccess: () => { setShow(false); refresh(); } });
  return (
    <Shell title="KPI targets" description="Targets compared only to posted ledger aggregates.">
      <QueryBoundary q={evalQ}>{(e) => (
        <Panel title="Evaluation" className="mb-4">
          <DataTable rowKey={(r) => r.code} columns={[
            { key: "metric", header: "Metric", render: (r: any) => r.metric },
            { key: "target", header: "Target", align: "right", render: (r: any) => `${r.operator} ${r.target}` },
            { key: "actual", header: "Actual", align: "right", render: (r: any) => r.actual != null ? String(r.actual) : "—" },
            { key: "met", header: "Met", render: (r: any) => r.met == null ? "—" : r.met ? "Yes" : "No" },
          ]} rows={e.results || []} empty={<EmptyState title="No targets" description="Create a target to evaluate." />} />
          <p className="p-3 text-xs text-muted-foreground">{e.note} As of {e.as_of}.</p>
        </Panel>
      )}</QueryBoundary>
      <Panel title="Targets" actions={can("finance:create") ? <Button size="sm" onClick={() => setShow((v) => !v)}>{show ? "Cancel" : "Add target"}</Button> : undefined}>
        {show && (
          <div className="p-4 border-b grid md:grid-cols-4 gap-3">
            <Field label="Metric"><Select value={form.metric} onChange={(e) => setForm((p) => ({ ...p, metric: e.target.value }))}>{["revenue","expenses","net_profit","net_margin_pct"].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
            <Field label="Operator"><Select value={form.operator} onChange={(e) => setForm((p) => ({ ...p, operator: e.target.value }))}>{["gte","lte","eq"].map((o) => <option key={o} value={o}>{o}</option>)}</Select></Field>
            <Field label="Target"><Input value={form.target_value} onChange={(e) => setForm((p) => ({ ...p, target_value: e.target.value }))} /></Field>
            <Button disabled={create.pending} onClick={() => void create.run()}>{create.pending ? "Saving…" : "Save"}</Button>
          </div>
        )}
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No KPI targets" description="Set targets such as net_margin_pct >= 10." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "metric", header: "Metric", render: (r: any) => r.metric },
              { key: "rule", header: "Rule", render: (r: any) => `${r.operator} ${r.target_value}` },
              { key: "active", header: "Active", render: (r: any) => r.is_active ? "Yes" : "No" },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Exports({ can }: { can: (p: string) => boolean }) {
  const list = useFinanceQuery<{ items: any[] }>("/intelligence/export-jobs");
  const refresh = () => invalidateFinance("/intelligence/export-jobs");
  const create = useFinanceMutation(
    (export_type: string) => fin.post("/intelligence/export-jobs", { export_type, params: { path: `/statements/${export_type}` } }),
    { success: "Export job recorded", onSuccess: refresh },
  );
  return (
    <Shell title="Export jobs" description="Job history for statement exports. Downloads use live posted-ledger endpoints.">
      <div className="mb-3 flex flex-wrap gap-2">
        {can("finance:create") && ["profit-loss","balance-sheet","cash-flow"].map((t) => (
          <Button key={t} size="sm" variant="outline" onClick={() => void create.run(t)} disabled={create.pending}>Queue {t}</Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => void fin.download("/statements/profit-loss", {}, "profit-loss.csv")}>Download P&amp;L CSV</Button>
      </div>
      <Panel title="History">
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No export jobs" description="Queue an export to record history." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "type", header: "Type", render: (r: any) => r.export_type },
              { key: "status", header: "Status", render: (r: any) => r.status },
              { key: "ref", header: "Result", render: (r: any) => r.result_ref || "—" },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Stress({ can, currency }: { can: (p: string) => boolean; currency: string }) {
  const list = useFinanceQuery<{ items: any[] }>("/intelligence/stress");
  const [form, setForm] = useState({ name: "Downside", revenue_adj_pct: "-10", expense_adj_pct: "5" });
  const refresh = () => invalidateFinance("/intelligence/stress");
  const create = useFinanceMutation(() => fin.post("/intelligence/stress", form), { success: "Stress scenario saved", onSuccess: refresh });
  return (
    <Shell title="Stress scenarios" description="Adjust posted YTD revenue/expense by percentage. Does not invent actuals.">
      {can("finance:create") && (
        <Panel title="New scenario" className="mb-4">
          <div className="p-4 grid md:grid-cols-4 gap-3">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="Revenue adj %"><Input value={form.revenue_adj_pct} onChange={(e) => setForm((p) => ({ ...p, revenue_adj_pct: e.target.value }))} /></Field>
            <Field label="Expense adj %"><Input value={form.expense_adj_pct} onChange={(e) => setForm((p) => ({ ...p, expense_adj_pct: e.target.value }))} /></Field>
            <Button onClick={() => void create.run()} disabled={create.pending || !form.name.trim()}>{create.pending ? "Saving…" : "Run"}</Button>
          </div>
        </Panel>
      )}
      <Panel title="Scenarios">
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No stress scenarios" description="Run a downside or upside adjustment against posted YTD." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "name", header: "Name", render: (r: any) => r.name },
              { key: "adj", header: "Adj %", render: (r: any) => `R ${r.revenue_adj_pct} / E ${r.expense_adj_pct}` },
              { key: "base", header: "Base net", align: "right", render: (r: any) => r.baseline?.net != null ? fmtMoney(r.baseline.net, currency) : "—" },
              { key: "stress", header: "Stressed net", align: "right", render: (r: any) => r.stressed?.net != null ? fmtMoney(r.stressed.net, currency) : "—" },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Wc({ can, currency }: { can: (p: string) => boolean; currency: string }) {
  const list = useFinanceQuery<{ items: any[] }>("/intelligence/working-capital/snapshots");
  const refresh = () => invalidateFinance("/intelligence/working-capital");
  const snap = useFinanceMutation(() => fin.post("/intelligence/working-capital/snapshot", {}), { success: "Snapshot captured", onSuccess: refresh });
  return (
    <Shell title="Working capital snapshots" description="Cash, receivables, payables, inventory from posted balances.">
      <div className="mb-3">{can("finance:create") && <Button size="sm" onClick={() => void snap.run()} disabled={snap.pending}>{snap.pending ? "Capturing…" : "Capture snapshot"}</Button>}</div>
      <Panel title="History">
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No snapshots" description="Capture working capital from the posted ledger." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "asof", header: "As of", render: (r: any) => String(r.as_of_date).slice(0, 10) },
              { key: "cash", header: "Cash", align: "right", render: (r: any) => fmtMoney(r.cash, currency) },
              { key: "ar", header: "AR", align: "right", render: (r: any) => fmtMoney(r.receivables, currency) },
              { key: "ap", header: "AP", align: "right", render: (r: any) => fmtMoney(r.payables, currency) },
              { key: "wc", header: "WC", align: "right", render: (r: any) => fmtMoney(r.working_capital, currency) },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Tax() {
  const q = useFinanceQuery<any>("/intelligence/tax-summary");
  return (
    <Shell title="Tax intelligence" description="Tax-named account balances from the posted ledger only.">
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-4">
          <p className="text-sm">Tax codes configured: <strong>{d.tax_codes_configured}</strong></p>
          <Panel title="Tax-related account balances">
            {(d.tax_related_account_balances?.length ?? 0) === 0
              ? <EmptyState title="No tax accounts" description={d.note} />
              : <DataTable rowKey={(r) => r.code} columns={[
                  { key: "code", header: "Code", render: (r: any) => r.code },
                  { key: "name", header: "Name", render: (r: any) => r.name },
                  { key: "bal", header: "Balance", align: "right", render: (r: any) => r.balance },
                ]} rows={d.tax_related_account_balances} />
            }
          </Panel>
          <p className="text-xs text-muted-foreground">{d.note}</p>
        </div>
      )}</QueryBoundary>
    </Shell>
  );
}

function Concentration() {
  const q = useFinanceQuery<any>("/intelligence/investor-concentration");
  return (
    <Shell title="Investor concentration" description="Ownership concentration from recorded shareholdings only.">
      <QueryBoundary q={q}>{(d) => (
        <Panel title={d.has_shareholdings ? `Total shares ${d.total_shares}` : "Share register"}>
          {!d.has_shareholdings
            ? <EmptyState title="No shareholdings" description={d.note} />
            : <DataTable rowKey={(r) => r.code} columns={[
                { key: "code", header: "Code", render: (r: any) => r.code },
                { key: "name", header: "Investor", render: (r: any) => r.name },
                { key: "shares", header: "Shares", align: "right", render: (r: any) => r.shares },
                { key: "pct", header: "%", align: "right", render: (r: any) => r.pct_of_total != null ? `${r.pct_of_total}%` : "—" },
              ]} rows={d.items} />
          }
          <p className="p-3 text-xs text-muted-foreground">{d.note}</p>
        </Panel>
      )}</QueryBoundary>
    </Shell>
  );
}

function ApiIndex() {
  const q = useFinanceQuery<any>("/intelligence/api-index");
  return (
    <Shell title="FI API index" description="Catalog of Financial Intelligence endpoints.">
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-4">
          <p className="text-sm">Version <strong>{d.version}</strong></p>
          {(d.modules || []).map((m: any) => (
            <Panel key={m.group} title={m.group}>
              <ul className="p-4 text-sm font-mono space-y-1">
                {m.paths.map((p: string) => <li key={p}>{p}</li>)}
              </ul>
            </Panel>
          ))}
          <p className="text-xs text-muted-foreground">{d.note}</p>
        </div>
      )}</QueryBoundary>
    </Shell>
  );
}

function Version() {
  const ver = useFinanceQuery<any>("/intelligence/version");
  const smoke = useFinanceQuery<any>("/intelligence/smoke");
  return (
    <Shell title="Version & smoke tests" description="Release identity and schema smoke checks for phases 1–35.">
      <QueryBoundary q={ver}>{(v) => (
        <Panel title="Version" className="mb-4">
          <div className="p-4 text-sm space-y-1">
            <p>Product: <strong>{v.product}</strong></p>
            <p>Phase: <strong>{v.phase}</strong> · Version: <strong>{v.version}</strong></p>
            <p>Status: <strong>{v.status}</strong></p>
          </div>
        </Panel>
      )}</QueryBoundary>
      <QueryBoundary q={smoke}>{(s) => (
        <Panel title={s.passed ? "Smoke: PASSED" : "Smoke: FAILED"}>
          <DataTable rowKey={(c) => c.name} columns={[
            { key: "name", header: "Check", render: (c: any) => c.name },
            { key: "ok", header: "OK", render: (c: any) => c.ok ? "Yes" : "No" },
            { key: "detail", header: "Detail", render: (c: any) => c.detail || "" },
          ]} rows={s.checks || []} />
        </Panel>
      )}</QueryBoundary>
    </Shell>
  );
}
