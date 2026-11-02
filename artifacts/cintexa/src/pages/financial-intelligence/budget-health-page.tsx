/** Phase 8 — Budget & Forecasting, Financial Health & Alerts. */
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader, Panel, QueryBoundary, EmptyState, DataTable, Field, Input, Select } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceMutation, useFinanceQuery, invalidateFinance } from "@/lib/finance/hooks";
import { fin, fmtMoney } from "@/lib/finance/api";

type Mode = "budget" | "health";

export default function BudgetHealthPage({ mode }: { mode: Mode }) {
  const { can, currency } = useFinance();

  if (mode === "budget") return <BudgetView can={can} currency={currency} />;
  return <HealthView can={can} currency={currency} />;
}

function BudgetView({ can, currency }: { can: (p: string) => boolean; currency: string }) {
  const budgets = useFinanceQuery<{ items: any[] }>("/budgets");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useFinanceQuery<any>(selectedId ? `/budgets/${selectedId}` : null);
  const vsActual = useFinanceQuery<any>(selectedId ? `/budgets/${selectedId}/vs-actual` : null);
  const [showNew, setShowNew] = useState(false);
  const [showLine, setShowLine] = useState(false);
  const [showScen, setShowScen] = useState(false);
  const [form, setForm] = useState({ name: "", period_from: new Date().toISOString().slice(0, 10), period_to: new Date().toISOString().slice(0, 10) });
  const [lineForm, setLineForm] = useState({ category: "operating_expense", label: "", amount: "" });
  const [scenForm, setScenForm] = useState({ name: "", scenario_type: "base", adjustment_pct: "" });
  const refresh = () => { invalidateFinance("/budgets"); if (selectedId) { invalidateFinance(`/budgets/${selectedId}`); } };
  const create = useFinanceMutation(() => fin.post("/budgets", form), { success: "Budget created", onSuccess: () => { setShowNew(false); refresh(); } });
  const addLine = useFinanceMutation(() => fin.post(`/budgets/${selectedId}/lines`, lineForm), { success: "Line added", onSuccess: () => { setShowLine(false); refresh(); } });
  const activate = useFinanceMutation((id: number) => fin.post(`/budgets/${id}/activate`, {}), { success: "Budget activated", onSuccess: refresh });
  const addScen = useFinanceMutation(() => fin.post(`/budgets/${selectedId}/scenarios`, { name: scenForm.name, scenario_type: scenForm.scenario_type, adjustment_pct: scenForm.adjustment_pct || undefined }), { success: "Scenario added", onSuccess: () => { setShowScen(false); refresh(); } });

  return (
    <>
      <PageHeader title="Budget & Forecasting" description="Budget vs actual from posted ledger only. Scenarios adjust budget lines by percentage — they never invent actuals." actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
          {can("finance:create") && <Button size="sm" onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "New budget"}</Button>}
        </div>
      } />
      {showNew && (
        <Panel title="New budget">
          <div className="p-4 space-y-3 grid md:grid-cols-3 gap-3">
            <Field label="Name" required><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="From" required><Input type="date" value={form.period_from} onChange={(e) => setForm((p) => ({ ...p, period_from: e.target.value }))} /></Field>
            <Field label="To" required><Input type="date" value={form.period_to} onChange={(e) => setForm((p) => ({ ...p, period_to: e.target.value }))} /></Field>
            <Button disabled={create.pending || !form.name.trim()} onClick={() => void create.run()}>{create.pending ? "Saving…" : "Save draft"}</Button>
          </div>
        </Panel>
      )}
      <Panel title="Budgets">
        <QueryBoundary q={budgets}>{(d) => d.items.length === 0
          ? <EmptyState title="No budgets" description="Create a budget for a period, then add lines by category." />
          : <DataTable columns={[{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "period", header: "Period" }, { key: "status", header: "Status" }, { key: "actions", header: "" }] as any}
              rows={d.items.map((b: any) => ({
                code: b.code, name: b.name,
                period: `${String(b.period_from).slice(0, 10)} → ${String(b.period_to).slice(0, 10)}`,
                status: b.status,
                actions: (
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(b.id)}>Open</Button>
                    {b.status === "draft" && can("finance:approve") && <Button size="sm" onClick={() => void activate.run(b.id)} disabled={activate.pending}>Activate</Button>}
                  </div>
                ),
              }))} />
        }</QueryBoundary>
      </Panel>
      {selectedId && (
        <>
          <Panel title="Budget lines" actions={
            <div className="flex gap-2">
              {can("finance:create") && <Button size="sm" variant="outline" onClick={() => setShowLine((v) => !v)}>{showLine ? "Cancel" : "Add line"}</Button>}
              {can("finance:create") && <Button size="sm" variant="outline" onClick={() => setShowScen((v) => !v)}>{showScen ? "Cancel" : "Add scenario"}</Button>}
              <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          }>
            {showLine && (
              <div className="p-4 border-b grid md:grid-cols-4 gap-3">
                <Field label="Category"><Input value={lineForm.category} onChange={(e) => setLineForm((p) => ({ ...p, category: e.target.value }))} placeholder="e.g. operating_expense" /></Field>
                <Field label="Label" required><Input value={lineForm.label} onChange={(e) => setLineForm((p) => ({ ...p, label: e.target.value }))} /></Field>
                <Field label="Amount" required><Input value={lineForm.amount} onChange={(e) => setLineForm((p) => ({ ...p, amount: e.target.value }))} /></Field>
                <Button disabled={addLine.pending || !lineForm.label || !lineForm.amount} onClick={() => void addLine.run()}>{addLine.pending ? "Saving…" : "Add"}</Button>
              </div>
            )}
            {showScen && (
              <div className="p-4 border-b grid md:grid-cols-4 gap-3">
                <Field label="Name" required><Input value={scenForm.name} onChange={(e) => setScenForm((p) => ({ ...p, name: e.target.value }))} /></Field>
                <Field label="Type"><Select value={scenForm.scenario_type} onChange={(e) => setScenForm((p) => ({ ...p, scenario_type: e.target.value }))}>{["conservative","base","aggressive","custom"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                <Field label="Adjustment %"><Input value={scenForm.adjustment_pct} onChange={(e) => setScenForm((p) => ({ ...p, adjustment_pct: e.target.value }))} placeholder="-10 / 0 / 10" /></Field>
                <Button disabled={addScen.pending || !scenForm.name.trim()} onClick={() => void addScen.run()}>{addScen.pending ? "Saving…" : "Add scenario"}</Button>
              </div>
            )}
            <QueryBoundary q={detail}>{(d) => (d.lines?.length ?? 0) === 0
              ? <EmptyState title="No lines" description="Add budget lines by category (matches ledger account categories)." />
              : <DataTable columns={[{ key: "category", header: "Category" }, { key: "label", header: "Label" }, { key: "amount", header: "Budget", align: "right" as const }] as any}
                  rows={d.lines.map((l: any) => ({ category: l.category, label: l.label, amount: fmtMoney(l.amount, d.budget.currency || currency) }))} />
            }</QueryBoundary>
          </Panel>
          <Panel title="Budget vs actual" description="Actuals from posted ledger in the budget period">
            <QueryBoundary q={vsActual}>{(v) => (
              <div className="space-y-3">
                <div className="px-4 pt-3 grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Budget total</div><div className="font-semibold tabular-nums">{fmtMoney(v.totals.budget, v.budget.currency || currency)}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Actual total</div><div className="font-semibold tabular-nums">{fmtMoney(v.totals.actual, v.budget.currency || currency)}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Variance</div><div className="font-semibold tabular-nums">{fmtMoney(v.totals.variance, v.budget.currency || currency)}</div></div>
                </div>
                {(v.comparison?.length ?? 0) === 0
                  ? <EmptyState title="No comparison lines" description="Add budget lines first." />
                  : <DataTable columns={[
                      { key: "label", header: "Line" }, { key: "category", header: "Category" },
                      { key: "budget", header: "Budget", align: "right" as const }, { key: "actual", header: "Actual", align: "right" as const },
                      { key: "variance", header: "Variance", align: "right" as const }, { key: "vp", header: "Var %", align: "right" as const },
                    ] as any} rows={v.comparison.map((r: any) => ({
                      label: r.label, category: r.category,
                      budget: fmtMoney(r.budget, v.budget.currency || currency),
                      actual: fmtMoney(r.actual, v.budget.currency || currency),
                      variance: fmtMoney(r.variance, v.budget.currency || currency),
                      vp: r.variance_pct != null ? `${r.variance_pct}%` : "—",
                    }))} />}
                {(v.scenarios?.length ?? 0) > 0 && (
                  <div className="px-4 pb-3">
                    <p className="text-sm font-medium mb-2">Scenarios</p>
                    {v.scenarios.map((s: any) => (
                      <div key={s.code} className="mb-2 text-sm">
                        <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">({s.scenario_type}, {s.adjustment_pct}%)</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="px-4 pb-3 text-xs text-muted-foreground">{v.note}</p>
              </div>
            )}</QueryBoundary>
          </Panel>
        </>
      )}
    </>
  );
}

function HealthView({ can, currency }: { can: (p: string) => boolean; currency: string }) {
  const summary = useFinanceQuery<any>("/health/summary");
  const rules = useFinanceQuery<{ items: any[] }>("/alerts/rules");
  const events = useFinanceQuery<{ items: any[] }>("/alerts/events");
  const [showRule, setShowRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: "", metric: "current_ratio", operator: "lt", threshold: "1", severity: "warning" });
  const refresh = () => { invalidateFinance("/health"); invalidateFinance("/alerts"); };
  const createRule = useFinanceMutation(() => fin.post("/alerts/rules", ruleForm), { success: "Alert rule created", onSuccess: () => { setShowRule(false); refresh(); } });
  const evaluate = useFinanceMutation(() => fin.post("/alerts/evaluate", {}), { success: "Rules evaluated", onSuccess: refresh });
  const ack = useFinanceMutation((id: number) => fin.post(`/alerts/events/${id}/acknowledge`, {}), { success: "Acknowledged", onSuccess: refresh });

  return (
    <>
      <PageHeader title="Financial Health & Risk" description="Rule-based alerts on posted ledger KPIs. No invented figures or speculative AI recommendations." actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
          {can("finance:create") && <Button size="sm" variant="outline" onClick={() => void evaluate.run()} disabled={evaluate.pending}>{evaluate.pending ? "Evaluating…" : "Evaluate rules"}</Button>}
          {can("finance:create") && <Button size="sm" onClick={() => setShowRule((v) => !v)}>{showRule ? "Cancel" : "New rule"}</Button>}
        </div>
      } />
      <QueryBoundary q={summary}>{(s) => (
        <div className="space-y-4 mb-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Current ratio", value: s.kpis.current_ratio != null ? Number(s.kpis.current_ratio).toFixed(2) : "—" },
              { label: "Net margin", value: s.kpis.net_margin_pct != null ? `${Number(s.kpis.net_margin_pct).toFixed(2)}%` : "—" },
              { label: "Cash & bank", value: fmtMoney(s.kpis.cash_balance, s.currency || currency) },
              { label: "Working capital", value: fmtMoney(s.kpis.working_capital, s.currency || currency) },
              { label: "Open critical", value: String(s.open_alerts?.critical ?? 0) },
              { label: "Open warnings", value: String(s.open_alerts?.warning ?? 0) },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border bg-card p-3">
                <div className="text-xs text-muted-foreground">{x.label}</div>
                <div className="text-lg font-semibold mt-1 tabular-nums">{x.value}</div>
              </div>
            ))}
          </div>
          <Panel title="Automatic signals">
            <ul className="p-4 space-y-2 text-sm">
              {(s.signals ?? []).map((sig: any, i: number) => (
                <li key={i} className={sig.level === "critical" ? "text-destructive" : sig.level === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                  <span className="font-medium uppercase text-xs mr-2">{sig.level}</span>{sig.text}
                </li>
              ))}
            </ul>
            <p className="px-4 pb-3 text-xs text-muted-foreground">{s.note}</p>
          </Panel>
        </div>
      )}</QueryBoundary>
      {showRule && (
        <Panel title="New alert rule">
          <div className="p-4 grid md:grid-cols-3 gap-3">
            <Field label="Name" required><Input value={ruleForm.name} onChange={(e) => setRuleForm((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="Metric"><Select value={ruleForm.metric} onChange={(e) => setRuleForm((p) => ({ ...p, metric: e.target.value }))}>{["current_ratio","quick_ratio","cash_ratio","net_margin_pct","gross_margin_pct","debt_to_equity","cash_balance","receivables","payables","working_capital","net_profit"].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
            <Field label="Operator"><Select value={ruleForm.operator} onChange={(e) => setRuleForm((p) => ({ ...p, operator: e.target.value }))}>{["lt","lte","gt","gte"].map((o) => <option key={o} value={o}>{o}</option>)}</Select></Field>
            <Field label="Threshold" required><Input value={ruleForm.threshold} onChange={(e) => setRuleForm((p) => ({ ...p, threshold: e.target.value }))} /></Field>
            <Field label="Severity"><Select value={ruleForm.severity} onChange={(e) => setRuleForm((p) => ({ ...p, severity: e.target.value }))}>{["info","warning","critical"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Button disabled={createRule.pending || !ruleForm.name.trim()} onClick={() => void createRule.run()}>{createRule.pending ? "Saving…" : "Save rule"}</Button>
          </div>
        </Panel>
      )}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Alert rules">
          <QueryBoundary q={rules}>{(d) => d.items.length === 0
            ? <EmptyState title="No alert rules" description="Create rules such as current_ratio < 1.0 or net_margin_pct < 0." />
            : <DataTable columns={[{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "rule", header: "Rule" }, { key: "severity", header: "Severity" }, { key: "active", header: "Active" }] as any}
                rows={d.items.map((r: any) => ({ code: r.code, name: r.name, rule: `${r.metric} ${r.operator} ${r.threshold}`, severity: r.severity, active: r.is_active ? "Yes" : "No" }))} />
          }</QueryBoundary>
        </Panel>
        <Panel title="Open / recent events">
          <QueryBoundary q={events}>{(d) => d.items.length === 0
            ? <EmptyState title="No alert events" description="Run Evaluate rules to check thresholds against current KPIs." />
            : <DataTable columns={[{ key: "sev", header: "Sev" }, { key: "title", header: "Title" }, { key: "msg", header: "Detail" }, { key: "status", header: "Status" }, { key: "actions", header: "" }] as any}
                rows={d.items.map((e: any) => ({
                  sev: e.severity, title: e.title, msg: e.message, status: e.status,
                  actions: e.status === "open" && can("finance:update")
                    ? <Button size="sm" variant="outline" onClick={() => void ack.run(e.id)} disabled={ack.pending}>Ack</Button>
                    : null,
                }))} />
          }</QueryBoundary>
        </Panel>
      </div>
    </>
  );
}
