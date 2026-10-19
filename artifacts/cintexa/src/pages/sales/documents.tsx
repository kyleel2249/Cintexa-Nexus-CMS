import { useState } from "react";
import { Plus, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales, openHtmlInNewTab } from "@/lib/sales/api";
import { useDebounced, useSalesMutation, useSalesQuery, useUrlParams } from "@/lib/sales/hooks";
import { dateOnly } from "@/lib/sales/format";
import { labelOf } from "@/lib/sales/labels";
import { PageHeader, Panel, TabBar, Select, Input, Field, Textarea, DataTable, StatusBadge, EmptyState, ErrorState, Skeleton, Modal, ConfirmModal, Tag } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";

const ENTITY_TYPES = [{ value: "account", label: "Account", path: "/accounts" }, { value: "lead", label: "Lead", path: "/leads" }, { value: "opportunity", label: "Opportunity", path: "/opportunities" }, { value: "quotation", label: "Quotation", path: "/quotations" }, { value: "order", label: "Order", path: "/orders" }];
const DOC_KINDS = ["quotation", "proposal", "order", "contract", "account_plan", "meeting_summary", "report", "commission_statement", "other"].map((value) => ({ value, label: labelOf(value) }));
const TEMPLATE_KINDS = DOC_KINDS.filter((k) => k.value !== "other");
type Tab = "documents" | "templates";

interface Doc { id: number; kind: string; title: string; url: string; mime_type: string | null; size_bytes: number | null; version: number; restricted: boolean; signature_status: string; signature_ref: string | null; signed_at: string | null; created_by: string; created_at: string }
interface Template { id: number; kind: string; name: string; body: string; active: boolean }

function entityLabel(r: Record<string, any>): string {
  return String(r.name ?? r.number ?? [r.first_name, r.last_name].filter(Boolean).join(" ") ?? r.id) + (r.name && r.number ? ` (${r.number})` : "") + (r.account_name ? ` · ${r.account_name}` : "");
}

/** Record picker: choose a record type, then search for the record. Server scope limits what appears. */
export function EntityPicker({ type, id, onChange, label = "Record" }: { type: string; id: string; onChange: (t: string, id: string, name: string) => void; label?: string }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const term = useDebounced(text, 250);
  const path = ENTITY_TYPES.find((t) => t.value === type)?.path ?? "/accounts";
  const q = useSalesQuery<{ items: Record<string, any>[] }>(open ? path : null, { q: term || undefined, pageSize: 8 });
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <Select aria-label={`${label} type`} value={type} onChange={(e) => { setText(""); onChange(e.target.value, "", ""); }}>{ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
      <div className="relative">
        <Input aria-label={label} placeholder={`Search ${labelOf(type).toLowerCase()}s…`} value={text} autoComplete="off" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setText(e.target.value); if (id) onChange(type, "", ""); }} />
        {open && <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-lg">
          {q.loading && !q.data && <li className="px-3 py-2 text-muted-foreground">Searching…</li>}
          {q.data?.items.length === 0 && <li className="px-3 py-2 text-muted-foreground">No matches</li>}
          {q.data?.items.map((r) => <li key={r.id} role="option" aria-selected={String(r.id) === id} className="cursor-pointer rounded px-3 py-1.5 hover:bg-secondary" onMouseDown={(e) => { e.preventDefault(); const n = entityLabel(r); setText(n); setOpen(false); onChange(type, String(r.id), n); }}>{entityLabel(r)}</li>)}
        </ul>}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const { can } = useSales();
  const [params, setParams] = useUrlParams();
  const tab: Tab = params.get("tab") === "templates" ? "templates" : "documents";
  return (
    <>
      <PageHeader title="Sales documents" description="Documents are links to files stored in your own storage; nothing is uploaded here. Signature status is recorded by staff and is not verified unless a provider is connected." />
      <TabBar<Tab> tabs={[{ key: "documents", label: "Documents" }, { key: "templates", label: "Templates" }]} value={tab} onChange={(k) => setParams({ tab: k === "documents" ? null : k })} />
      {tab === "templates" ? <Templates canWrite={can("documents:write")} /> : <Documents canWrite={can("documents:write")} />}
    </>
  );
}

