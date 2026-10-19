import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Plus, Upload, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { LEAD_SOURCES, LEAD_STATUSES, PRIORITIES } from "@/lib/sales/enums";
import { dateOnly, money } from "@/lib/sales/format";
import { PageHeader, Panel, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, TabBar, Modal, Field, Input, Textarea, Checkbox, type Column } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { ExportButton } from "@/components/sales/actions";
import { OwnerSelect } from "@/components/sales/pickers";

export interface LeadRow {
  id: number; number: string; first_name: string; last_name: string | null; email: string | null; phone: string | null; company: string | null; source: string; status: string; priority: string;
  score: number; owner_id: number | null; owner_name: string | null; estimated_value: string | null; next_follow_up_at: string | null; created_at: string; overdue: boolean; awaiting_first_response: boolean;
}

export const LEAD_FIELDS: FieldDef[] = [
  { name: "first_name", label: "First name", required: true },
  { name: "last_name", label: "Last name" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel", hint: "Email or phone is required" },
  { name: "company", label: "Company" },
  { name: "job_title", label: "Job title" },
  { name: "source", label: "Source", type: "select", options: LEAD_SOURCES, required: true },
  { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true },
  { name: "estimated_value", label: "Estimated value", type: "money" },
  { name: "budget", label: "Budget", type: "money" },
  { name: "industry", label: "Industry" },
  { name: "country", label: "Country" },
  { name: "product_interest", label: "Product interest", wide: true },
  { name: "consent_email", label: "Contact consented to email", type: "checkbox" },
  { name: "consent_whatsapp", label: "Contact consented to WhatsApp", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export default function LeadsPage() {
  const { can } = useSales();
  const [, nav] = useLocation();
  const st = useListState(["status", "priority", "source", "owner_id", "overdue", "unassigned"]);
  const q = useList<LeadRow, { byStatus: Record<string, number> }>("/leads", st);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [forms, setForms] = useState(false);
  const total = Object.values(q.data?.byStatus ?? {}).reduce((a, b) => a + b, 0);

  const columns: Column<LeadRow>[] = [
    { key: "name", header: "Lead", sort: "name", render: (r) => (
      <div className="min-w-0"><p className="truncate font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ")}</p><p className="truncate text-xs text-muted-foreground">{r.company ?? r.email ?? r.phone ?? r.number}</p></div>
    ) },
    { key: "status", header: "Status", sort: "status", render: (r) => <div className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.awaiting_first_response && <Tag>No response yet</Tag>}</div> },
    { key: "score", header: "Score", sort: "score", align: "right", render: (r) => r.score },
    { key: "priority", header: "Priority", hideOnMobile: true, render: (r) => <StatusBadge status={r.priority} /> },
    { key: "source", header: "Source", hideOnMobile: true, render: (r) => <span className="text-muted-foreground">{LEAD_SOURCES.find((s) => s.value === r.source)?.label ?? r.source}</span> },
    { key: "owner", header: "Owner", hideOnMobile: true, render: (r) => r.owner_name ?? <Tag>Unassigned</Tag> },
    { key: "value", header: "Est. value", sort: "value", align: "right", hideOnMobile: true, render: (r) => (r.estimated_value ? money(r.estimated_value) : "—") },
    { key: "followup", header: "Follow-up", sort: "followup", hideOnMobile: true, render: (r) => <span className={r.overdue ? "text-rose-500" : "text-muted-foreground"}>{r.next_follow_up_at ? dateOnly(r.next_follow_up_at) : "—"}{r.overdue ? " · overdue" : ""}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        description="Capture, qualify and convert prospects. Duplicates are caught before they are saved; conversion creates the account, contact and opportunity in one step."
        actions={
          <>
            {can("leads:export") && <ExportButton path="/leads/export.csv" query={{ ...st.filters, q: st.q || undefined }} />}
            {can("leads:import") && <Button variant="outline" size="sm" onClick={() => setImporting(true)}><Upload className="mr-1.5 h-3.5 w-3.5" />Import</Button>}
            {can("leads:import") && <Button variant="outline" size="sm" onClick={() => setForms(true)}><Link2 className="mr-1.5 h-3.5 w-3.5" />Web forms</Button>}
            {can("leads:write") && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New lead</Button>}
          </>
        }
      />
      <TabBar tabs={[{ key: "", label: "All", count: q.data ? total : undefined }, ...LEAD_STATUSES.map((s) => ({ key: s.value, label: s.label, count: q.data?.byStatus?.[s.value] ?? 0 }))]} value={st.filters.status ?? ""} onChange={(k) => st.setFilter("status", k)} />
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search name, company, email, phone…" />
        <Select aria-label="Priority" className="w-36" value={st.filters.priority ?? ""} onChange={(e) => st.setFilter("priority", e.target.value)}><option value="">Priority: all</option>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
        <Select aria-label="Source" className="w-40" value={st.filters.source ?? ""} onChange={(e) => st.setFilter("source", e.target.value)}><option value="">Source: all</option>{LEAD_SOURCES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
        <OwnerSelect value={st.filters.owner_id ?? ""} onChange={(v) => st.setFilter("owner_id", v)} />
        <Checkbox className="mb-0" label="Overdue follow-up" checked={st.filters.overdue === "true"} onChange={(e) => st.setFilter("overdue", e.target.checked ? "true" : "")} />
        <Checkbox className="mb-0" label="Unassigned" checked={st.filters.unassigned === "true"} onChange={(e) => st.setFilter("unassigned", e.target.checked ? "true" : "")} />
        {st.hasFilters && <Button variant="ghost" size="sm" onClick={st.clear}>Clear</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <>
            <DataTable
              caption="Leads" columns={columns} rows={q.data.items} rowKey={(r) => r.id} onRowClick={(r) => nav(`/sales/leads/${r.id}`)} sort={st.sort} onSort={st.setSort}
              empty={<EmptyState title={st.hasFilters ? "No leads match these filters" : "No leads yet"} description={st.hasFilters ? "Try clearing a filter." : "Add your first lead, import a CSV, or publish a web form."} action={st.hasFilters ? <Button variant="outline" size="sm" onClick={st.clear}>Clear filters</Button> : can("leads:write") ? <Button size="sm" onClick={() => setCreating(true)}>New lead</Button> : undefined} />}
            />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} />
          </>
        )}
      </Panel>

      <FormModal
        open={creating} onClose={() => setCreating(false)} title="New lead" size="lg" fields={LEAD_FIELDS} initial={{ source: "manual", priority: "medium" }} submitLabel="Create lead" success="Lead created" invalidate={["/leads", "/dashboard"]}
        submit={(b) => sales.post("/leads", b, { idempotent: true })} onDone={(r) => nav(`/sales/leads/${(r as { id: number }).id}`)}
        errorExtra={(err, retry) => err.code === "possible_duplicate" ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-500">This looks like an existing lead</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {((err.details as { candidates?: { id: number; number: string; first_name: string; last_name?: string; company?: string; reasons?: string[] }[] })?.candidates ?? []).map((c) => (
                <li key={c.id}><Link className="text-primary hover:underline" href={`/sales/leads/${c.id}`} target="_blank" rel="noreferrer">{c.number}</Link> {c.first_name} {c.last_name ?? ""} {c.company ? `· ${c.company}` : ""}{c.reasons?.length ? ` (${c.reasons.join(", ")})` : ""}</li>
              ))}
            </ul>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => retry({ allow_duplicate: true })}>It is a different person — create anyway</Button>
          </div>
        ) : null}
      />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      <FormsModal open={forms} onClose={() => setForms(false)} />
    </>
  );
}

