import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useList, useListState } from "@/lib/sales/list";
import { ACCOUNT_KINDS, ACCOUNT_STATUSES } from "@/lib/sales/enums";
import { dateOnly } from "@/lib/sales/format";
import { PageHeader, Panel, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, type Column, Input } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { ExportButton } from "@/components/sales/actions";
import { OwnerSelect } from "@/components/sales/pickers";

export interface AccountRow { id: number; number: string; name: string; kind: string; status: string; industry: string | null; segment: string | null; country: string | null; owner_id: number; owner_name: string | null; tags: string[]; last_purchase_at: string | null; expected_reorder_on: string | null; open_opportunities: number }

export const ACCOUNT_FIELDS: FieldDef[] = [
  { name: "name", label: "Account name", required: true, wide: true },
  { name: "kind", label: "Type", type: "select", options: ACCOUNT_KINDS, required: true },
  { name: "status", label: "Status", type: "select", options: ACCOUNT_STATUSES, required: true },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "website", label: "Website" },
  { name: "industry", label: "Industry" },
  { name: "segment", label: "Segment" },
  { name: "company_size", label: "Company size" },
  { name: "classification", label: "Classification" },
  { name: "address_line", label: "Address", wide: true },
  { name: "city", label: "City" },
  { name: "region", label: "Region" },
  { name: "country", label: "Country" },
  { name: "postal_code", label: "Postal code" },
  { name: "currency", label: "Currency (ISO)", required: true },
  { name: "payment_terms_days", label: "Payment terms (days)", type: "number", min: 0, max: 365, required: true },
  { name: "credit_limit", label: "Credit limit", type: "money" },
  { name: "reorder_interval_days", label: "Expected reorder every (days)", type: "number", min: 1, max: 1825 },
  { name: "tags", label: "Tags", type: "tags", wide: true },
  { name: "consent_email", label: "Consented to email", type: "checkbox" },
  { name: "consent_whatsapp", label: "Consented to WhatsApp", type: "checkbox" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export default function AccountsPage() {
  const { can, me } = useSales();
  const [, nav] = useLocation();
  const st = useListState(["status", "kind", "owner_id", "segment", "tag", "inactive_days"]);
  const q = useList<AccountRow, { }>("/accounts", st);
  const [creating, setCreating] = useState(false);
  const columns: Column<AccountRow>[] = [
    { key: "name", header: "Account", sort: "name", render: (a) => <div className="min-w-0"><p className="truncate font-medium">{a.name}</p><p className="text-xs text-muted-foreground">{a.number}{a.industry ? ` · ${a.industry}` : ""}</p></div> },
    { key: "status", header: "Status", sort: "status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "owner", header: "Owner", hideOnMobile: true, render: (a) => a.owner_name ?? "—" },
    { key: "opps", header: "Open deals", align: "right", hideOnMobile: true, render: (a) => a.open_opportunities },
    { key: "last", header: "Last purchase", sort: "last_purchase", hideOnMobile: true, render: (a) => (a.last_purchase_at ? dateOnly(a.last_purchase_at) : <span className="text-muted-foreground">Never</span>) },
    { key: "tags", header: "Tags", hideOnMobile: true, render: (a) => <div className="flex flex-wrap gap-1">{a.tags.slice(0, 3).map((t) => <Tag key={t}>{t}</Tag>)}</div> },
  ];
  return (
    <>
      <PageHeader title="Accounts & customers" description="One record per customer. Lifetime value is summed per currency from confirmed orders — nothing is converted silently."
        actions={<>{can("accounts:export") && <ExportButton path="/accounts/export.csv" />}{can("accounts:write") && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New account</Button>}</>} />
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search name, number, email, phone…" />
        <Select aria-label="Status" className="w-36" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{ACCOUNT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <Select aria-label="Type" className="w-36" value={st.filters.kind ?? ""} onChange={(e) => st.setFilter("kind", e.target.value)}><option value="">Type: all</option>{ACCOUNT_KINDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <OwnerSelect value={st.filters.owner_id ?? ""} onChange={(v) => st.setFilter("owner_id", v)} />
        <Select aria-label="Inactivity" className="w-44" value={st.filters.inactive_days ?? ""} onChange={(e) => st.setFilter("inactive_days", e.target.value)}><option value="">Any purchase date</option>{[30, 60, 90, 180].map((d) => <option key={d} value={d}>No purchase in {d} days</option>)}</Select>
        <Input aria-label="Tag" className="w-32" placeholder="Tag" defaultValue={st.filters.tag ?? ""} onBlur={(e) => st.setFilter("tag", e.target.value.trim())} />
        {st.hasFilters && <Button variant="ghost" size="sm" onClick={st.clear}>Clear</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Accounts" columns={columns} rows={q.data.items} rowKey={(a) => a.id} sort={st.sort} onSort={st.setSort} onRowClick={(a) => nav(`/sales/accounts/${a.id}`)}
            empty={<EmptyState title={st.hasFilters ? "No accounts match" : "No accounts yet"} description="Accounts are created here or when a qualified lead is converted." action={!st.hasFilters && can("accounts:write") ? <Button size="sm" onClick={() => setCreating(true)}>New account</Button> : undefined} />} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New account" size="lg" autofill="account" fields={ACCOUNT_FIELDS} initial={{ kind: "company", status: "prospect", currency: me?.business.currency ?? "USD", payment_terms_days: 30 }}
        submitLabel="Create account" success="Account created" invalidate={["/accounts", "/dashboard"]} submit={(b) => sales.post("/accounts", b, { idempotent: true })} onDone={(r) => nav(`/sales/accounts/${(r as { id: number }).id}`)}
        errorExtra={(err, retry) => err.code === "possible_duplicate" || err.code === "possible_duplicate_account" ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-500">A very similar account already exists</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{((err.details as { candidates?: { id: number; name: string; number?: string }[] })?.candidates ?? []).map((c) => <li key={c.id}><Link className="text-primary hover:underline" href={`/sales/accounts/${c.id}`} target="_blank" rel="noreferrer">{c.name}</Link> {c.number ?? ""}</li>)}</ul>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => retry({ allow_duplicate: true })}>Create a separate account anyway</Button>
          </div>
        ) : null} />
    </>
  );
}
