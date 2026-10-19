import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlParams } from "@/lib/sales/hooks";
import { PERIODS } from "@/lib/sales/enums";
import { dateTime, titleCase } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, Select, Input, Field, DataTable, EmptyState, ErrorState, Skeleton, StatusBadge, Modal, Checkbox, type Column } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";
import { ExportButton } from "@/components/sales/actions";

interface Catalogue { items: { key: string; title: string; description: string; columns: string[] }[]; canExport: boolean }
interface Report { key: string; title: string; description: string; range: { from: string; to: string; label: string }; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean; currency: string }
interface View { id: number; name: string; filters: Record<string, string>; shared: boolean; mine: boolean }
type Tab = "reports" | "schedules";

export default function ReportsPage() {
  const { can } = useSales();
  const [params, setParams] = useUrlParams();
  const tab: Tab = params.get("tab") === "schedules" && can("reports:schedule") ? "schedules" : "reports";
  const tabs: { key: Tab; label: string }[] = [{ key: "reports", label: "Reports" }, ...(can("reports:schedule") ? [{ key: "schedules" as Tab, label: "Schedules" }] : [])];
  return (
    <>
      <PageHeader title="Sales reports & analytics" description="Every report runs against live data, honours your role scope, and exports exactly what is shown." />
      {tabs.length > 1 && <TabBar<Tab> tabs={tabs} value={tab} onChange={(k) => setParams({ tab: k === "reports" ? null : k })} />}
      {tab === "schedules" ? <Schedules /> : <Reports />}
    </>
  );
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Number(s); return Number.isFinite(n) && s.length < 16 ? n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: s.includes(".") ? Math.min(2, s.split(".")[1]!.length) : 0 }) : s; }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return dateTime(s);
  return s;
}

