import { useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales, type SalesApiError } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { FORECAST_CATEGORIES, OPP_STATUSES } from "@/lib/sales/enums";
import { dateOnly, money, moneyCompact, num, percent } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, Modal, Field, Textarea, Checkbox, QueryBoundary, type Column } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { Funnel } from "@/components/sales/charts";
import { OwnerSelect, AccountPicker } from "@/components/sales/pickers";
import { cn } from "@/lib/utils";

export interface Stage { id: number; name: string; position: number; probability: string; kind: "open" | "won" | "lost"; forecast_category: string; required_fields: string[]; stalled_after_days: number }
export interface OppRow { id: number; number: string; name: string; account_id: number; account_name: string; owner_id: number; owner_name: string | null; stage_id: number; stage_name: string; status: string; amount: string; currency: string; probability: string; forecast_category: string; expected_close_date: string | null; next_action: string | null; stalled: boolean; overdue: boolean }
interface Board { pipelineId: number; columns: { stage: Stage; count: number; amount: string; weighted: string; cards: OppRow[] }[] }
interface Pipelines { items: { id: number; name: string; is_default: boolean; stages: Stage[] }[] }

const OPP_FIELDS: FieldDef[] = [
  { name: "name", label: "Opportunity name", required: true, wide: true },
  { name: "amount", label: "Amount", type: "money", required: true },
  { name: "expected_close_date", label: "Expected close", type: "date" },
  { name: "source", label: "Source" },
  { name: "next_action", label: "Next action" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export function OpportunityFormModal({ open, onClose, accountId, accountName }: { open: boolean; onClose: () => void; accountId?: number; accountName?: string }) {
  const [, nav] = useLocation();
  const [acc, setAcc] = useState({ id: accountId ? String(accountId) : "", name: accountName ?? "" });
  const [localErr, setLocalErr] = useState("");
  return (
    <FormModal open={open} onClose={onClose} title="New opportunity" fields={OPP_FIELDS} initial={{ amount: "" }} submitLabel="Create" success="Opportunity created" invalidate={["/opportunities", "/pipeline", "/dashboard"]}
      extra={<>{!accountId && <Field label="Account" required><AccountPicker value={acc.id} initialName={acc.name} onChange={(id, name) => { setAcc({ id, name }); setLocalErr(""); }} /></Field>}{localErr && <p role="alert" className="text-xs text-rose-500">{localErr}</p>}</>}
      submit={async (b) => { if (!acc.id) { setLocalErr("Choose an account"); throw new Error("Choose an account"); } return sales.post("/opportunities", { ...b, account_id: Number(acc.id) }, { idempotent: true }); }}
      onDone={(r) => nav(`/sales/opportunities/${(r as { id: number }).id}`)} />
  );
}

export default function PipelinePage() {
  const { can } = useSales();
  const [tab, setTab] = useUrlFilter("view", "board");
  const [pipelineId, setPipelineId] = useUrlFilter("pipeline_id");
  const [creating, setCreating] = useState(false);
  const pipes = useSalesQuery<Pipelines>("/pipelines");
  return (
    <>
      <PageHeader title="Opportunities & pipeline" description="Drag a card to move it between stages (or use the Move menu). Stages can require fields before a deal advances; closing as lost needs a reason."
        actions={<>{pipes.data && pipes.data.items.length > 1 && <Select aria-label="Pipeline" className="w-44" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}><option value="">Default pipeline</option>{pipes.data.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}{can("opportunities:write") && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New opportunity</Button>}</>} />
      <TabBar tabs={[{ key: "board", label: "Board" }, { key: "list", label: "List" }, { key: "analytics", label: "Funnel & conversion" }]} value={tab === "list" || tab === "analytics" ? tab : "board"} onChange={setTab} />
      {tab === "list" ? <ListView pipelineId={pipelineId} /> : tab === "analytics" ? <AnalyticsView pipelineId={pipelineId} /> : <BoardView pipelineId={pipelineId} />}
      <OpportunityFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function BoardView({ pipelineId }: { pipelineId: string }) {
  const { can } = useSales();
  const [, nav] = useLocation();
  const [owner, setOwner] = useUrlFilter("owner_id");
  const [q, setQ] = useUrlFilter("q");
  const board = useSalesQuery<Board>("/pipeline/board", { pipeline_id: pipelineId || undefined, owner_id: owner || undefined, q: q || undefined }, { keepPrevious: true });
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [lost, setLost] = useState<{ opp: OppRow; stage: Stage } | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const lastOpp = useRef<number>(0);
  const move = useSalesMutation((p: { opp: OppRow; stage: Stage; lost_reason?: string }) => { lastOpp.current = p.opp.id; return sales.post(`/opportunities/${p.opp.id}/move`, { stage_id: p.stage.id, lost_reason: p.lost_reason }); }, {
    invalidate: ["/pipeline", "/opportunities", "/dashboard"], silentError: true, onError: (e: SalesApiError) => { setNotice({ text: e.message, id: lastOpp.current }); setLost(null); },
  });
  async function doMove(opp: OppRow, stage: Stage, lostReason?: string) {
    setNotice(null);
    if (opp.stage_id === stage.id) return;
    if (stage.kind === "lost" && !lostReason) { setReason(""); setLost({ opp, stage }); return; }
    const r = await move.run({ opp, stage, lost_reason: lostReason });
    if (r !== undefined) setLost(null);
  }
  const cols = board.data?.columns ?? [];
  return (
    <>
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="Search deals or accounts…" />
        <OwnerSelect value={owner} onChange={setOwner} />
      </FilterBar>
      {notice && <p role="alert" className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{notice.text} <Link className="text-primary hover:underline" href={`/sales/opportunities/${notice.id}`}>Open the deal to complete the missing details</Link></p>}
      {board.error && !board.data ? <ErrorState error={board.error} onRetry={() => void board.refetch()} /> : !board.data ? <Skeleton rows={8} /> : cols.every((c) => c.count === 0) && cols.length > 0 ? (
        <Panel><EmptyState title="No opportunities yet" description="Convert a qualified lead or create an opportunity to start building the pipeline." /></Panel>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="Pipeline board">
          {cols.map((c) => (
            <section key={c.stage.id} role="listitem" aria-label={c.stage.name}
              onDragOver={(e) => { if (drag !== null && can("opportunities:write")) { e.preventDefault(); setOver(c.stage.id); } }} onDragLeave={() => setOver((o) => (o === c.stage.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const opp = cols.flatMap((x) => x.cards).find((x) => x.id === drag); setDrag(null); if (opp) void doMove(opp, c.stage); }}
              className={cn("w-72 shrink-0 rounded-xl border bg-card/60 p-2 transition-colors", over === c.stage.id && "border-primary bg-primary/5")}>
              <header className="mb-2 px-1">
                <div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-semibold">{c.stage.name}</h3><span className="text-xs text-muted-foreground">{c.count}</span></div>
                <p className="text-xs text-muted-foreground">{moneyCompact(c.amount)}{c.stage.kind === "open" ? ` · ${moneyCompact(c.weighted)} weighted · ${num(Number(c.stage.probability))}%` : ""}</p>
              </header>
              <div className="space-y-2">
                {c.cards.map((o) => (
                  <article key={o.id} draggable={can("opportunities:write")} onDragStart={() => setDrag(o.id)} onDragEnd={() => { setDrag(null); setOver(null); }} className={cn("rounded-lg border bg-background p-2.5 text-sm shadow-sm", drag === o.id && "opacity-50")}>
                    <button className="block w-full text-left" onClick={() => nav(`/sales/opportunities/${o.id}`)}>
                      <p className="truncate font-medium">{o.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{o.account_name}</p>
                    </button>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs"><span className="font-medium tabular-nums">{money(o.amount, o.currency)}</span><span className="text-muted-foreground">{o.expected_close_date ? dateOnly(o.expected_close_date) : "No close date"}</span></div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">{o.stalled && <Tag>Stalled</Tag>}{o.overdue && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] text-rose-500">Overdue</span>}<span className="text-[11px] text-muted-foreground">{o.owner_name}</span></div>
                    {can("opportunities:write") && (
                      <select aria-label={`Move ${o.name}`} className="mt-2 w-full rounded border bg-background px-1.5 py-1 text-xs" value={o.stage_id} onChange={(e) => { const st = cols.find((x) => x.stage.id === Number(e.target.value))?.stage; if (st) void doMove(o, st); }}>
                        {cols.map((x) => <option key={x.stage.id} value={x.stage.id}>{x.stage.name}</option>)}
                      </select>
                    )}
                  </article>
                ))}
                {c.cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</p>}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!lost} onClose={() => setLost(null)} title="Mark as lost" size="sm" description={lost?.opp.name} footer={<><Button variant="outline" onClick={() => setLost(null)}>Cancel</Button><Button variant="destructive" disabled={reason.trim().length < 3 || move.pending} onClick={() => lost && void doMove(lost.opp, lost.stage, reason.trim())}>Mark lost</Button></>}>
        <Field label="Why was it lost?" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

function ListView({ pipelineId }: { pipelineId: string }) {
  const [, nav] = useLocation();
  const st = useListState(["status", "forecast_category", "owner_id", "stalled", "overdue", "stage_id"]);
  const q = useList<OppRow, { totals: { amount: string; weighted: string } }>("/opportunities", st, { pipeline_id: pipelineId || undefined });
  const columns: Column<OppRow>[] = [
    { key: "name", header: "Opportunity", sort: "name", render: (o) => <div className="min-w-0"><p className="truncate font-medium">{o.name}</p><p className="truncate text-xs text-muted-foreground">{o.number} · {o.account_name}</p></div> },
    { key: "stage", header: "Stage", sort: "stage", render: (o) => <div className="flex flex-wrap gap-1"><span>{o.stage_name}</span>{o.stalled && <Tag>Stalled</Tag>}</div> },
    { key: "amount", header: "Amount", sort: "amount", align: "right", render: (o) => money(o.amount, o.currency) },
    { key: "prob", header: "Prob.", align: "right", hideOnMobile: true, render: (o) => percent(Number(o.probability), 0) },
    { key: "close", header: "Close", sort: "close", hideOnMobile: true, render: (o) => <span className={o.overdue ? "text-rose-500" : ""}>{o.expected_close_date ? dateOnly(o.expected_close_date) : "—"}</span> },
    { key: "owner", header: "Owner", hideOnMobile: true, render: (o) => o.owner_name ?? "—" },
    { key: "status", header: "Status", render: (o) => <StatusBadge status={o.status} /> },
  ];
  return (
    <>
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search name, number, account…" />
        <Select aria-label="Status" className="w-32" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{OPP_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <Select aria-label="Forecast category" className="w-44" value={st.filters.forecast_category ?? ""} onChange={(e) => st.setFilter("forecast_category", e.target.value)}><option value="">Forecast: all</option>{FORECAST_CATEGORIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <OwnerSelect value={st.filters.owner_id ?? ""} onChange={(v) => st.setFilter("owner_id", v)} />
        <Checkbox className="mb-0" label="Stalled" checked={st.filters.stalled === "true"} onChange={(e) => st.setFilter("stalled", e.target.checked ? "true" : "")} />
        <Checkbox className="mb-0" label="Past close date" checked={st.filters.overdue === "true"} onChange={(e) => st.setFilter("overdue", e.target.checked ? "true" : "")} />
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <>
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">Filtered total {money(q.data.totals.amount)} · weighted {money(q.data.totals.weighted)}</p>
            <DataTable caption="Opportunities" columns={columns} rows={q.data.items} rowKey={(o) => o.id} sort={st.sort} onSort={st.setSort} onRowClick={(o) => nav(`/sales/opportunities/${o.id}`)} empty={<EmptyState title="No opportunities match" />} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} />
          </>
        )}
      </Panel>
    </>
  );
}

function AnalyticsView({ pipelineId }: { pipelineId: string }) {
  const q = useSalesQuery<{ funnel: { stage_id: number; name: string; reached: number; conversionFromPrevious: number | null; openNow: number; avgDaysInStage: number }[]; won: number; lost: number; winRate: number | null; openAmount: string; weightedAmount: string; definitions: { weighted: string } }>("/pipeline/analytics", { pipeline_id: pipelineId || undefined });
  return (
    <QueryBoundary q={q}>
      {(d) => (
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Stage funnel" description="Deals that ever reached each stage" className="lg:col-span-2"><Funnel stages={d.funnel.map((f) => ({ label: f.name, value: f.reached, sub: f.conversionFromPrevious == null ? undefined : `${percent(f.conversionFromPrevious)} from previous` }))} /></Panel>
          <Panel title="Summary">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Open pipeline</dt><dd className="tabular-nums">{money(d.openAmount)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Weighted</dt><dd className="tabular-nums">{money(d.weightedAmount)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Won / lost</dt><dd>{d.won} / {d.lost}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Win rate</dt><dd>{d.winRate == null ? "— (no closed deals)" : percent(d.winRate)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{d.definitions.weighted}</p>
          </Panel>
          <Panel title="Average days in stage" className="lg:col-span-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{d.funnel.map((f) => <div key={f.stage_id} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{f.name}</p><p className="text-lg font-semibold tabular-nums">{f.avgDaysInStage}d</p><p className="text-xs text-muted-foreground">{f.openNow} open now</p></div>)}</div>
          </Panel>
        </div>
      )}
    </QueryBoundary>
  );
}
