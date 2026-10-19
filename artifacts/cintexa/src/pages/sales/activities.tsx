import { useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { ACTIVITY_TYPES } from "@/lib/sales/enums";
import { dateTime } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, ErrorState, Skeleton, EmptyState, Checkbox, IconButton, type Column } from "@/components/sales/ui";
import { ActivityFormModal, ActivityActions, type ActivityRow } from "@/components/sales/activity";
import { OwnerSelect } from "@/components/sales/pickers";
import { cn } from "@/lib/utils";

type View = "agenda" | "list" | "calendar";
interface Agenda { today: string; overdue: ActivityRow[]; today_items: ActivityRow[]; upcoming: ActivityRow[]; undated: ActivityRow[] }

export default function ActivitiesPage() {
  const { can } = useSales();
  const [view, setView] = useUrlFilter("view", "agenda");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Activities & follow-ups" description="Calls, meetings, tasks and reminders. Overdue items stay visible until you complete, snooze or cancel them." actions={can("activities:write") ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New activity</Button> : undefined} />
      <TabBar<View> tabs={[{ key: "agenda", label: "My agenda" }, { key: "list", label: "All activities" }, { key: "calendar", label: "Calendar" }]} value={(["agenda", "list", "calendar"].includes(view) ? view : "agenda") as View} onChange={setView} />
      {view === "list" ? <ListView /> : view === "calendar" ? <CalendarView /> : <AgendaView />}
      <ActivityFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function AgendaView() {
  const q = useSalesQuery<Agenda>("/activities/agenda");
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton rows={6} />;
  const groups: [string, ActivityRow[], boolean][] = [["Overdue", q.data.overdue, true], ["Today", q.data.today_items, false], ["Next 7 days", q.data.upcoming, false], ["No due date", q.data.undated, false]];
  if (groups.every(([, g]) => g.length === 0)) return <Panel><EmptyState title="You're all caught up" description="No open activities assigned to you." /></Panel>;
  return (
    <div className="space-y-4">
      {groups.filter(([, g]) => g.length > 0).map(([title, items, late]) => (
        <Panel key={title} title={`${title} (${items.length})`}>
          <ul className="divide-y">
            {items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{a.subject}</p><p className="text-xs text-muted-foreground">{a.type.replace(/_/g, " ")}{a.related_name ? ` · ${a.related_name}` : ""} · {a.due_at ? dateTime(a.due_at) : "no due date"}</p></div>
                <div className="flex shrink-0 items-center gap-2">{late && <StatusBadge status="missed" label="Overdue" />}<ActivityActions a={a} /></div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function ListView() {
  const st = useListState(["status", "type", "owner_id", "overdue"]);
  const q = useList<ActivityRow>("/activities", st);
  const columns: Column<ActivityRow>[] = [
    { key: "subject", header: "Activity", render: (a) => <div className="min-w-0"><p className="truncate font-medium">{a.subject}</p><p className="text-xs text-muted-foreground">{a.related_name ?? "—"}</p></div> },
    { key: "type", header: "Type", hideOnMobile: true, render: (a) => a.type.replace(/_/g, " ") },
    { key: "due", header: "Due", sort: "due", render: (a) => <span className={a.overdue ? "text-rose-500" : ""}>{a.due_at ? dateTime(a.due_at) : "—"}</span> },
    { key: "priority", header: "Priority", sort: "priority", hideOnMobile: true, render: (a) => <StatusBadge status={a.priority} /> },
    { key: "owner", header: "Owner", hideOnMobile: true, render: (a) => a.owner_name ?? "—" },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "act", header: "", render: (a) => <ActivityActions a={a} /> },
  ];
  return (
    <>
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search subject or details…" />
        <Select aria-label="Status" className="w-36" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{["open", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select aria-label="Type" className="w-36" value={st.filters.type ?? ""} onChange={(e) => st.setFilter("type", e.target.value)}><option value="">Type: all</option>{ACTIVITY_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <OwnerSelect value={st.filters.owner_id ?? ""} onChange={(v) => st.setFilter("owner_id", v)} />
        <Checkbox className="mb-0" label="Overdue only" checked={st.filters.overdue === "true"} onChange={(e) => st.setFilter("overdue", e.target.checked ? "true" : "")} />
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Activities" columns={columns} rows={q.data.items} rowKey={(a) => a.id} sort={st.sort} onSort={st.setSort} empty={<EmptyState title="No activities found" />} /><Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
    </>
  );
}

function CalendarView() {
  const { me } = useSales();
  const weekStart = me?.business.weekStartsOn ?? 1;
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const days = useMemo(() => {
    const first = new Date(anchor);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [anchor, weekStart]);
  const from = days[0]!.toISOString();
  const to = new Date(days[41]!.getFullYear(), days[41]!.getMonth(), days[41]!.getDate() + 1).toISOString();
  const q = useSalesQuery<{ items: ActivityRow[] }>("/activities/calendar", { from, to });
  const byDay = useMemo(() => {
    const m = new Map<string, ActivityRow[]>();
    for (const a of q.data?.items ?? []) {
      const t = a.start_at ?? a.due_at;
      if (!t) continue;
      const d = new Date(t);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [q.data]);
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((i + weekStart) % 7)).toLocaleDateString(undefined, { weekday: "short" }));
  return (
    <Panel title={anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })} actions={<><IconButton label="Previous month" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></IconButton><IconButton label="Next month" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></IconButton></>}>
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {names.map((n) => <div key={n} className="bg-secondary px-2 py-1 text-center font-medium">{n}</div>)}
        {days.map((d) => {
          const items = byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];
          const other = d.getMonth() !== anchor.getMonth();
          return (
            <div key={d.toISOString()} className={cn("min-h-[5.5rem] bg-card p-1", other && "opacity-50")}>
              <p className="text-right text-[11px] text-muted-foreground">{d.getDate()}</p>
              {items.slice(0, 3).map((a) => <p key={a.id} title={`${a.subject} — ${a.status}`} className={cn("mb-0.5 truncate rounded px-1 py-0.5", a.status === "done" ? "bg-emerald-500/15 line-through" : a.overdue ? "bg-rose-500/15" : "bg-primary/15")}>{a.subject}</p>)}
              {items.length > 3 && <p className="text-[10px] text-muted-foreground">+{items.length - 3} more</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Shows activities you are allowed to see. Calendar sync with Google/Outlook is not connected.</p>
    </Panel>
  );
}