interface ImportResult { dryRun: boolean; created: number; summary: { total: number; ok: number; duplicates: number; invalid: number }; results: { row: number; status: string; message?: string }[] }

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [csv, setCsv] = useState("");
  const [skip, setSkip] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useSalesMutation((dry: boolean) => sales.post<ImportResult>("/leads/import", { csv, dry_run: dry, skip_duplicates: skip }), {
    onSuccess: undefined,
    invalidate: [],
  });
  async function go(dry: boolean) {
    const r = await run.run(dry);
    if (r) {
      setResult(r);
      if (!dry) { const { invalidateSales } = await import("@/lib/sales/hooks"); invalidateSales("/leads"); invalidateSales("/dashboard"); }
    }
  }
  return (
    <Modal open={open} onClose={() => { setResult(null); setCsv(""); onClose(); }} title="Import leads from CSV" size="lg"
      description="Columns: first_name, last_name, email, phone, company, job_title, industry, country, region, source, notes, estimated_value, budget. Up to 2,000 rows. Run a preview first — nothing is saved until you import."
      footer={<>
        <Button variant="outline" disabled={!csv.trim() || run.pending} onClick={() => void go(true)}>Preview (no changes)</Button>
        <Button disabled={!csv.trim() || run.pending || !result || !result.dryRun || result.summary.ok === 0} onClick={() => void go(false)}>{run.pending ? "Working…" : `Import ${result?.dryRun ? result.summary.ok : ""} leads`}</Button>
      </>}>
      <Field label="CSV file">
        <input type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setResult(null); } }} />
      </Field>
      <Field label="…or paste CSV text"><Textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} placeholder={"first_name,last_name,email,company\nAma,Mensah,ama@example.com,Acme Ltd"} /></Field>
      <Checkbox label="Skip rows that match an existing lead" checked={skip} onChange={(e) => { setSkip(e.target.checked); setResult(null); }} />
      {run.error && <p role="alert" className="text-sm text-rose-500">{run.error.message}</p>}
      {result && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">{result.dryRun ? "Preview" : `Imported ${result.created} leads`}: {result.summary.total} rows · {result.summary.ok} valid · {result.summary.duplicates} duplicates · {result.summary.invalid} invalid</p>
          {result.results.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">{result.results.map((r) => <li key={r.row}>Row {r.row}: <StatusBadge status={r.status === "invalid" ? "failed" : "skipped"} label={r.status} /> {r.message}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}

interface FormRow { id: number; name: string; token: string; source: string; require_consent: boolean; active: boolean; submissions: number }

function FormsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useSalesQuery<{ items: FormRow[] }>(open ? "/lead-forms" : null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(true);
  const create = useSalesMutation(() => sales.post("/lead-forms", { name, require_consent: consent }), { invalidate: ["/lead-forms"], success: "Form created", onSuccess: () => setName("") });
  const toggle = useSalesMutation((f: FormRow) => sales.patch(`/lead-forms/${f.id}`, { active: !f.active }), { invalidate: ["/lead-forms"] });
  const link = (t: string) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/f/${t}`;
  return (
    <Modal open={open} onClose={onClose} title="Web lead forms" description="Share the link or embed it in an iframe. Submissions create leads with consent recorded; repeat submissions never reveal whether someone is already known." size="lg">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="New form name" className="mb-0 min-w-[14rem] flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website contact form" /></Field>
        <Checkbox className="mb-1" label="Require consent tick-box" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <Button disabled={name.trim().length < 2 || create.pending} onClick={() => void create.run()}>Create</Button>
      </div>
      {!q.data ? <Skeleton rows={3} /> : q.data.items.length === 0 ? <EmptyState title="No forms yet" /> : (
        <ul className="divide-y">
          {q.data.items.map((f) => (
            <li key={f.id} className="py-3">
              <div className="flex items-center justify-between gap-2"><p className="font-medium">{f.name} <StatusBadge status={f.active ? "active" : "paused"} /></p><Button size="sm" variant="outline" onClick={() => void toggle.run(f)}>{f.active ? "Pause" : "Activate"}</Button></div>
              <p className="mt-1 break-all rounded bg-secondary px-2 py-1 font-mono text-xs">{link(f.token)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{f.submissions} submissions</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