function Reports() {
  const [params, setParams] = useUrlParams();
  const cat = useSalesQuery<Catalogue>("/reports");
  const key = params.get("report") ?? cat.data?.items[0]?.key ?? "";
  const period = params.get("period") ?? "month";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const custom = !!(from && to);
  const query = custom ? { from, to } : { period };
  const rep = useSalesQuery<Report>(key ? `/reports/${key}` : null, query);
  const views = useSalesQuery<{ items: View[] }>("/saved-views", { scope: "reports" });
  const [saving, setSaving] = useState(false);
  const del = useSalesMutation((id: number) => sales.del(`/saved-views/${id}`), { invalidate: ["/saved-views"], success: "View deleted" });
  const { can, me } = useSales();
  const managerial = me ? me.scope !== "own" : false;
  if (cat.error && !cat.data) return <ErrorState error={cat.error} onRetry={() => void cat.refetch()} />;
  if (!cat.data) return <Skeleton rows={6} />;
  if (cat.data.items.length === 0) return <EmptyState title="No reports available to your role" />;
  const columns: Column<Record<string, unknown>>[] = (rep.data?.columns ?? []).map((c, i) => ({ key: c, header: titleCase(c), hideOnMobile: i > 3, align: rep.data!.rows.some((r) => typeof r[c] === "number" || /^-?\d+(\.\d+)?$/.test(String(r[c] ?? ""))) && i > 0 ? "right" as const : undefined, render: (r: Record<string, unknown>) => cell(r[c]) }));
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Reports" className="space-y-1">
        {cat.data.items.map((r) => <button key={r.key} type="button" onClick={() => setParams({ report: r.key })} className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${r.key === key ? "bg-primary/10 font-medium text-primary" : "hover:bg-secondary"}`} aria-current={r.key === key ? "page" : undefined}>{r.title}</button>)}
        {(views.data?.items.length ?? 0) > 0 && <div className="pt-4"><p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved views</p>
          {views.data!.items.map((v) => <div key={v.id} className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm hover:bg-secondary"><button type="button" className="flex-1 text-left" onClick={() => setParams({ report: v.filters.report ?? key, period: v.filters.period ?? null, from: v.filters.from ?? null, to: v.filters.to ?? null })}>{v.name}{v.shared && <span className="ml-1 text-xs text-muted-foreground">(shared)</span>}</button>{v.mine && <button type="button" aria-label={`Delete view ${v.name}`} className="text-xs text-rose-500" onClick={() => void del.run(v.id)}>✕</button>}</div>)}</div>}
      </nav>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Period"><Select value={custom ? "custom" : period} onChange={(e) => e.target.value === "custom" ? setParams({ from: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }) : setParams({ period: e.target.value, from: null, to: null })}>{PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}<option value="custom">Custom range…</option></Select></Field>
          {custom && <><Field label="From"><Input type="date" value={from} onChange={(e) => setParams({ from: e.target.value })} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setParams({ to: e.target.value })} /></Field></>}
          <div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => setSaving(true)}>Save view</Button>{cat.data.canExport && key && <ExportButton path={`/reports/${key}`} query={{ ...query, format: "csv" }} />}</div>
        </div>
        <Panel title={rep.data?.title} description={rep.data ? `${rep.data.description} · ${rep.data.range.label}` : undefined} flush>
          {rep.error && !rep.data ? <ErrorState error={rep.error} onRetry={() => void rep.refetch()} /> : !rep.data ? <Skeleton rows={8} /> : (
            <>
              <DataTable caption={rep.data.title} columns={columns} rows={rep.data.rows.map((r, i) => ({ ...r, __i: i }))} rowKey={(r) => String(r.__i)} empty={<EmptyState title="No rows for this period" description="Try a wider period." />} />
              {rep.data.truncated && <p className="px-4 py-2 text-xs text-amber-500">Showing the first 5,000 rows. Narrow the period to see everything.</p>}
              <p className="px-4 py-2 text-xs text-muted-foreground">{rep.data.rows.length.toLocaleString()} rows · amounts in {rep.data.currency}</p>
            </>
          )}
        </Panel>
      </div>
      {saving && <SaveView filters={{ report: key, ...(custom ? { from, to } : { period }) }} sharable={managerial && can("reports:read")} onClose={() => setSaving(false)} />}
    </div>
  );
}

function SaveView({ filters, sharable, onClose }: { filters: Record<string, string>; sharable: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const save = useSalesMutation(() => sales.post("/saved-views", { scope: "reports", name: name.trim(), filters, shared }), { invalidate: ["/saved-views"], success: "View saved", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Save view" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={name.trim().length < 2 || save.pending} onClick={() => void save.run()}>Save</Button></>}>
      <Field label="Name" required><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
      {sharable && <Checkbox label="Share with my team" checked={shared} onChange={(e) => setShared(e.target.checked)} />}
      {save.error && <p role="alert" className="mt-2 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}

interface Schedule { id: number; report: string; params: { period?: string }; cadence: string; recipients: string[]; format: string; active: boolean; next_run_at: string | null; last_run_at: string | null }

function Schedules() {
  const q = useSalesQuery<{ items: Schedule[]; delivery: string; note?: string }>("/report-schedules");
  const cat = useSalesQuery<Catalogue>("/reports");
  const [creating, setCreating] = useState(false);
  const del = useSalesMutation((id: number) => sales.del(`/report-schedules/${id}`), { invalidate: ["/report-schedules"], success: "Schedule deleted" });
  return (
    <>
      {q.data?.note && <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{q.data.note}</p>}
      <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New schedule</Button></div>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Report schedules" rows={q.data.items} rowKey={(s) => s.id} empty={<EmptyState title="No schedules" description="Schedule a report to be emailed daily, weekly or monthly once email is connected." />}
            columns={[{ key: "r", header: "Report", render: (s: Schedule) => cat.data?.items.find((r) => r.key === s.report)?.title ?? s.report }, { key: "c", header: "Cadence", render: (s: Schedule) => `${titleCase(s.cadence)} · ${s.format.toUpperCase()}` },
              { key: "t", header: "Recipients", hideOnMobile: true, render: (s: Schedule) => s.recipients.join(", ") }, { key: "n", header: "Next run", hideOnMobile: true, render: (s: Schedule) => (s.next_run_at ? dateTime(s.next_run_at) : "—") },
              { key: "a", header: "Delivery", render: () => <StatusBadge status={q.data!.delivery === "email" ? "active" : "pending"} label={q.data!.delivery === "email" ? "Email" : "Not connected"} /> },
              { key: "x", header: "", render: (s: Schedule) => <Button size="sm" variant="ghost" className="text-rose-500" disabled={del.pending} onClick={() => void del.run(s.id)}>Delete</Button> }]} />
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New report schedule" success="Schedule saved" invalidate={["/report-schedules"]} initial={{ cadence: "weekly", period: "last_month", format: "csv" }}
        fields={[{ name: "report", label: "Report", type: "select", required: true, options: (cat.data?.items ?? []).map((r) => ({ value: r.key, label: r.title })), wide: true }, { name: "period", label: "Period", type: "select", options: PERIODS, required: true }, { name: "cadence", label: "Cadence", type: "select", required: true, options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] }, { name: "format", label: "Format", type: "select", required: true, options: [{ value: "csv", label: "CSV" }, { value: "html", label: "HTML" }] }, { name: "recipients", label: "Recipients (emails)", type: "tags", required: true, wide: true }]}
        submit={(b) => sales.post("/report-schedules", b)} />
    </>
  );
}