function Documents({ canWrite }: { canWrite: boolean }) {
  const [params, setParams] = useUrlParams();
  const type = params.get("entity_type") ?? "account";
  const id = params.get("entity_id") ?? "";
  const [, setName] = useState("");
  const q = useSalesQuery<{ items: Doc[] }>(id ? "/documents" : null, { entity_type: type, entity_id: id });
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState<Doc | null>(null);
  const [sign, setSign] = useState<Doc | null>(null);
  const [del, setDel] = useState<Doc | null>(null);
  const remove = useSalesMutation((d: Doc) => sales.del(`/documents/${d.id}`), { invalidate: ["/documents"], success: "Document removed", onSuccess: () => setDel(null) });
  return (
    <>
      <div className="mb-4 max-w-2xl"><Field label="Show documents for"><EntityPicker type={type} id={id} onChange={(t, i, n) => { setName(n); setParams({ entity_type: t, entity_id: i || null }); }} /></Field></div>
      {!id ? <EmptyState icon={<FileText className="h-8 w-8" />} title="Choose a record" description="Documents belong to a lead, account, opportunity, quotation or order." /> : (
        <>
          {canWrite && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Link document</Button></div>}
          <Panel flush>
            {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
              <DataTable caption="Documents" rows={q.data.items} rowKey={(d) => d.id} empty={<EmptyState title="No documents linked" description="Link a contract, proposal or other file stored in your own storage." />}
                columns={[{ key: "t", header: "Document", render: (d: Doc) => <div><a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={d.url} target="_blank" rel="noopener noreferrer">{d.title}<ExternalLink className="h-3 w-3" /></a><p className="text-xs text-muted-foreground">{labelOf(d.kind)} · v{d.version} · {d.created_by} · {dateOnly(d.created_at)}</p></div> },
                  { key: "r", header: "", hideOnMobile: true, render: (d: Doc) => d.restricted ? <Tag>Restricted</Tag> : null },
                  { key: "s", header: "Signature", render: (d: Doc) => d.signature_status === "none" ? <span className="text-muted-foreground">—</span> : <span><StatusBadge status={d.signature_status} />{d.signature_status === "signed" && <span className="block text-xs text-muted-foreground">Recorded manually · ref {d.signature_ref}</span>}</span> },
                  { key: "x", header: "", render: (d: Doc) => canWrite ? <span className="flex justify-end gap-1">{d.signature_status !== "signed" && <Button size="sm" variant="ghost" onClick={() => setVersion(d)}>New version</Button>}{d.signature_status !== "signed" && <Button size="sm" variant="ghost" onClick={() => setSign(d)}>Signature</Button>}<Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDel(d)}>Remove</Button></span> : null }]} />
            )}
          </Panel>
        </>
      )}
      <FormModal open={adding} onClose={() => setAdding(false)} title="Link document" description="Paste a secure https link to the file." success="Document linked" invalidate={["/documents"]} initial={{ kind: "other" }}
        fields={[{ name: "title", label: "Title", required: true, wide: true }, { name: "kind", label: "Kind", type: "select", options: DOC_KINDS, required: true }, { name: "url", label: "Link (https://…)", type: "url", required: true, wide: true }, { name: "mime_type", label: "File type", placeholder: "application/pdf" }, { name: "restricted", label: "Restricted (needs the restricted-documents permission to see)", type: "checkbox", wide: true }]}
        submit={(b) => sales.post("/documents", { ...b, entity_type: type, entity_id: Number(id) }, { idempotent: true })} />
      {version && <FormModal open onClose={() => setVersion(null)} title={`New version of ${version.title}`} description="The previous link is kept in the audit log." success="Version added" invalidate={["/documents"]} fields={[{ name: "url", label: "New link (https://…)", type: "url", required: true, wide: true }]} submit={(b) => sales.post(`/documents/${version.id}/version`, b)} />}
      {sign && <FormModal open onClose={() => setSign(null)} title="Record signature status" description="This records what staff report. It is not verified by an e-signature provider." success="Recorded" invalidate={["/documents"]} initial={{ status: "requested" }}
        fields={[{ name: "status", label: "Status", type: "select", required: true, options: [{ value: "requested", label: "Requested" }, { value: "signed", label: "Signed" }, { value: "declined", label: "Declined" }] }, { name: "reference", label: "Reference", required: true, hint: "e.g. envelope or contract number" }, { name: "evidence", label: "Evidence", type: "textarea", required: true, wide: true, hint: "How do you know? e.g. countersigned PDF received by email on…" }]} submit={(b) => sales.post(`/documents/${sign.id}/signature`, b)} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Remove document?" message="The link is archived; the file itself is untouched." confirmLabel="Remove" danger pending={remove.pending} onConfirm={() => del && void remove.run(del)} />
    </>
  );
}

