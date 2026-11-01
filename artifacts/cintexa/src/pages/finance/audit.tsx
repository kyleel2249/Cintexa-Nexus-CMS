import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, EmptyState, QueryBoundary, Pagination, Select, FilterBar, Modal } from "@/components/sales/ui";
import { fin } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";

interface Ev { id: number; seq: number; at: string; actor_label: string | null; action: string; entity_type: string; entity_id: string | null; summary: string | null; before: unknown; after: unknown; request_id: string | null; hash: string }
const PAGE = 50;

export default function AuditPage() {
  const [page, setPage] = useState(1); const [entity, setEntity] = useState(""); const [sel, setSel] = useState<Ev | null>(null);
  const q = useFinanceQuery<{ items: Ev[]; total: number }>("/audit", { entity_type: entity, limit: PAGE, offset: (page - 1) * PAGE });
  const [result, setResult] = useState<{ ok: boolean; checked: number; brokenAtSeq?: number } | null>(null);
  const verify = useFinanceMutation(() => fin.get<{ ok: boolean; checked: number; brokenAtSeq?: number }>("/audit/verify"), { onSuccess: (r) => setResult(r) });
  return (
    <>
      <PageHeader title="Audit trail" description="Every sensitive action is recorded with who, what, when and the before/after values. Events are chained by hash and cannot be edited or deleted."
        actions={<Button size="sm" variant="outline" disabled={verify.pending} onClick={() => void verify.run()}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{verify.pending ? "Verifying…" : "Verify integrity"}</Button>} />
      {result && <div role="status" className={`mb-3 rounded-md border px-3 py-2 text-sm ${result.ok ? "border-emerald-500/40 text-emerald-500" : "border-rose-500/40 font-semibold text-rose-500"}`}>{result.ok ? `Audit chain verified: ${result.checked} events, no tampering detected.` : `INTEGRITY FAILURE at event #${result.brokenAtSeq}. Preserve the database and investigate immediately.`}</div>}
      <FilterBar><Select aria-label="Entity" className="w-48" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All records</option>{["organisation", "member", "account", "journal", "period", "fiscal_year"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</Select></FilterBar>
      <Panel flush><QueryBoundary q={q}>{(d) => (<>
        <DataTable caption="Audit events" rows={d.items} rowKey={(e) => e.id} onRowClick={(e) => setSel(e)} empty={<EmptyState title="No events" />} columns={[
          { key: "s", header: "#", render: (e: Ev) => e.seq }, { key: "t", header: "When", render: (e: Ev) => new Date(e.at).toLocaleString() }, { key: "a", header: "Actor", hideOnMobile: true, render: (e: Ev) => e.actor_label ?? "system" },
          { key: "x", header: "Action", render: (e: Ev) => <span className="font-mono text-xs">{e.action}</span> }, { key: "m", header: "Summary", render: (e: Ev) => e.summary ?? `${e.entity_type} ${e.entity_id ?? ""}` },
        ]} />
        <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
      </>)}</QueryBoundary></Panel>
      <Modal open={sel !== null} onClose={() => setSel(null)} size="lg" title={sel ? `Event #${sel.seq}: ${sel.action}` : ""} description={sel ? `${sel.actor_label ?? "system"} · ${new Date(sel.at).toLocaleString()}` : undefined}>
        {sel && <div className="space-y-3 text-xs"><p className="text-sm">{sel.summary}</p><p className="break-all text-muted-foreground">Request {sel.request_id ?? "—"} · hash {sel.hash}</p>
          {sel.before != null && <><p className="font-medium">Before</p><pre className="max-h-60 overflow-auto rounded bg-secondary p-2">{JSON.stringify(sel.before, null, 2)}</pre></>}
          {sel.after != null && <><p className="font-medium">After</p><pre className="max-h-60 overflow-auto rounded bg-secondary p-2">{JSON.stringify(sel.after, null, 2)}</pre></>}</div>}
      </Modal>
    </>
  );
}
