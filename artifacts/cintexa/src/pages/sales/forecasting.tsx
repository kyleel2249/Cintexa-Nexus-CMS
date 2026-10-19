import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { PERIODS } from "@/lib/sales/enums";
import { dateOnly, money, num, percent, dateTime } from "@/lib/sales/format";
import { PageHeader, Panel, Select, QueryBoundary, KpiCard,  DataTable, EmptyState, Modal, Field, MoneyInput, Textarea, Input } from "@/components/sales/ui";
import { BarChart } from "@/components/sales/charts";

interface Forecast {
  range: { from: string; to: string; label: string };
  forecast: { closed: string; commit: string; bestCaseDeals: string; pipelineOpen: string; weighted: string; baseCase: string; bestCase: string; worstCase: string; coverage: number | null; slippedCount: number; slippedAmount: string; overdueCount: number; openCount: number; reliability: { level: string; closedDeals: number; message: string }; assumptions: string[] };
  override: null | { amount: string; calculated: string; reason: string; set_by: string; set_at: string; note: string };
  history: { months: number; trend: null | { slope: number; intercept: number; r2: number; n: number; next: number; note: string }; seasonality: null | number[]; seasonalityNote: string };
  byOwner: { owner: string | null; deals: number; amount: string; weighted: string }[]; currency: string;
}