function Templates({ canWrite }: { canWrite: boolean }) {
  const q = useSalesQuery<{ items: Template[] }>("/document-templates");
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  const [render, setRender] = useState<Template | null>(null);
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Placeholders look like <code className="rounded bg-secondary px-1">{"{{account.name}}"}</code>, <code className="rounded bg-secondary px-1">{"{{number}}"}</code>, <code className="rounded bg-secondary px-1">{"{{total}}"}</code>. Unknown placeholders render empty. Margin and cost fields are removed unless you may see cost.</p>
      {canWrite && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New template</Button></div>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Templates" rows={q.data.items} rowKey={(t) => t.id} empty={<EmptyState title="No templates" description="Create a template for proposals, meeting summaries and more." />}
            columns={[{ key: "n", header: "Template", render: (t: Template) => t.name }, { key: "k", header: "Kind", render: (t: Template) => labelOf(t.kind) }, { key: "a", header: "Status", render: (t: Template) => <StatusBadge status={t.active ? "active" : "inactive"} label={t.active ? "Active" : "Inactive"} /> },
              { key: "x", header: "", render: (t: Template) => <span className="flex justify-end gap-1">{t.active && <Button size="sm" variant="ghost" onClick={() => setRender(t)}>Generate</Button>}{canWrite && <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>Edit</Button>}</span> }]} />
        )}
      </Panel>
      {edit && <FormModal key={edit === "new" ? "n" : edit.id} open size="xl" onClose={() => setEdit(null)} title={edit === "new" ? "New template" : `Edit ${edit.name}`} success="Template saved" invalidate={["/document-templates"]} initial={edit === "new" ? { kind: "proposal", active: true } : edit}
        fields={[{ name: "name", label: "Name", required: true }, ...(edit === "new" ? [{ name: "kind", label: "Kind", type: "select" as const, options: TEMPLATE_KINDS, required: true }] : [{ name: "active", label: "Active", type: "checkbox" as const }]), { name: "body", label: "Body", type: "textarea", rows: 14, required: true, wide: true }]}
        submit={(b) => (edit === "new" ? sales.post("/document-templates", b) : sales.patch(`/document-templates/${edit.id}`, b))} />}
      {render && <RenderModal t={render} onClose={() => setRender(null)} />}
    </>
  );
}

function RenderModal({ t, onClose }: { t: Template; onClose: () => void }) {
  const [rec, setRec] = useState({ type: "account", id: "" });
  const [out, setOut] = useState<{ text: string; html: string; note: string } | null>(null);
  const m = useSalesMutation(() => sales.post<{ text: string; html: string; note: string }>(`/document-templates/${t.id}/render`, { entity_type: rec.type, entity_id: Number(rec.id) }), { onSuccess: (r) => setOut(r) });
  return (
    <Modal open onClose={onClose} size="xl" title={`Generate: ${t.name}`} description="Preview only; nothing is stored or sent." footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!rec.id || m.pending} onClick={() => void m.run()}>Generate</Button>{out && <><Button variant="outline" onClick={() => void navigator.clipboard?.writeText(out.text)}>Copy text</Button><Button variant="outline" onClick={() => openHtmlInNewTab(`<!doctype html><meta charset="utf-8"><title>${t.name}</title>${out.html}`)}>Print view</Button></>}</>}>
      <Field label="Fill from record"><EntityPicker type={rec.type} id={rec.id} onChange={(ty, i) => setRec({ type: ty, id: i })} /></Field>
      {m.error && <p role="alert" className="mt-2 text-sm text-rose-500">{m.error.message}</p>}
      {out && <div className="mt-4"><Textarea readOnly rows={14} value={out.text} /><p className="mt-1 text-xs text-muted-foreground">{out.note}</p></div>}
    </Modal>
  );
}
