import { useState } from "react";
import { useSales } from "@/context/SalesContext";
import { useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { PERIODS } from "@/lib/sales/enums";
import { money, num, percent } from "@/lib/sales/format";
import { PageHeader, Panel, Select, QueryBoundary, DataTable, TabBar, Drawer, DefinitionList, ProgressBar, EmptyState, ErrorState, Skeleton, Tag } from "@/components/sales/ui";
import { BarChart } from "@/components/sales/charts";

interface LeaderRow { id: number; display_name: string; team_name: string | null; revenue: string | null; won: number; lost: number; activities: number; leads: number; overdue: number; winRate: number | null; attainmentPercent: number | null; target: string | null; rank: number }
type Tab = "leaderboard" | "teams";

export default function PerformancePage() {
  const { can } = useSales();
  const [period, setPeriod] = useUrlFilter("period", "month");
  const [tabRaw, setTab] = useUrlFilter("tab", "leaderboard");
  const tab: Tab = tabRaw === "teams" && can("performance:read") ? "teams" : "leaderboard";
  const [open, setOpen] = useState<number | null>(null);
  const lb = useSalesQuery<{ range: { label: string }; items: LeaderRow[]; currency: string }>(can("leaderboard:read") ? "/performance/leaderboard" : null, { period });
  const teams = useSalesQuery<{ items: { team: string; orders: number; revenue: string }[]; currency: string }>(tab === "teams" ? "/performance/teams" : null, { period });
  return (
    <>
      <PageHeader title="Sales performance" description="Revenue is booked orders net of returns. Representatives see their own revenue; peers' revenue is hidden unless you manage them. Rankings use revenue only — activity counts are shown for context, not scored."
        actions={<Select aria-label="Period" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>} />
      {can("performance:read") && <TabBar<Tab> tabs={[{ key: "leaderboard", label: "Leaderboard" }, { key: "teams", label: "Teams" }]} value={tab} onChange={setTab} />}
      {tab === "teams" ? (
        <QueryBoundary q={teams}>{(d) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Revenue by team"><BarChart horizontal data={d.items.map((t) => ({ label: t.team, value: Number(t.revenue) }))} fmt={(n) => money(String(n), d.currency)} /></Panel>
            <Panel title="Detail" flush><DataTable caption="Teams" rows={d.items} rowKey={(t) => t.team} empty={<EmptyState title="No orders in this period" />} columns={[{ key: "t", header: "Team", render: (t) => t.team }, { key: "o", header: "Orders", align: "right", render: (t) => t.orders }, { key: "r", header: "Revenue", align: "right", render: (t) => money(t.revenue, d.currency) }]} /></Panel>
          </div>
        )}</QueryBoundary>
      ) : !can("leaderboard:read") ? null : lb.error && !lb.data ? <ErrorState error={lb.error} onRetry={() => void lb.refetch()} /> : !lb.data ? <Skeleton rows={8} /> : (
        <Panel title={lb.data.range.label} flush>
          <DataTable caption="Leaderboard" rows={lb.data.items} rowKey={(r) => r.id} onRowClick={can("performance:read") ? (r) => setOpen(r.id) : undefined} empty={<EmptyState title="No data for this period" />} columns={[
            { key: "rank", header: "#", render: (r: LeaderRow) => r.rank },
            { key: "n", header: "Representative", render: (r: LeaderRow) => <div><p className="font-medium">{r.display_name}</p><p className="text-xs text-muted-foreground">{r.team_name ?? "No team"}</p></div> },
            { key: "rev", header: "Revenue", align: "right", render: (r: LeaderRow) => (r.revenue == null ? <Tag>Hidden</Tag> : money(r.revenue, lb.data!.currency)) },
            { key: "att", header: "Target", hideOnMobile: true, render: (r: LeaderRow) => (r.attainmentPercent == null ? <span className="text-muted-foreground">{r.target ? "—" : "No target"}</span> : <div className="w-28"><ProgressBar value={r.attainmentPercent} tone={r.attainmentPercent >= 100 ? "success" : undefined} /><span className="text-xs">{percent(r.attainmentPercent, 0)}</span></div>) },
            { key: "wl", header: "Won / lost", align: "right", hideOnMobile: true, render: (r: LeaderRow) => `${r.won} / ${r.lost}` },
            { key: "wr", header: "Win rate", align: "right", hideOnMobile: true, render: (r: LeaderRow) => (r.winRate == null ? "—" : percent(r.winRate)) },
            { key: "ac", header: "Activities", align: "right", hideOnMobile: true, render: (r: LeaderRow) => num(r.activities) },
            { key: "od", header: "Overdue", align: "right", hideOnMobile: true, render: (r: LeaderRow) => (r.overdue > 0 ? <span className="text-rose-500">{r.overdue}</span> : 0) },
          ]} />
        </Panel>
      )}
      {open !== null && <MemberDrawer id={open} period={period} onClose={() => setOpen(null)} />}
    </>
  );
}

function MemberDrawer({ id, period, onClose }: { id: number; period: string; onClose: () => void }) {
  const q = useSalesQuery<{ member: { display_name: string; email: string; role: string }; range: { label: string }; revenue: { amount: string; orders: number; otherCurrency: number }; monthly: { month: string; revenue: string; orders: number }[]; activities: { type: string; n: number }[]; openPipeline: { n: number; amount: string; weighted: string }; coachingNotes: string | null }>(`/performance/members/${id}`, { period });
  const d = q.data;
  return (
    <Drawer open onClose={onClose} title={d?.member.display_name ?? "Representative"} subtitle={d ? `${d.member.email} · ${d.range.label}` : undefined}>
      {q.error ? <ErrorState error={q.error} /> : !d ? <Skeleton rows={6} /> : (
        <div className="space-y-5">
          <DefinitionList items={[{ label: "Revenue", value: money(d.revenue.amount) }, { label: "Orders", value: d.revenue.orders }, { label: "Open pipeline", value: `${money(d.openPipeline.amount)} (${d.openPipeline.n} deals)` }, { label: "Weighted pipeline", value: money(d.openPipeline.weighted) }]} />
          {d.revenue.otherCurrency > 0 && <p className="text-xs text-amber-500">{d.revenue.otherCurrency} order(s) in other currencies are excluded — amounts are never converted silently.</p>}
          <div><h4 className="mb-2 text-sm font-semibold">Monthly revenue</h4><BarChart data={d.monthly.map((m) => ({ label: m.month.slice(2), value: Number(m.revenue) }))} fmt={(n) => money(String(n))} /></div>
          <div><h4 className="mb-2 text-sm font-semibold">Completed activities</h4>{d.activities.length === 0 ? <p className="text-sm text-muted-foreground">None in this period.</p> : <ul className="text-sm">{d.activities.map((a) => <li key={a.type} className="flex justify-between"><span className="capitalize">{a.type.replace(/_/g, " ")}</span><span>{a.n}</span></li>)}</ul>}</div>
          {d.coachingNotes && <div><h4 className="mb-1 text-sm font-semibold">Coaching notes (managers only)</h4><p className="whitespace-pre-wrap text-sm">{d.coachingNotes}</p></div>}
        </div>
      )}
    </Drawer>
  );
}