export default function ForecastingPage() {
  const { can } = useSales();
  const [period, setPeriod] = useUrlFilter("period", "quarter");
  const q = useSalesQuery<Forecast>("/forecast", { period });
  const acc = useSalesQuery<{ items: { id: number; label: string; forecast: string; actual: string; errorPercent: number | null }[]; summary: { mape: number | null; bias: number | null; n: number }; note?: string }>("/forecast/accuracy");
  const [dlg, setDlg] = useState<null | "override" | "snapshot">(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const override = useSalesMutation(() => sales.put("/forecast/override", { period, amount, reason }), { invalidate: ["/forecast", "/dashboard"], success: "Override saved — the calculated figure is unchanged", onSuccess: () => { setDlg(null); setAmount(""); setReason(""); } });
  const snap = useSalesMutation(() => sales.post("/forecast/snapshots", { period, ...(label ? { label } : {}) }), { invalidate: ["/forecast"], success: "Snapshot saved", onSuccess: () => { setDlg(null); setLabel(""); } });

  return (
    <>
      <PageHeader title="Sales forecasting" description="A stage-weighted forecast from open opportunities with an expected close date in the period. It says how reliable it is: with little closed-deal history it is an estimate, not a statistical prediction."
        actions={<><Select aria-label="Period" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.filter((p) => ["month", "quarter", "year", "last_month", "last_quarter"].includes(p.value)).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          {can("forecast:override") && <><Button size="sm" variant="outline" onClick={() => setDlg("snapshot")}>Save snapshot</Button><Button size="sm" onClick={() => setDlg("override")}>Manager override</Button></>}</>} />
      <QueryBoundary q={q} skeletonRows={8}>
        {(d) => {
          const f = d.forecast;
          return (
            <div className="space-y-6">
              <p className={`rounded-md border px-3 py-2 text-sm ${f.reliability.level === "estimate" ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}><strong className="capitalize">{f.reliability.level}:</strong> {f.reliability.message}</p>
              {d.override && <Panel title="Manager override in effect"><p className="text-lg font-semibold tabular-nums">{money(d.override.amount, d.currency)} <span className="text-sm font-normal text-muted-foreground">(calculated {money(d.override.calculated, d.currency)})</span></p><p className="text-sm">{d.override.reason}</p><p className="text-xs text-muted-foreground">{d.override.set_by} · {dateTime(d.override.set_at)} — {d.override.note}</p></Panel>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiCard label="Closed so far" value={money(f.closed, d.currency)} />
                <KpiCard label="Worst case" value={money(f.worstCase, d.currency)} hint="Closed + 50% of Commit" />
                <KpiCard label="Base case (weighted)" value={money(f.baseCase, d.currency)} hint={`Weighted pipeline ${money(f.weighted, d.currency)}`} />
                <KpiCard label="Best case" value={money(f.bestCase, d.currency)} hint="Closed + Commit + Best case, unweighted" />
                <KpiCard label="Open pipeline" value={money(f.pipelineOpen, d.currency)} hint={`${f.openCount} deals`} href="/sales/pipeline" />
                <KpiCard label="Commit" value={money(f.commit, d.currency)} />
                <KpiCard label="Coverage" value={f.coverage == null ? "—" : `${num(f.coverage, 1)}×`} hint={f.coverage == null ? "Needs an approved revenue target" : "Open pipeline ÷ remaining target"} />
                <KpiCard label="Slipped / overdue" value={`${f.slippedCount} / ${f.overdueCount}`} hint={`Slipped value ${money(f.slippedAmount, d.currency)}`} tone={f.overdueCount > 0 ? "warning" : undefined} href="/sales/pipeline?view=list&overdue=true" />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Panel title="Scenarios"><BarChart horizontal fmt={(n) => money(String(n), d.currency)} data={[{ label: "Worst", value: Number(f.worstCase) }, { label: "Base", value: Number(f.baseCase) }, { label: "Best", value: Number(f.bestCase) }]} /></Panel>
                <Panel title="By owner" flush>{d.byOwner.length === 0 ? <EmptyState title="No open deals closing in this period" /> : <DataTable caption="Forecast by owner" rows={d.byOwner} rowKey={(r) => r.owner ?? "none"} columns={[{ key: "o", header: "Owner", render: (r) => r.owner ?? "Unassigned" }, { key: "n", header: "Deals", align: "right", render: (r) => r.deals }, { key: "a", header: "Open", align: "right", render: (r) => money(r.amount, d.currency) }, { key: "w", header: "Weighted", align: "right", render: (r) => money(r.weighted, d.currency) }]} />}</Panel>
              </div>
              <Panel title="Trend & seasonality" description={`${d.history.months} month(s) of won-revenue history`}>
                {d.history.trend ? <p className="text-sm">Linear trend: {d.history.trend.note} (R² {num(d.history.trend.r2, 2)}).</p> : <p className="text-sm text-muted-foreground">Not enough monthly history to fit a trend.</p>}
                {d.history.trend && <p className="text-sm text-muted-foreground">Next month on trend: {money(String(Math.round(d.history.trend.next)), d.currency)} (indicative).</p>}
                {d.history.seasonality ? <div className="mt-3"><BarChart data={d.history.seasonality.map((v, i) => ({ label: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i]!, value: v }))} fmt={(n) => `${num(n, 2)}×`} /><p className="text-xs text-muted-foreground">{d.history.seasonalityNote}</p></div> : <p className="mt-1 text-sm text-muted-foreground">{d.history.seasonalityNote}</p>}
              </Panel>
              <Panel title="Forecast accuracy" description="Saved snapshots compared with what was actually won">
                {acc.data && acc.data.items.length > 0 ? (<>
                  <p className="mb-2 text-sm">Mean absolute error {acc.data.summary.mape == null ? "—" : percent(acc.data.summary.mape)} · bias {acc.data.summary.bias == null ? "—" : percent(acc.data.summary.bias)} over {acc.data.summary.n} periods.</p>
                  <DataTable caption="Snapshots" rows={acc.data.items} rowKey={(r) => r.id} columns={[{ key: "l", header: "Snapshot", render: (r) => r.label }, { key: "f", header: "Forecast", align: "right", render: (r) => money(r.forecast, d.currency) }, { key: "a", header: "Actual", align: "right", render: (r) => money(r.actual, d.currency) }, { key: "e", header: "Error", align: "right", render: (r) => (r.errorPercent == null ? "—" : percent(r.errorPercent)) }]} />
                </>) : <p className="text-sm text-muted-foreground">{acc.data?.note ?? "Loading…"}</p>}
              </Panel>
              <Panel title="How this is calculated"><ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{f.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Period: {dateOnly(d.range.from)} – {dateOnly(d.range.to)}</p></Panel>
            </div>
          );
        }}
      </QueryBoundary>
      <Modal open={dlg === "override"} onClose={() => setDlg(null)} title="Manager override" size="sm" description="Records your number next to the calculated one. The calculation is never changed; the override and your reason are audited." footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={!amount || reason.trim().length < 5 || override.pending} onClick={() => void override.run()}>Save override</Button></>}>
        <Field label="Your forecast for this period" required><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {override.error && <p role="alert" className="text-sm text-rose-500">{override.error.message}</p>}
      </Modal>
      <Modal open={dlg === "snapshot"} onClose={() => setDlg(null)} title="Save forecast snapshot" size="sm" description="Freezes today's forecast so accuracy can be measured once the period ends." footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={snap.pending} onClick={() => void snap.run()}>Save</Button></>}>
        <Field label="Label (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
