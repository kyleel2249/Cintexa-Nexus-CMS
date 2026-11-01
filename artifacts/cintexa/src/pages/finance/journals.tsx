import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, StatusBadge, EmptyState, QueryBoundary, Modal, Drawer, Field, Input, Select, MoneyInput, SearchBox, FilterBar, ConfirmModal, Pagination, DefinitionList } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, fromMinor, toMinor, todayYmd, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";
import type { Account } from "./accounts";

export interface Journal { id: number; reference: string; journal_type: string; entry_date: string; description: string; status: string; total?: string; created_by_label: string | null; approved_by_label: string | null; posted_by_label: string | null; posted_at: string | null; rejection_reason: string | null; reversal_of: number | null; reversed_by: number | null; source_module: string | null; source_ref: string | null }
interface Line { id: number; line_no: number; account_id: number; account_code: string; account_name: string; description: string | null; debit: string; credit: string; department: string | null; cost_centre: string | null; project: string | null }
interface Detail extends Journal { lines: Line[]; total_debit: string; total_credit: string }
const PAGE = 25;
const TYPES = ["manual", "adjustment", "accrual", "prepayment", "reclassification", "opening", "recurring"];
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function JournalsPage() {
  const { can, currency } = useFinance();
  const [loc] = useLocation();
  const [status, setStatus] = useState(""); const [type, setType] = useState(""); const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<number | "new" | null>(() => (new URLSearchParams(window.location.search).get("new") ? "new" : null));
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("new")) setEditor("new"); }, [loc]);
  const q = useFinanceQuery<{ items: Journal[]; total: number }>("/journals", { status, type, q: search, limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <>
      <PageHeader title="Journal entries" description="Every journal must balance. Posting needs an independent approval (when the organisation policy requires it) and writes immutable ledger entries; mistakes are fixed with a reversal, never an edit."
        actions={can("finance:create") ? <Button size="sm" onClick={() => setEditor("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New journal</Button> : undefined} />
      <FilterBar>
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search reference or description…" />
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{["draft", "approved", "posted", "rejected"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select aria-label="Type" className="w-44" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{[...TYPES, "automated", "reversal", "closing"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
      </FilterBar>
      <Panel flush>
        <QueryBoundary q={q}>{(d) => (<>
          <DataTable caption="Journals" rows={d.items} rowKey={(j) => j.id} onRowClick={(j) => setOpen(j.id)} empty={<EmptyState title="No journals found" description="Create a journal to record a transaction, opening balance or adjustment." />} columns={[
            { key: "r", header: "Reference", render: (j: Journal) => <span className="font-mono">{j.reference}</span> },
            { key: "d", header: "Date", render: (j: Journal) => ymd(j.entry_date) },
            { key: "x", header: "Description", render: (j: Journal) => <span className="line-clamp-1">{j.description}</span> },
            { key: "t", header: "Type", hideOnMobile: true, render: (j: Journal) => label(j.journal_type) },
            { key: "a", header: "Amount", align: "right", render: (j: Journal) => fmtMoney(j.total, currency) },
            { key: "s", header: "Status", render: (j: Journal) => <StatusBadge status={j.reversed_by ? "reversed" : j.status} /> },
          ]} />
          <Pagination page={page} pageSize={PAGE} total={d.total} onPage={setPage} />
        </>)}</QueryBoundary>
      </Panel>
      {editor !== null && <JournalEditor id={editor === "new" ? null : editor} onClose={() => { setEditor(null); if (window.location.search.includes("new=1")) window.history.replaceState(null, "", "/finance/journals"); }} />}
      {open !== null && <JournalDrawer id={open} onClose={() => setOpen(null)} onEdit={(id) => { setOpen(null); setEditor(id); }} />}
    </>
  );
}

interface EditLine { account_id: string; description: string; debit: string; credit: string }
const blank = (): EditLine => ({ account_id: "", description: "", debit: "", credit: "" });

function JournalEditor({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { currency } = useFinance();
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { active: "true" });
  const existing = useFinanceQuery<{ journal: Detail }>(id ? `/journals/${id}` : null);
  const [date, setDate] = useState(todayYmd()); const [desc, setDesc] = useState(""); const [type, setType] = useState("manual");
  const [lines, setLines] = useState<EditLine[]>([blank(), blank()]);
  useEffect(() => {
    const j = existing.data?.journal; if (!j) return;
    setDate(ymd(j.entry_date)); setDesc(j.description); setType(j.journal_type);
    setLines(j.lines.map((l) => ({ account_id: String(l.account_id), description: l.description ?? "", debit: Number(l.debit) ? l.debit : "", credit: Number(l.credit) ? l.credit : "" })));
  }, [existing.data]);
  const postable = useMemo(() => (accounts.data?.items ?? []).filter((a) => a.allow_posting), [accounts.data]);
  const totals = useMemo(() => {
    let d = 0n, c = 0n, bad = false;
    for (const l of lines) { const x = toMinor(l.debit); const y = toMinor(l.credit); if (x === null || y === null) bad = true; else { d += x; c += y; } }
    return { d, c, diff: d - c, bad };
  }, [lines]);
  const lineErr = lines.some((l) => !l.account_id || ((toMinor(l.debit) ?? 0n) > 0n) === ((toMinor(l.credit) ?? 0n) > 0n));
  const valid = desc.trim().length >= 3 && !totals.bad && !lineErr && totals.d > 0n && totals.diff === 0n && lines.length >= 2;
  const save = useFinanceMutation(() => {
    const payload = { entry_date: date, description: desc, lines: lines.map((l) => ({ account_id: Number(l.account_id), description: l.description || undefined, debit: l.debit || "0", credit: l.credit || "0" })) };
    return id ? fin.patch(`/journals/${id}`, payload) : fin.post("/journals", { ...payload, journal_type: type });
  }, { invalidate: ["/journals", "/overview"], success: id ? "Journal updated" : "Draft journal saved", onSuccess: onClose });
  const set = (i: number, patch: Partial<EditLine>) => setLines((p) => p.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <Modal open onClose={onClose} size="xl" title={id ? "Edit journal" : "New journal"} description="Enter amounts exactly; the entry must balance before it can be saved."
      footer={<><span className={`mr-auto self-center text-sm ${totals.diff === 0n && totals.d > 0n ? "text-emerald-500" : "text-rose-500"}`} role="status">{totals.bad ? "Check amounts (max 2 decimals)" : totals.diff === 0n ? `Balanced · ${fmtMoney(fromMinor(totals.d), currency)}` : `Out of balance by ${fmtMoney(fromMinor(totals.diff < 0n ? -totals.diff : totals.diff), currency)}`}</span>
        <Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || save.pending} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save draft"}</Button></>}>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Type"><Select value={type} disabled={Boolean(id)} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
        <Field label="Description" required><Input value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} /></Field>
      </div>
      {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}{save.error.issues.length ? ` - ${save.error.issues.map((i) => i.message).join("; ")}` : ""}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="px-1 pb-1">Account</th><th className="px-1 pb-1">Memo</th><th className="w-32 px-1 pb-1 text-right">Debit</th><th className="w-32 px-1 pb-1 text-right">Credit</th><th className="w-8" /></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}>
            <td className="p-1"><Select aria-label={`Line ${i + 1} account`} value={l.account_id} onChange={(e) => set(i, { account_id: e.target.value })}><option value="">Select account…</option>{postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></td>
            <td className="p-1"><Input aria-label={`Line ${i + 1} memo`} value={l.description} maxLength={300} onChange={(e) => set(i, { description: e.target.value })} /></td>
            <td className="p-1"><MoneyInput aria-label={`Line ${i + 1} debit`} className="text-right" value={l.debit} onChange={(v) => set(i, { debit: v, credit: v ? "" : l.credit })} /></td>
            <td className="p-1"><MoneyInput aria-label={`Line ${i + 1} credit`} className="text-right" value={l.credit} onChange={(v) => set(i, { credit: v, debit: v ? "" : l.debit })} /></td>
            <td className="p-1">{lines.length > 2 && <button aria-label={`Remove line ${i + 1}`} className="rounded p-1 text-muted-foreground hover:text-rose-500" onClick={() => setLines((p) => p.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></button>}</td>
          </tr>))}
        </tbody>
        <tfoot><tr className="border-t font-medium"><td className="px-1 pt-2" colSpan={2}><Button size="sm" variant="ghost" onClick={() => setLines((p) => [...p, blank()])}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button></td><td className="px-2 pt-2 text-right tabular-nums">{fromMinor(totals.d)}</td><td className="px-2 pt-2 text-right tabular-nums">{fromMinor(totals.c)}</td><td /></tr></tfoot>
      </table></div>
    </Modal>
  );
}

export function JournalDrawer({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit?: (id: number) => void }) {
  const { can, currency, settings } = useFinance();
  const q = useFinanceQuery<{ journal: Detail }>(`/journals/${id}`);
  const [dlg, setDlg] = useState<"reject" | "reverse" | "delete" | null>(null);
  const refresh = { invalidate: ["/journals", "/ledger", "/trial-balance", "/dashboard", "/overview", "/audit"] };
  const approve = useFinanceMutation(() => fin.post(`/journals/${id}/approve`), { ...refresh, success: "Journal approved" });
  const post = useFinanceMutation(() => fin.post(`/journals/${id}/post`), { ...refresh, success: "Journal posted to the ledger" });
  const reject = useFinanceMutation((reason: string) => fin.post(`/journals/${id}/reject`, { reason }), { ...refresh, success: "Journal rejected", onSuccess: () => setDlg(null) });
  const reverse = useFinanceMutation((reason: string) => fin.post(`/journals/${id}/reverse`, { reason }), { ...refresh, success: (r: any) => `Reversed with ${r.reversal.reference}`, onSuccess: () => setDlg(null) });
  const del = useFinanceMutation(() => fin.del(`/journals/${id}`), { ...refresh, success: "Journal deleted", onSuccess: onClose });
  const j = q.data?.journal;
  const canPost = j && can("finance:post") && (j.status === "approved" || (j.status === "draft" && !settings.journal_approval_required));
  return (
    <Drawer open onClose={onClose} title={j ? j.reference : "Journal"} subtitle={j ? <StatusBadge status={j.reversed_by ? "reversed" : j.status} /> : undefined} width="max-w-3xl"
      footer={j ? <>
        {can("finance:create") && ["draft", "rejected"].includes(j.status) && onEdit && <Button variant="outline" onClick={() => onEdit(j.id)}>Edit</Button>}
        {can("finance:create") && ["draft", "rejected"].includes(j.status) && <Button variant="outline" className="text-rose-500" onClick={() => setDlg("delete")}>Delete</Button>}
        {can("finance:approve") && ["draft", "approved"].includes(j.status) && <Button variant="outline" onClick={() => setDlg("reject")}>Reject</Button>}
        {can("finance:approve") && j.status === "draft" && <Button disabled={approve.pending} onClick={() => void approve.run()}>Approve</Button>}
        {canPost && <Button disabled={post.pending} onClick={() => void post.run()}>Post to ledger</Button>}
        {can("finance:reverse") && j.status === "posted" && !j.reversed_by && j.journal_type !== "reversal" && <Button variant="outline" onClick={() => setDlg("reverse")}>Reverse</Button>}
      </> : undefined}>
      <QueryBoundary q={q}>{({ journal: x }) => (<>
        <DefinitionList items={[
          { label: "Date", value: ymd(x.entry_date) }, { label: "Type", value: label(x.journal_type) }, { label: "Description", value: x.description },
          { label: "Created by", value: x.created_by_label ?? "—" }, { label: "Approved by", value: x.approved_by_label ?? "—" }, { label: "Posted by", value: x.posted_by_label ? `${x.posted_by_label}` : "—" },
          ...(x.source_module ? [{ label: "Source", value: `${x.source_module} ${x.source_ref ?? ""}` }] : []), ...(x.rejection_reason ? [{ label: "Rejected because", value: x.rejection_reason }] : []),
        ]} />
        {!settings.journal_approval_required ? null : x.status === "draft" && <p className="mt-3 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600">This organisation requires approval by someone other than the creator before posting.</p>}
        <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">Account</th><th>Memo</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
          <tbody>{x.lines.map((l) => <tr key={l.id} className="border-b last:border-0"><td className="py-1.5"><span className="font-mono">{l.account_code}</span> {l.account_name}</td><td className="text-muted-foreground">{l.description ?? ""}</td><td className="text-right tabular-nums">{Number(l.debit) ? fmtMoney(l.debit, currency) : ""}</td><td className="text-right tabular-nums">{Number(l.credit) ? fmtMoney(l.credit, currency) : ""}</td></tr>)}</tbody>
          <tfoot><tr className="font-semibold"><td colSpan={2} className="pt-2">Total</td><td className="pt-2 text-right tabular-nums">{fmtMoney(x.total_debit, currency)}</td><td className="pt-2 text-right tabular-nums">{fmtMoney(x.total_credit, currency)}</td></tr></tfoot></table></div>
      </>)}</QueryBoundary>
      <ConfirmModal open={dlg === "reject"} onClose={() => setDlg(null)} onConfirm={(r) => void reject.run(r ?? "")} title="Reject this journal?" confirmLabel="Reject" danger pending={reject.pending} reasonLabel="Reason" reasonRequired />
      <ConfirmModal open={dlg === "reverse"} onClose={() => setDlg(null)} onConfirm={(r) => void reverse.run(r ?? "")} title="Reverse this journal?" message="A new posted journal with opposite debits and credits is created today. The original stays in the books." confirmLabel="Post reversal" pending={reverse.pending} reasonLabel="Reason" reasonRequired />
      <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} onConfirm={() => void del.run()} title="Delete this unposted journal?" confirmLabel="Delete" danger pending={del.pending} />
    </Drawer>
  );
}

