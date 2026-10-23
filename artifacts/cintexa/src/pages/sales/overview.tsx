import { Link } from "wouter";
import { useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useSales } from "@/context/SalesContext";
import { PERIODS } from "@/lib/sales/enums";
import { money, num, percent, dateOnly, relative } from "@/lib/sales/format";
import { PageHeader, Panel, KpiCard, Select, QueryBoundary, EmptyState, ProgressBar, StatusBadge } from "@/components/sales/ui";
import { BarChart, Funnel, LineChart } from "@/components/sales/charts";
import { OwnerSelect } from "@/components/sales/pickers";
import { formatKpi, KPI_ORDER, type DashboardData } from "@/components/sales/SalesOverviewWidget";
import { labelOf } from "@/lib/sales/labels";
import { AgentStrip } from "@/components/sales/agents/AgentStrip";

interface Agenda { today: string; overdue: Act[]; today_items: Act[]; upcoming: Act[] }
interface Act { id: number; subject: string; type: string; due_at: string | null; related_name: string | null; priority: string }

export default function SalesOverviewPage() {
  const { me, can } = useSales();
  const [period, setPeriod] = useUrlFilter("period", "month");
  const [owner, setOwner] = useUrlFilter("owner_id");
  const q = useSalesQuery<DashboardData & { leadFunnel: { status: string; n: number }[]; pipelineByStage: { name: string; n: number; amount: string }[]; topProducts: { name: string; qty: string; net: string }[]; scope: string; generatedAt: string }>("/dashboard", { period, owner_id: owner || undefined });
  const agenda = useSalesQuery<Agenda>(can("activities:read") ? "/activities/agenda" : null);

  return (
    <>
      <PageHeader
        title="Sales overview"
        description={`Welcome back${me ? `, ${me.member.name.split(" ")[0]}` : ""}. Every figure links to the records behind it and shows its definition on hover.`}
        actions={
          <>
            {can("members:read") && <OwnerSelect value={owner} onChange={setOwner} label="Rep" />}
            <Select aria-label="Period" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </>
        }
      />
      <AgentStrip />
      <QueryBoundary q={q} skeletonRows={8}>
        {(d) => {
          const defs = new Map(d.definitions.map((x) => [x.key, x]));
          const by = new Map(d.kpis.map((k) => [k.key, k]));
          const empty = d.kpis.every((k) => k.value === null || Number(k.value) === 0);
          return (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">{d.range.label} · amounts in {d.currency} · scope: {d.scope} · updated {relative(d.generatedAt)}</p>
              {d.target && (
                <Panel title={d.target.label} description={`${dateOnly(d.target.periodFrom)} – ${dateOnly(d.target.periodTo)}`}>
                  <div className="flex items-center gap-4">
                    <div className="flex-1"><ProgressBar value={Number(d.target.attainmentPercent ?? 0)} tone={Number(d.target.attainmentPercent ?? 0) >= 100 ? "success" : undefined} /></div>
                    <span className="text-sm font-medium tabular-nums">{d.target.attainmentPercent == null ? "—" : percent(d.target.attainmentPercent)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{money(d.target.actual, d.currency)} of {money(d.target.target, d.currency)}</p>
                  <Link href="/sales/targets"><span className="mt-1 inline-block cursor-pointer text-xs text-primary hover:underline">View targets →</span></Link>
                </Panel>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {KPI_ORDER.filter((k) => by.has(k)).map((key) => {
                  const k = by.get(key)!;
                  const def = defs.get(key);
                  return (
                    <div key={key} title={def ? `${def.definition}\nFormula: ${def.formula}\nSource: ${def.source}` : undefined}>
                      <KpiCard label={def?.label ?? key} value={formatKpi(k, d.currency)} href={k.href} unavailable={k.available === false ? "Needs finance data — not connected" : undefined}
                        hint={key === "forecast" && k.reliability ? `Reliability: ${k.reliability}` : k.changePercent != null ? `${k.changePercent > 0 ? "+" : ""}${percent(k.changePercent)} vs previous period` : key === "win_rate" && k.value === null ? "No closed deals yet" : undefined}
                        tone={key.startsWith("overdue") && Number(k.value) > 0 ? "danger" : undefined} />
                    </div>
                  );
                })}
              </div>
              {empty && <EmptyState title="No sales activity in this period yet" description="Create leads, convert them to opportunities and confirm orders — figures appear here as real records are saved. Nothing on this page is sample data." />}
              <div className="grid gap-6 lg:grid-cols-2">
                <Panel title="Booked revenue by day" description="Confirmed orders only; cancelled orders are excluded.">
                  <LineChart data={d.trend.map((t) => ({ label: t.d.slice(5), value: Number(t.a) }))} fmt={(n) => money(String(n), d.currency)} />
                </Panel>
                <Panel title="Open pipeline by stage" actions={<Link href="/sales/pipeline"><span className="cursor-pointer text-xs text-primary hover:underline">Open board →</span></Link>}>
                  <BarChart horizontal data={d.pipelineByStage.map((s) => ({ label: `${s.name} (${s.n})`, value: Number(s.amount) }))} fmt={(n) => money(String(n), d.currency)} />
                </Panel>
                <Panel title="Lead funnel" actions={<Link href="/sales/leads"><span className="cursor-pointer text-xs text-primary hover:underline">All leads →</span></Link>}>
                  <Funnel stages={d.leadFunnel.map((l) => ({ label: labelOf(l.status), value: l.n }))} />
                </Panel>
                <Panel title="Top products" description="By net sales value in the period">
                  {d.topProducts.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No product sales in this period</p> : (
                    <ul className="divide-y text-sm">
                      {d.topProducts.map((p) => <li key={p.name} className="flex justify-between gap-3 py-2"><span className="truncate">{p.name}</span><span className="tabular-nums text-muted-foreground">{num(Number(p.qty))} × · {money(p.net, d.currency)}</span></li>)}
                    </ul>
                  )}
                </Panel>
              </div>
              {agenda.data && (
                <Panel title="My follow-ups" actions={<Link href="/sales/activities"><span className="cursor-pointer text-xs text-primary hover:underline">Open activities →</span></Link>}>
                  {[...agenda.data.overdue, ...agenda.data.today_items].length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nothing overdue or due today.</p> : (
                    <ul className="divide-y text-sm">
                      {[...agenda.data.overdue.map((a) => ({ a, late: true })), ...agenda.data.today_items.map((a) => ({ a, late: false }))].slice(0, 8).map(({ a, late }) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                          <span className="min-w-0 truncate">{a.subject}{a.related_name ? <span className="text-muted-foreground"> · {a.related_name}</span> : null}</span>
                          <span className="flex shrink-0 items-center gap-2"><StatusBadge status={late ? "missed" : "open"} label={late ? "Overdue" : "Today"} /><span className="text-xs text-muted-foreground">{dateOnly(a.due_at)}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
