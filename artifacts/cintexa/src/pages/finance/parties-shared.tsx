import { useState } from "react";
import { Plus } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, StatusBadge, EmptyState, QueryBoundary, Modal, Drawer, Field, Input, MoneyInput, SearchBox, FilterBar, Pagination, DefinitionList } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";

interface Party { id: number; code: string; name: string; classification: string | null; email: string | null; phone: string | null; tax_id: string | null; payment_terms_days: number; credit_limit?: string | null; is_active: boolean }
interface Statement { opening_balance: string; closing_balance: string; lines: { date: string; number: string; type: string; charges: string; payments: string; balance: string }[] }
const PAGE = 50;

export function PartyPage({ kind }: { kind: "customer" | "supplier" }) {
  const { can, currency } = useFinance();
  const base = kind === "customer" ? "/customers" : "/suppliers"; const noun = kind === "customer" ? "customer" : "supplier";
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const [edit, setEdit] = useState<Party | "new" | null>(null); const [open, setOpen] = useState<Party | null>(null);
  const q = useFinanceQuery<{ items: Party[]; total: number }>(base, { q: search, limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <>
      <PageHeader title={kind === "customer" ? "Customers" : "Suppliers"} description={kind === "customer" ? "Who you invoice. Credit limits are enforced when an invoice is issued." : "Who you buy from. Each supplier invoice number can only be entered once per supplier."}
        actions={can("finance:update") ? <Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New {noun}</Button> : undefined} />
      <FilterBar><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={`Search ${noun}s…`} /></FilterBar>
      <Panel flush><QueryBoundary q={q}>{(d) => (<>
        <DataTable caption={`${noun}s`} rows={d.items} rowKey={(p) => p.id} onRowClick={(p) => setOpen(p)} empty={<EmptyState title={`No ${noun}s yet`} description={`Add your first ${noun} to start raising documents.`} />} columns={[
          { key: "c", header: "Code", render: (p: Party) => <span className="font-mono">{p.code}</span> }, { key: "n", header: "Name", render: (p: Party) => p.name },
          { key: "e", header: "E-mail", hideOnMobile: true, render: (p: Party) => p.email ?? "" }, { key: "t", header: "Terms", hideOnMobile: true, render: (p: Party) => `${p.payment_terms_days} days` },
          ...(kind === "customer" ? [{ key: "l", header: "Credit limit", align: "right" as const, render: (p: Party) => (p.credit_limit ? fmtMoney(p.credit_limit, currency) : "—") }] : []),
          { key: "s", header: "Status", render: (p: Party) => <StatusBadge status={p.is_active ? "active" : "inactive"} /> },
        ]} />
        <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
      </>)}</QueryBoundary></Panel>
      {edit && <PartyForm kind={kind} party={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {open && <PartyDrawer kind={kind} party={open} onClose={() => setOpen(null)} onEdit={() => { setEdit(open); setOpen(null); }} />}
    </>
  );
}

function PartyForm({ kind, party, onClose }: { kind: "customer" | "supplier"; party: Party | null; onClose: () => void }) {
  const base = kind === "customer" ? "/customers" : "/suppliers";
  const [v, setV] = useState({ name: party?.name ?? "", email: party?.email ?? "", phone: party?.phone ?? "", tax_id: party?.tax_id ?? "", payment_terms_days: String(party?.payment_terms_days ?? 30), credit_limit: party?.credit_limit && Number(party.credit_limit) ? party.credit_limit : "", is_active: party?.is_active ?? true });
  const save = useFinanceMutation(() => {
    const body: Record<string, unknown> = { name: v.name, email: v.email || undefined, phone: v.phone || undefined, tax_id: v.tax_id || undefined, payment_terms_days: Number(v.payment_terms_days) };
    if (kind === "customer" && v.credit_limit) body.credit_limit = v.credit_limit;
    if (party) body.is_active = v.is_active;
    return party ? fin.patch(`${base}/${party.id}`, body) : fin.post(base, body);
  }, { invalidate: [base], success: party ? "Saved" : "Created", onSuccess: onClose, silentError: true });
  const err = (p: string) => save.error?.issues.find((i) => i.path === p)?.message;
  return (
    <Modal open onClose={onClose} title={party ? `Edit ${party.name}` : `New ${kind}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || v.name.trim().length < 2} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save"}</Button></>}>
      {save.error && !save.error.issues.length && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Name" required error={err("name")}><Input value={v.name} maxLength={200} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="E-mail" error={err("email")}><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Tax identification number"><Input value={v.tax_id} onChange={(e) => setV({ ...v, tax_id: e.target.value })} /></Field>
        <Field label="Payment terms (days)" error={err("payment_terms_days")}><Input inputMode="numeric" value={v.payment_terms_days} onChange={(e) => setV({ ...v, payment_terms_days: e.target.value })} /></Field>
        {kind === "customer" && <Field label="Credit limit" hint="Leave empty for no limit" error={err("credit_limit")}><MoneyInput value={v.credit_limit} onChange={(x) => setV({ ...v, credit_limit: x })} /></Field>}
      </div>
      {party && <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />Active</label>}
    </Modal>
  );
}

function PartyDrawer({ kind, party, onClose, onEdit }: { kind: "customer" | "supplier"; party: Party; onClose: () => void; onEdit: () => void }) {
  const { can, currency } = useFinance();
  const base = kind === "customer" ? "/customers" : "/suppliers";
  const info = useFinanceQuery<{ outstanding: string; open_documents: number }>(`${base}/${party.id}`);
  const st = useFinanceQuery<Statement>(`${base}/${party.id}/statement`);
  return (
    <Drawer open onClose={onClose} title={party.name} subtitle={<span className="font-mono text-xs">{party.code}</span>} width="max-w-2xl" footer={can("finance:update") ? <Button variant="outline" onClick={onEdit}>Edit</Button> : undefined}>
      <DefinitionList items={[{ label: "E-mail", value: party.email ?? "—" }, { label: "Phone", value: party.phone ?? "—" }, { label: "Tax ID", value: party.tax_id ?? "—" }, { label: "Terms", value: `${party.payment_terms_days} days` },
        { label: "Outstanding", value: info.data ? `${fmtMoney(info.data.outstanding, currency)} across ${info.data.open_documents} document(s)` : "…" }]} />
      <h3 className="mb-2 mt-5 text-sm font-semibold">Statement</h3>
      <QueryBoundary q={st}>{(s) => s.lines.length === 0 ? <EmptyState title="No activity yet" /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">Date</th><th>Document</th><th className="text-right">{kind === "customer" ? "Invoiced" : "Billed"}</th><th className="text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
          <tbody>{s.lines.map((l, i) => <tr key={i} className="border-b last:border-0"><td className="py-1.5">{ymd(l.date)}</td><td>{l.type} <span className="font-mono text-xs">{l.number}</span></td><td className="text-right tabular-nums">{Number(l.charges) ? fmtMoney(l.charges, currency) : ""}</td><td className="text-right tabular-nums">{Number(l.payments) ? fmtMoney(l.payments, currency) : ""}</td><td className="text-right tabular-nums">{fmtMoney(l.balance, currency)}</td></tr>)}</tbody>
          <tfoot><tr className="font-semibold"><td colSpan={4} className="pt-2">Closing balance</td><td className="pt-2 text-right tabular-nums">{fmtMoney(s.closing_balance, currency)}</td></tr></tfoot></table></div>)}</QueryBoundary>
      <p className="mt-4 text-xs text-muted-foreground"><Link href={kind === "customer" ? "/finance/invoices" : "/finance/bills"} className="underline">View all {kind === "customer" ? "invoices" : "bills"}</Link></p>
    </Drawer>
  );
}
