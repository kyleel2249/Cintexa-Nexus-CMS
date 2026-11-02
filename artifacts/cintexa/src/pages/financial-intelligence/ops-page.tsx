/** Phases 10–21 — payment bridge, FX, board packs, comparatives, agents, notifications, health. */
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader, Panel, QueryBoundary, EmptyState, DataTable, Field, Input, Select } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceMutation, useFinanceQuery, invalidateFinance } from "@/lib/finance/hooks";
import { fin, fmtMoney } from "@/lib/finance/api";

export type OpsMode =
  | "payment-bridge" | "fx" | "board-packs" | "comparatives"
  | "agents" | "notifications" | "permissions" | "audit" | "health";

export default function OpsPage({ mode }: { mode: OpsMode }) {
  const { can, currency } = useFinance();
  switch (mode) {
    case "payment-bridge": return <PaymentBridge />;
    case "fx": return <FxView can={can} />;
    case "board-packs": return <BoardPacks can={can} />;
    case "comparatives": return <Comparatives can={can} currency={currency} />;
    case "agents": return <Agents can={can} />;
    case "notifications": return <Notifications can={can} />;
    case "permissions": return <Permissions />;
    case "audit": return <Audit />;
    case "health": return <Health />;
  }
}

function Shell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} description={description} actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/settings">Settings</Link></Button>
        </div>
      } />
      {children}
    </>
  );
}

function PaymentBridge() {
  const q = useFinanceQuery<any>("/intelligence/payment-bridge");
  return (
    <Shell title="Payment Bridge" description="Sales payment events versus Finance payment records. Revenue is never posted for unpaid orders.">
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">Finance payments</div><div className="text-lg font-semibold tabular-nums">{d.finance_payment_records}</div></div>
            {Object.entries(d.events_by_status ?? {}).map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground capitalize">{k}</div><div className="text-lg font-semibold tabular-nums">{String(v)}</div></div>
            ))}
          </div>
          <Panel title="Recent payment-related events">
            {(d.recent_events?.length ?? 0) === 0
              ? <EmptyState title="No payment events" description="Events appear when the Sales outbox processes payment messages." />
              : <DataTable rowKey={(r) => r.id} columns={[
                  { key: "id", header: "ID", render: (r: any) => r.id },
                  { key: "type", header: "Type", render: (r: any) => r.event_type },
                  { key: "status", header: "Status", render: (r: any) => r.status },
                  { key: "err", header: "Error", render: (r: any) => r.last_error || "—" },
                ]} rows={d.recent_events} />}
          </Panel>
          <p className="text-xs text-muted-foreground">{d.note}</p>
        </div>
      )}</QueryBoundary>
    </Shell>
  );
}

function FxView({ can }: { can: (p: string) => boolean }) {
  const rates = useFinanceQuery<{ items: any[] }>("/fx/rates");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ from_currency: "USD", to_currency: "GHS", rate: "", as_of_date: new Date().toISOString().slice(0, 10) });
  const [conv, setConv] = useState({ from: "USD", to: "GHS", amount: "100", result: null as any });
  const refresh = () => invalidateFinance("/fx");
  const create = useFinanceMutation(() => fin.post("/fx/rates", form), { success: "FX rate saved", onSuccess: () => { setShow(false); refresh(); } });
  const doConvert = useFinanceMutation(
    () => fin.get("/fx/convert", { from: conv.from, to: conv.to, amount: conv.amount }),
    { onSuccess: (r) => setConv((p) => ({ ...p, result: r })) },
  );
  return (
    <Shell title="Multi-currency FX" description="Manual FX rates for conversion. Rates never invent market prices.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Convert" description="Uses the latest rate on or before today">
          <div className="p-4 grid grid-cols-2 gap-3">
            <Field label="From"><Input value={conv.from} onChange={(e) => setConv((p) => ({ ...p, from: e.target.value.toUpperCase() }))} maxLength={3} /></Field>
            <Field label="To"><Input value={conv.to} onChange={(e) => setConv((p) => ({ ...p, to: e.target.value.toUpperCase() }))} maxLength={3} /></Field>
            <Field label="Amount"><Input value={conv.amount} onChange={(e) => setConv((p) => ({ ...p, amount: e.target.value }))} /></Field>
            <Button onClick={() => void doConvert.run()} disabled={doConvert.pending}>{doConvert.pending ? "…" : "Convert"}</Button>
            {conv.result && <p className="col-span-2 text-sm">Rate {conv.result.rate}: <strong className="tabular-nums">{conv.result.converted}</strong> (as of {conv.result.as_of})</p>}
          </div>
        </Panel>
        <Panel title="Rates" actions={can("finance:create") ? <Button size="sm" onClick={() => setShow((v) => !v)}>{show ? "Cancel" : "Add rate"}</Button> : undefined}>
          {show && (
            <div className="p-4 border-b grid md:grid-cols-2 gap-3">
              <Field label="From"><Input value={form.from_currency} onChange={(e) => setForm((p) => ({ ...p, from_currency: e.target.value.toUpperCase() }))} maxLength={3} /></Field>
              <Field label="To"><Input value={form.to_currency} onChange={(e) => setForm((p) => ({ ...p, to_currency: e.target.value.toUpperCase() }))} maxLength={3} /></Field>
              <Field label="Rate" required><Input value={form.rate} onChange={(e) => setForm((p) => ({ ...p, rate: e.target.value }))} /></Field>
              <Field label="As of"><Input type="date" value={form.as_of_date} onChange={(e) => setForm((p) => ({ ...p, as_of_date: e.target.value }))} /></Field>
              <Button disabled={create.pending || !form.rate} onClick={() => void create.run()}>{create.pending ? "Saving…" : "Save"}</Button>
            </div>
          )}
          <QueryBoundary q={rates}>{(d) => d.items.length === 0
            ? <EmptyState title="No FX rates" description="Add a rate to enable conversion." />
            : <DataTable rowKey={(r) => r.id} columns={[
                { key: "pair", header: "Pair", render: (r: any) => `${r.from_currency}/${r.to_currency}` },
                { key: "rate", header: "Rate", align: "right", render: (r: any) => r.rate },
                { key: "asof", header: "As of", render: (r: any) => String(r.as_of_date).slice(0, 10) },
                { key: "src", header: "Source", render: (r: any) => r.source },
              ]} rows={d.items} />
          }</QueryBoundary>
        </Panel>
      </div>
    </Shell>
  );
}

