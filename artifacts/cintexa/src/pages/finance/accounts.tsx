import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, StatusBadge, EmptyState, QueryBoundary, Modal, Field, Input, Select, Checkbox, SearchBox, FilterBar, Tag } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";

export interface Account { id: number; code: string; name: string; type: string; category: string; subtype: string | null; parent_id: number | null; normal_balance: string; allow_posting: boolean; is_active: boolean; is_system: boolean; fs_mapping: string | null; description: string | null }
const TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const CATEGORIES: Record<string, string[]> = {
  asset: ["current_asset", "non_current_asset"], liability: ["current_liability", "long_term_liability"], equity: ["equity"], revenue: ["revenue", "other_income"],
  expense: ["cost_of_goods_sold", "operating_expense", "administrative_expense", "finance_cost", "tax_expense"],
};
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function AccountsPage() {
  const { can } = useFinance();
  const [type, setType] = useState(""); const [search, setSearch] = useState(""); const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<Account | "new" | null>(null);
  const q = useFinanceQuery<{ items: Account[] }>("/accounts", { type, q: search, active: showInactive ? undefined : "true" });
  const write = can("finance:update");
  return (
    <>
      <PageHeader title="Chart of accounts" description="Header accounts group others and cannot receive postings. An account with posted activity cannot change its code or type, and cannot be deactivated while its balance is not nil."
        actions={write ? <Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New account</Button> : undefined} />
      <FilterBar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search code or name…" />
        <Select aria-label="Account type" value={type} onChange={(e) => setType(e.target.value)} className="w-40"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
        <Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="mb-0" />
      </FilterBar>
      <Panel flush>
        <QueryBoundary q={q}>{(d) => (
          <DataTable caption="Chart of accounts" rows={d.items} rowKey={(a) => a.id} empty={<EmptyState title="No accounts match" />} columns={[
            { key: "c", header: "Code", render: (a: Account) => <span className="font-mono">{a.code}</span> },
            { key: "n", header: "Account", render: (a: Account) => <span className={a.allow_posting ? "" : "font-semibold"}>{a.parent_id ? "\u00a0\u00a0\u00a0" : ""}{a.name}</span> },
            { key: "t", header: "Type", hideOnMobile: true, render: (a: Account) => <Tag>{label(a.type)}</Tag> },
            { key: "k", header: "Category", hideOnMobile: true, render: (a: Account) => label(a.category) },
            { key: "b", header: "Normal", hideOnMobile: true, render: (a: Account) => label(a.normal_balance) },
            { key: "p", header: "Posting", render: (a: Account) => a.allow_posting ? "Yes" : "Header" },
            { key: "s", header: "Status", render: (a: Account) => <StatusBadge status={a.is_active ? "active" : "inactive"} /> },
            { key: "e", header: "", render: (a: Account) => write ? <Button size="sm" variant="ghost" onClick={() => setEdit(a)}>Edit</Button> : null },
          ]} />
        )}</QueryBoundary>
      </Panel>
      {edit && <AccountForm account={edit === "new" ? null : edit} accounts={q.data?.items ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

function AccountForm({ account, accounts, onClose }: { account: Account | null; accounts: Account[]; onClose: () => void }) {
  const [v, setV] = useState({ code: account?.code ?? "", name: account?.name ?? "", type: account?.type ?? "asset", category: account?.category ?? "current_asset", subtype: account?.subtype ?? "", parent_id: account?.parent_id ? String(account.parent_id) : "", allow_posting: account?.allow_posting ?? true, is_active: account?.is_active ?? true, description: account?.description ?? "" });
  const save = useFinanceMutation(() => account
    ? fin.patch(`/accounts/${account.id}`, { name: v.name, allow_posting: v.allow_posting, is_active: v.is_active, description: v.description || undefined, parent_id: v.parent_id ? Number(v.parent_id) : undefined })
    : fin.post("/accounts", { code: v.code, name: v.name, type: v.type, category: v.category, subtype: v.subtype || undefined, parent_id: v.parent_id ? Number(v.parent_id) : undefined, allow_posting: v.allow_posting, description: v.description || undefined }),
  { invalidate: ["/accounts"], success: account ? "Account updated" : "Account created", onSuccess: onClose, silentError: true });
  const err = (p: string) => save.error?.issues.find((i) => i.path === p)?.message;
  const parents = accounts.filter((a) => a.type === v.type && a.id !== account?.id);
  return (
    <Modal open onClose={onClose} title={account ? `Edit ${account.code}` : "New account"} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || !v.name.trim() || (!account && !v.code.trim())} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save"}</Button></>}>
      {save.error && !save.error.issues.length && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Account code" required error={err("code")}><Input value={v.code} disabled={Boolean(account)} onChange={(e) => setV({ ...v, code: e.target.value })} maxLength={20} /></Field>
        <Field label="Name" required error={err("name")}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={160} /></Field>
        <Field label="Type"><Select value={v.type} disabled={Boolean(account)} onChange={(e) => setV({ ...v, type: e.target.value, category: CATEGORIES[e.target.value]![0]!, parent_id: "" })}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
        <Field label="Category"><Select value={v.category} disabled={Boolean(account)} onChange={(e) => setV({ ...v, category: e.target.value })}>{CATEGORIES[v.type]!.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        <Field label="Parent account" error={err("parent_id")}><Select value={v.parent_id} onChange={(e) => setV({ ...v, parent_id: e.target.value })}><option value="">None</option>{parents.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select></Field>
        <Field label="Subtype" hint="Optional tag used by automation, e.g. bank, accounts_receivable"><Input value={v.subtype} disabled={Boolean(account)} onChange={(e) => setV({ ...v, subtype: e.target.value })} maxLength={60} /></Field>
      </div>
      <Field label="Description"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={500} /></Field>
      <Checkbox label="Accepts postings (untick for a header/group account)" checked={v.allow_posting} onChange={(e) => setV({ ...v, allow_posting: e.target.checked })} />
      {account && <Checkbox label="Active" checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} />}
    </Modal>
  );
}
