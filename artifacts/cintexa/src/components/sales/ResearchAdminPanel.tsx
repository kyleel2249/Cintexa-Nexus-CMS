import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, KpiCard, StatusBadge, DataTable, Tag, EmptyState } from "./ui";
import { Term } from "./Hint";
import { dateTime } from "@/lib/sales/format";
import { researchApi, TERMINAL, type JobRow, type ResearchStatus } from "@/lib/sales/research-api";

/** Read-only view of web research: what is configured, the limits in force and every recent job (including failures). Settings themselves are server environment variables. */
export function ResearchAdminPanel() {
  const [st, setSt] = useState<ResearchStatus | null>(null);
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    try { const [a, b] = await Promise.all([researchApi.status(), researchApi.list()]); setSt(a); setRows(b.items); }
    catch (e: any) { setErr(e?.message ?? "Web research is not reachable"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const failed = rows?.filter((r) => r.status === "failed").length ?? 0;
  return (
    <Panel title="Web research & AI Autofill" description="Public-web research used by the AI Autofill panel on lead, account, contact and competitor forms." actions={<Button type="button" size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>}>
      {err && <p role="alert" className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-600">{err} Web research runs on the API server; it is not available when only the on-device runtime is reachable.</p>}
      {st && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Switched on" value={st.enabled ? "Yes" : "No"} tone={st.enabled ? "success" : "warning"} />
            <KpiCard label="Search provider" value={st.searchProviders.length ? String(st.searchProviders.length) : "None"} tone={st.searchProviders.length ? "success" : "warning"} />
            <KpiCard label="Per member per hour" value={String(st.limits.perMemberPerHour)} />
            <KpiCard label="Cache (hours)" value={String(st.limits.cacheHours)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground"><Term term="Search provider">Search providers</Term>:</span>
            {st.searchProviders.length ? st.searchProviders.map((p) => <Tag key={p.id}>{p.label}</Tag>) : <span className="text-muted-foreground">none configured</span>}
          </div>
          <p className="text-xs text-muted-foreground">Up to {st.limits.maxPages} public pages are read per company. {st.setup ?? "Companies can be found from their name as well as their website."} Change these with the server variables listed in docs/sales-management/AI_RESEARCH.md; keys are never shown here.</p>
        </div>
      )}
      <div className="mt-4">
        <p className="mb-2 text-sm font-medium">Recent research {failed > 0 && <span className="text-xs font-normal text-rose-500">({failed} failed)</span>}</p>
        {rows === null ? (err ? null : <p className="text-xs text-muted-foreground">Loading…</p>) : rows.length === 0 ? <EmptyState title="No research yet" description="Open a lead or account form and use AI Autofill." /> : (
          <DataTable<JobRow> rows={rows} rowKey={(r) => r.id} caption="Recent web research jobs" columns={[
            { key: "c", header: "Company", render: (r) => <div><p className="font-medium">{r.input.companyName || r.input.website || "—"}</p><p className="text-xs text-muted-foreground">{r.input.website}</p></div> },
            { key: "s", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "p", header: "Pages", hideOnMobile: true, render: (r) => r.pages_fetched },
            { key: "e", header: "Detail", hideOnMobile: true, render: (r) => <span className="text-xs text-muted-foreground">{TERMINAL.includes(r.status) ? r.error ?? r.stage_detail ?? "" : `${r.progress}% – ${r.stage_detail ?? ""}`}</span> },
            { key: "b", header: "By", hideOnMobile: true, render: (r) => r.created_by ?? "—" },
            { key: "w", header: "When", render: (r) => dateTime(r.created_at) },
          ]} />
        )}
      </div>
    </Panel>
  );
}
