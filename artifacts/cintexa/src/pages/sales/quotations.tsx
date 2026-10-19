import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useUrlParams } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { QUOTATION_STATUSES } from "@/lib/sales/enums";
import { dateOnly, money } from "@/lib/sales/format";
import { PageHeader, Panel, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, Modal, Field, Input, Textarea, type Column } from "@/components/sales/ui";
import { AccountPicker, OwnerSelect } from "@/components/sales/pickers";
import { LinesEditor, blankLine, draftToBody, type LineDraft } from "@/components/sales/LinesEditor";

export interface QuoteRow { id: number; number: string; version: number; status: string; account_id: number; account_name: string; owner_name: string | null; currency: string; total: string; validity_date: string; requires_approval: boolean; past_validity: boolean; created_at: string }

export default function QuotationsPage() {
  const { can } = useSales();
  const [, nav] = useLocation();
  const [params] = useUrlParams();
  const st = useListState(["status", "owner_id", "expiring_days"]);
  const q = useList<QuoteRow>("/quotations", st);
  const [creating, setCreating] = useState(params.get("create") === "1");
  useEffect(() => { if (params.get("create") === "1") setCreating(true); }, [params]);
  const columns: Column<QuoteRow>[] = [
    { key: "n", header: "Quotation", sort: "number", render: (x) => <div><p className="font-medium">{x.number} <span className="text-xs text-muted-foreground">v{x.version}</span></p><p className="text-xs text-muted-foreground">{x.account_name}</p></div> },
    { key: "s", header: "Status", render: (x) => <div className="flex flex-wrap gap-1"><StatusBadge status={x.status} />{x.requires_approval && x.status === "draft" && <Tag>Needs approval</Tag>}{x.past_validity && ["sent", "viewed"].includes(x.status) && <Tag>Past validity</Tag>}</div> },
    { key: "t", header: "Total", sort: "total", align: "right", render: (x) => money(x.total, x.currency) },
    { key: "v", header: "Valid until", sort: "validity", hideOnMobile: true, render: (x) => dateOnly(x.validity_date) },
    { key: "o", header: "Owner", hideOnMobile: true, render: (x) => x.owner_name ?? "—" },
  ];
  return (
    <>
      <PageHeader title="Quotations & proposals" description="Prices come from price books and promotions; discounts above your limit or margin floor need approval. Customers accept through a private link — acceptance is recorded with name, time and IP, not as a legal e-signature."
        actions={can("quotations:write") ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New quotation</Button> : undefined} />
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search number or account…" />
        <Select aria-label="Status" className="w-44" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{QUOTATION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <Select aria-label="Expiring" className="w-44" value={st.filters.expiring_days ?? ""} onChange={(e) => st.setFilter("expiring_days", e.target.value)}><option value="">Any validity</option>{[3, 7, 14, 30].map((d) => <option key={d} value={d}>Expiring in {d} days</option>)}</Select>
        <OwnerSelect value={st.filters.owner_id ?? ""} onChange={(v) => st.setFilter("owner_id", v)} />
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Quotations" columns={columns} rows={q.data.items} rowKey={(x) => x.id} sort={st.sort} onSort={st.setSort} onRowClick={(x) => nav(`/sales/quotations/${x.id}`)} empty={<EmptyState title={st.hasFilters ? "No quotations match" : "No quotations yet"} description="Create one from an opportunity or an account." />} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      {creating && <CreateQuotation onClose={() => { setCreating(false); if (params.get("create")) window.history.replaceState(null, "", window.location.pathname); }} initialAccount={{ id: params.get("account_id") ?? "", name: params.get("account_name") ?? "" }} opportunityId={params.get("opportunity_id") ?? ""} />}
    </>
  );
}

function CreateQuotation({ onClose, initialAccount, opportunityId }: { onClose: () => void; initialAccount: { id: string; name: string }; opportunityId: string }) {
  const [, nav] = useLocation();
  const [acc, setAcc] = useState(initialAccount);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [validity, setValidity] = useState("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const create = useSalesMutation(() => {
    const b = draftToBody(lines);
    if (!acc.id) throw new Error("Choose an account");
    if (b.error) throw new Error(b.error);
    return sales.post<{ id: number }>("/quotations", { account_id: Number(acc.id), ...(opportunityId ? { opportunity_id: Number(opportunityId) } : {}), ...(validity ? { validity_date: validity } : {}), ...(terms.trim() ? { terms: terms.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), lines: b.lines }, { idempotent: true });
  }, { invalidate: ["/quotations"], success: "Quotation created", silentError: true, onError: (e) => setErr(e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join(" · ") : e.message), onSuccess: (r) => nav(`/sales/quotations/${(r as { id: number }).id}`) });
  return (
    <Modal open onClose={onClose} title="New quotation" size="xl" description="Leave a product's price blank to use the price book / promotion price. Totals are calculated by the server."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={create.pending} onClick={() => { setErr(""); void create.run(); }}>{create.pending ? "Creating…" : "Create draft"}</Button></>}>
      {err && <p role="alert" className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{err}</p>}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Account" required><AccountPicker value={acc.id} initialName={acc.name} onChange={(id, name) => setAcc({ id, name })} /></Field>
        <Field label="Valid until" hint="Defaults to the validity set in Sales Settings"><Input type="date" value={validity} onChange={(e) => setValidity(e.target.value)} /></Field>
      </div>
      <h4 className="mb-2 mt-1 text-sm font-semibold">Lines</h4>
      <LinesEditor rows={lines} onChange={setLines} />
      <div className="mt-4 grid gap-x-4 sm:grid-cols-2">
        <Field label="Terms"><Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Defaults to the terms in Sales Settings" /></Field>
        <Field label="Internal notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