function BoardPacks({ can }: { can: (p: string) => boolean }) {
  const packs = useFinanceQuery<{ items: any[] }>("/board-packs");
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ title: "", as_of_date: new Date().toISOString().slice(0, 10) });
  const [bundle, setBundle] = useState<any>(null);
  const refresh = () => invalidateFinance("/board-packs");
  const create = useFinanceMutation(() => fin.post("/board-packs", form), { success: "Board pack created", onSuccess: () => { setShow(false); refresh(); } });
  const publish = useFinanceMutation((id: number) => fin.post(`/board-packs/${id}/publish`, {}), { success: "Published", onSuccess: refresh });
  const loadBundle = useFinanceMutation((id: number) => fin.get(`/board-packs/${id}/bundle`), { onSuccess: (r) => setBundle(r) });
  return (
    <Shell title="Board packs" description="Management packs that reference live P&L, balance sheet, cash flow, and ratios — no embedded sample data.">
      <Panel title="Packs" actions={can("finance:create") ? <Button size="sm" onClick={() => setShow((v) => !v)}>{show ? "Cancel" : "New pack"}</Button> : undefined}>
        {show && (
          <div className="p-4 border-b grid md:grid-cols-3 gap-3">
            <Field label="Title" required><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field>
            <Field label="As of" required><Input type="date" value={form.as_of_date} onChange={(e) => setForm((p) => ({ ...p, as_of_date: e.target.value }))} /></Field>
            <Button disabled={create.pending || !form.title.trim()} onClick={() => void create.run()}>{create.pending ? "Saving…" : "Save draft"}</Button>
          </div>
        )}
        <QueryBoundary q={packs}>{(d) => d.items.length === 0
          ? <EmptyState title="No board packs" description="Create a pack to assemble live statements for a reporting date." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "title", header: "Title", render: (r: any) => r.title },
              { key: "asof", header: "As of", render: (r: any) => String(r.as_of_date).slice(0, 10) },
              { key: "status", header: "Status", render: (r: any) => r.status },
              { key: "actions", header: "", render: (r: any) => (
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="outline" onClick={() => void loadBundle.run(r.id)}>Bundle</Button>
                  {r.status === "draft" && can("finance:approve") && <Button size="sm" onClick={() => void publish.run(r.id)} disabled={publish.pending}>Publish</Button>}
                </div>
              ) },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
      {bundle && (
        <Panel title={`Bundle: ${bundle.pack?.code}`} className="mt-4" actions={<Button size="sm" variant="outline" onClick={() => setBundle(null)}>Close</Button>}>
          <ul className="p-4 space-y-2 text-sm">
            {(bundle.sections ?? []).map((s: any) => (
              <li key={s.key}><Link href={`/financial-intelligence/${s.key === "pnl" ? "profit-loss" : s.key === "balance_sheet" ? "balance-sheet" : s.key === "cash_flow" ? "cashflow" : "ratios"}`} className="underline">{s.key}</Link> · {s.path}</li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-xs text-muted-foreground">{bundle.note}</p>
        </Panel>
      )}
    </Shell>
  );
}

function Comparatives({ can, currency }: { can: (p: string) => boolean; currency: string }) {
  const list = useFinanceQuery<{ items: any[] }>("/comparatives");
  const [form, setForm] = useState({
    label: "YTD vs prior",
    base_from: `${new Date().getFullYear() - 1}-01-01`,
    base_to: `${new Date().getFullYear() - 1}-12-31`,
    compare_from: `${new Date().getFullYear()}-01-01`,
    compare_to: new Date().toISOString().slice(0, 10),
  });
  const refresh = () => invalidateFinance("/comparatives");
  const run = useFinanceMutation(() => fin.post("/comparatives", form), { success: "Comparative saved", onSuccess: refresh });
  return (
    <Shell title="Comparative analysis" description="Period-versus-period KPIs from posted ledger only.">
      {can("finance:create") && (
        <Panel title="Run comparative">
          <div className="p-4 grid md:grid-cols-3 gap-3">
            <Field label="Label"><Input value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} /></Field>
            <Field label="Base from"><Input type="date" value={form.base_from} onChange={(e) => setForm((p) => ({ ...p, base_from: e.target.value }))} /></Field>
            <Field label="Base to"><Input type="date" value={form.base_to} onChange={(e) => setForm((p) => ({ ...p, base_to: e.target.value }))} /></Field>
            <Field label="Compare from"><Input type="date" value={form.compare_from} onChange={(e) => setForm((p) => ({ ...p, compare_from: e.target.value }))} /></Field>
            <Field label="Compare to"><Input type="date" value={form.compare_to} onChange={(e) => setForm((p) => ({ ...p, compare_to: e.target.value }))} /></Field>
            <Button onClick={() => void run.run()} disabled={run.pending}>{run.pending ? "Running…" : "Run"}</Button>
          </div>
        </Panel>
      )}
      <Panel title="Saved runs">
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No comparatives" description="Run a base vs compare period analysis." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "code", header: "Code", render: (r: any) => r.code },
              { key: "label", header: "Label", render: (r: any) => r.label },
              { key: "base", header: "Base", render: (r: any) => `${String(r.base_from).slice(0, 10)} → ${String(r.base_to).slice(0, 10)}` },
              { key: "cmp", header: "Compare", render: (r: any) => `${String(r.compare_from).slice(0, 10)} → ${String(r.compare_to).slice(0, 10)}` },
              { key: "rev", header: "Rev Δ", align: "right", render: (r: any) => r.snapshot?.variance?.revenue != null ? fmtMoney(r.snapshot.variance.revenue, currency) : "—" },
              { key: "net", header: "Net Δ", align: "right", render: (r: any) => r.snapshot?.variance?.net_profit != null ? fmtMoney(r.snapshot.variance.net_profit, currency) : "—" },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Agents({ can }: { can: (p: string) => boolean }) {
  const list = useFinanceQuery<{ items: any[] }>("/agents/recommendations");
  const refresh = () => invalidateFinance("/agents");
  const gen = useFinanceMutation(() => fin.post("/agents/generate", {}), { success: "Recommendations generated", onSuccess: refresh });
  const decide = useFinanceMutation(({ id, decision }: { id: number; decision: string }) => fin.post(`/agents/recommendations/${id}/decide`, { decision }), { success: "Updated", onSuccess: refresh });
  return (
    <Shell title="Intelligence agents" description="Rule-based recommendations from posted KPIs and open alerts — not generative AI inventing figures.">
      <div className="mb-3">
        {can("finance:create") && <Button size="sm" onClick={() => void gen.run()} disabled={gen.pending}>{gen.pending ? "Generating…" : "Generate recommendations"}</Button>}
      </div>
      <Panel title="Recommendations">
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No recommendations" description="Generate to evaluate standard rules against the ledger." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "sev", header: "Severity", render: (r: any) => r.severity },
              { key: "cat", header: "Category", render: (r: any) => r.category },
              { key: "title", header: "Title", render: (r: any) => r.title },
              { key: "status", header: "Status", render: (r: any) => r.status },
              { key: "actions", header: "", render: (r: any) => r.status === "open" && can("finance:update") ? (
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="outline" onClick={() => void decide.run({ id: r.id, decision: "accepted" })}>Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => void decide.run({ id: r.id, decision: "dismissed" })}>Dismiss</Button>
                </div>
              ) : null },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Notifications({ can }: { can: (p: string) => boolean }) {
  const list = useFinanceQuery<{ items: any[] }>("/intelligence/notifications");
  const refresh = () => invalidateFinance("/intelligence/notifications");
  const digest = useFinanceMutation(() => fin.post("/intelligence/notifications/digest", {}), { success: "Digest created", onSuccess: refresh });
  const read = useFinanceMutation((id: number) => fin.post(`/intelligence/notifications/${id}/read`, {}), { success: "Marked read", onSuccess: refresh });
  return (
    <Shell title="Notifications" description="In-app digests for open alerts and intelligence events.">
      <div className="mb-3">
        {can("finance:create") && <Button size="sm" onClick={() => void digest.run()} disabled={digest.pending}>{digest.pending ? "…" : "Create alert digest"}</Button>}
      </div>
      <Panel title="Inbox">
        <QueryBoundary q={list}>{(d) => d.items.length === 0
          ? <EmptyState title="No notifications" description="Create a digest or wait for alert-driven messages." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "title", header: "Title", render: (r: any) => r.title },
              { key: "type", header: "Type", render: (r: any) => r.event_type },
              { key: "status", header: "Status", render: (r: any) => r.status },
              { key: "actions", header: "", render: (r: any) => r.status !== "read" && can("finance:update") ? <Button size="sm" variant="outline" onClick={() => void read.run(r.id)}>Mark read</Button> : null },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Permissions() {
  const q = useFinanceQuery<any>("/intelligence/permissions");
  return (
    <Shell title="FI permissions matrix" description="How Finance roles map to Financial Intelligence surfaces.">
      <QueryBoundary q={q}>{(d) => (
        <Panel title={`Role: ${d.role}`}>
          <DataTable rowKey={(r) => r.perm} columns={[
            { key: "perm", header: "Permission", render: (r: any) => r.perm },
            { key: "areas", header: "FI areas", render: (r: any) => r.areas },
          ]} rows={Object.entries(d.matrix || {}).map(([perm, areas]) => ({ perm, areas: (areas as string[]).join(", ") }))} />
          <p className="p-3 text-xs text-muted-foreground">{d.note}</p>
        </Panel>
      )}</QueryBoundary>
    </Shell>
  );
}

function Audit() {
  const q = useFinanceQuery<{ items: any[] }>("/intelligence/audit");
  return (
    <Shell title="FI audit trail" description="Audit events for capital, dividends, budgets, FX, packs, and alerts.">
      <Panel title="Recent FI audit events">
        <QueryBoundary q={q}>{(d) => d.items.length === 0
          ? <EmptyState title="No FI audit events yet" description="Actions on FI entities write to the Finance audit chain." />
          : <DataTable rowKey={(r) => r.id} columns={[
              { key: "id", header: "ID", render: (r: any) => r.id },
              { key: "action", header: "Action", render: (r: any) => r.action },
              { key: "entity", header: "Entity", render: (r: any) => `${r.entity_type} ${r.entity_id ?? ""}` },
              { key: "summary", header: "Summary", render: (r: any) => r.summary },
              { key: "actor", header: "Actor", render: (r: any) => r.actor_label || r.actor_id },
            ]} rows={d.items} />
        }</QueryBoundary>
      </Panel>
    </Shell>
  );
}

function Health() {
  const health = useFinanceQuery<any>("/intelligence/health-check");
  const ready = useFinanceQuery<any>("/intelligence/readiness");
  const refresh = () => { invalidateFinance("/intelligence/health-check"); invalidateFinance("/intelligence/readiness"); };
  return (
    <Shell title="Module health & readiness" description="Phases 1–21 schema presence and per-module row checks.">
      <div className="mb-3"><Button size="sm" variant="outline" onClick={refresh}>Refresh</Button></div>
      <QueryBoundary q={ready}>{(r) => (
        <Panel title="Readiness" className="mb-4">
          <p className="p-4 text-sm">Overall: <strong>{r.ready ? "READY" : "NOT READY"}</strong> — {r.note}</p>
          <DataTable rowKey={(x) => x.k} columns={[
            { key: "k", header: "Check", render: (x: any) => x.k },
            { key: "v", header: "OK", render: (x: any) => x.v ? "Yes" : "No" },
          ]} rows={Object.entries(r.checks || {}).map(([k, v]) => ({ k, v }))} />
        </Panel>
      )}</QueryBoundary>
      <QueryBoundary q={health}>{(h) => (
        <Panel title={`Module health — ${h.overall}`}>
          <DataTable rowKey={(m) => m.module} columns={[
            { key: "m", header: "Module", render: (m: any) => m.module },
            { key: "s", header: "Status", render: (m: any) => m.status },
            { key: "d", header: "Detail", render: (m: any) => m.detail },
          ]} rows={h.modules || []} />
        </Panel>
      )}</QueryBoundary>
    </Shell>
  );
}
