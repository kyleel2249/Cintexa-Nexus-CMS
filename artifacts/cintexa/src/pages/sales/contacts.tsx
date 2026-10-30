import { Link } from "wouter";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useList, useListState } from "@/lib/sales/list";
import { CONTACT_ROLES } from "@/lib/sales/enums";
import { PageHeader, Panel, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, ConfirmModal, Field, type Column } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { AccountPicker } from "@/components/sales/pickers";
import { useSalesMutation } from "@/lib/sales/hooks";

export interface ContactRow { id: number; first_name: string; last_name: string | null; email: string | null; phone: string | null; job_title: string | null; role: string; is_primary: boolean; account_id: number | null; account_name: string | null; consent_email: boolean; consent_whatsapp: boolean; unsubscribed_at: string | null }

const FIELDS: FieldDef[] = [
  { name: "first_name", label: "First name", required: true },
  { name: "last_name", label: "Last name" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "job_title", label: "Job title" },
  { name: "role", label: "Role in decisions", type: "select", options: CONTACT_ROLES, required: true },
  { name: "is_primary", label: "Primary contact for the account", type: "checkbox" },
  { name: "consent_email", label: "Consented to email", type: "checkbox" },
  { name: "consent_whatsapp", label: "Consented to WhatsApp", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea" },
];

/** Create or edit a contact; `accountId` pre-links (and hides the account picker). */
export function ContactFormModal({ open, onClose, contact, accountId, accountName }: { open: boolean; onClose: () => void; contact?: ContactRow; accountId?: number; accountName?: string }) {
  const [acc, setAcc] = useState<{ id: string; name: string }>({ id: contact?.account_id ? String(contact.account_id) : accountId ? String(accountId) : "", name: contact?.account_name ?? accountName ?? "" });
  return (
    <FormModal open={open} onClose={onClose} title={contact ? "Edit contact" : "New contact"} fields={FIELDS} initial={contact ?? { role: "contact" }} nullEmpty={!!contact} size="lg" autofill="contact"
      success={contact ? "Contact updated" : "Contact created"} invalidate={["/contacts", "/accounts"]}
      extra={accountId ? null : <Field label="Account"><AccountPicker value={acc.id} initialName={acc.name} onChange={(id, name) => setAcc({ id, name })} /></Field>}
      submit={(b) => contact ? sales.patch(`/contacts/${contact.id}`, { ...b, account_id: acc.id ? Number(acc.id) : null }) : sales.post("/contacts", { ...b, ...(acc.id ? { account_id: Number(acc.id) } : {}) }, { idempotent: true })} />
  );
}

export default function ContactsPage() {
  const { can } = useSales();
  const st = useListState(["role"]);
  const q = useList<ContactRow>("/contacts", st);
  const [edit, setEdit] = useState<ContactRow | "new" | null>(null);
  const [del, setDel] = useState<ContactRow | null>(null);
  const remove = useSalesMutation((c: ContactRow) => sales.del(`/contacts/${c.id}`), { invalidate: ["/contacts", "/accounts"], success: "Contact removed", onSuccess: () => setDel(null) });
  const columns: Column<ContactRow>[] = [
    { key: "name", header: "Contact", render: (c) => <div className="min-w-0"><p className="truncate font-medium">{c.first_name} {c.last_name ?? ""} {c.is_primary && <Tag>Primary</Tag>}</p><p className="text-xs text-muted-foreground">{c.job_title ?? "—"}</p></div> },
    { key: "account", header: "Account", render: (c) => (c.account_id ? <Link className="text-primary hover:underline" href={`/sales/accounts/${c.account_id}`}>{c.account_name}</Link> : "—") },
    { key: "email", header: "Email", hideOnMobile: true, render: (c) => c.email ?? "—" },
    { key: "phone", header: "Phone", hideOnMobile: true, render: (c) => c.phone ?? "—" },
    { key: "role", header: "Role", hideOnMobile: true, render: (c) => <StatusBadge status={c.role} /> },
    { key: "consent", header: "Consent", hideOnMobile: true, render: (c) => (c.unsubscribed_at ? <StatusBadge status="rejected" label="Unsubscribed" /> : <span className="text-xs text-muted-foreground">{[c.consent_email && "Email", c.consent_whatsapp && "WhatsApp"].filter(Boolean).join(", ") || "None"}</span>) },
    { key: "act", header: "", render: (c) => can("contacts:write") ? <span className="flex gap-1" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button><Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDel(c)}>Remove</Button></span> : null },
  ];
  return (
    <>
      <PageHeader title="Contacts" description="People at your accounts. Consent for email and WhatsApp is recorded per person and honoured by campaigns and automation." actions={can("contacts:write") ? <Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New contact</Button> : undefined} />
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search name, email, phone, account…" />
        <Select aria-label="Role" className="w-44" value={st.filters.role ?? ""} onChange={(e) => st.setFilter("role", e.target.value)}><option value="">Role: all</option>{CONTACT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select>
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Contacts" columns={columns} rows={q.data.items} rowKey={(c) => c.id} empty={<EmptyState title={st.hasFilters ? "No contacts match" : "No contacts yet"} description="Contacts are added here, on an account, or by converting a lead." />} /><Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      {edit && <ContactFormModal key={edit === "new" ? "new" : edit.id} open onClose={() => setEdit(null)} contact={edit === "new" ? undefined : edit} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Remove contact?" message={del ? `${del.first_name} ${del.last_name ?? ""} will be archived. Their history is kept.` : undefined} confirmLabel="Remove" danger pending={remove.pending} onConfirm={() => del && void remove.run(del)} />
    </>
  );
}
