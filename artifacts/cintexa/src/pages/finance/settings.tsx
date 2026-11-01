import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, DataTable, QueryBoundary, Field, Input, Select, Checkbox, Modal, StatusBadge, TabBar } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";

interface Org { legal_name: string; trading_name: string | null; registration_number: string | null; tax_id: string | null; country: string; functional_currency: string; timezone: string; fiscal_year_start_month: number; accounting_method: string; accounting_framework: string }
interface Member { id: number; email: string; display_name: string | null; role: string; status: string }
const ROLES = ["organisation_owner", "finance_director", "financial_controller", "chief_accountant", "accountant", "ar_officer", "ap_officer", "payroll_manager", "hr_officer", "cashier", "procurement_officer", "department_manager", "internal_auditor", "external_auditor", "readonly_executive"];
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
type Tab = "company" | "people" | "roles";

export default function SettingsPage() {
  const { can } = useFinance();
  const [tab, setTab] = useState<Tab>("company");
  const tabs: { key: Tab; label: string }[] = [{ key: "company", label: "Company & policies" }, ...(can("finance:admin") ? [{ key: "people" as Tab, label: "People & roles" }] : []), { key: "roles", label: "Role permissions" }];
  return (<><PageHeader title="Company settings" description="Organisation details, approval policy, who can access these books, and what each role may do. Permissions are enforced on the server." /><TabBar<Tab> tabs={tabs} value={tab} onChange={setTab} />{tab === "company" ? <Company /> : tab === "people" ? <People /> : <Roles />}</>);
}

function Company() {
  const { can, reload } = useFinance();
  const q = useFinanceQuery<{ organisation: Org & { settings: { journal_approval_required?: boolean; document_approval_required?: boolean; allow_self_approval?: boolean } } }>("/organisation");
  const admin = can("finance:admin");
  const [v, setV] = useState<Partial<Org>>({}); const [policy, setPolicy] = useState({ journal_approval_required: true, document_approval_required: true, allow_self_approval: false });
  useEffect(() => { const o = q.data?.organisation; if (o) { setV(o); setPolicy({ journal_approval_required: o.settings?.journal_approval_required !== false, document_approval_required: o.settings?.document_approval_required !== false, allow_self_approval: o.settings?.allow_self_approval === true }); } }, [q.data]);
  const save = useFinanceMutation(() => fin.patch("/organisation", { legal_name: v.legal_name, trading_name: v.trading_name || undefined, registration_number: v.registration_number || undefined, tax_id: v.tax_id || undefined, timezone: v.timezone, accounting_method: v.accounting_method, accounting_framework: v.accounting_framework, settings: policy }), { invalidate: ["/organisation", "/audit"], success: "Settings saved", onSuccess: () => reload() });
  const set = (k: keyof Org) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <QueryBoundary q={q}>{() => (
      <Panel><div className="grid gap-x-3 p-4 sm:grid-cols-2">
        <Field label="Registered business name"><Input disabled={!admin} value={v.legal_name ?? ""} onChange={set("legal_name")} /></Field>
        <Field label="Trading name"><Input disabled={!admin} value={v.trading_name ?? ""} onChange={set("trading_name")} /></Field>
        <Field label="Company registration number"><Input disabled={!admin} value={v.registration_number ?? ""} onChange={set("registration_number")} /></Field>
        <Field label="Tax identification number"><Input disabled={!admin} value={v.tax_id ?? ""} onChange={set("tax_id")} /></Field>
        <Field label="Time zone"><Input disabled={!admin} value={v.timezone ?? ""} onChange={set("timezone")} /></Field>
        <Field label="Functional currency" hint="Fixed once books exist"><Input disabled value={v.functional_currency ?? ""} /></Field>
        <Field label="Accounting method"><Select disabled={!admin} value={v.accounting_method ?? "accrual"} onChange={set("accounting_method")}><option value="accrual">Accrual</option><option value="cash">Cash</option></Select></Field>
        <Field label="Accounting framework"><Select disabled={!admin} value={v.accounting_framework ?? "ifrs_sme"} onChange={set("accounting_framework")}><option value="ifrs_sme">IFRS for SMEs</option><option value="ifrs">Full IFRS</option><option value="gaap_local">Local GAAP</option></Select></Field>
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium">Journal approval policy</p>
          <Checkbox disabled={!admin} label="Journals must be approved before they can be posted" checked={policy.journal_approval_required} onChange={(e) => setPolicy({ ...policy, journal_approval_required: e.target.checked })} />
          <Checkbox disabled={!admin} label="Invoices and supplier bills must be approved before they are issued or posted" checked={policy.document_approval_required} onChange={(e) => setPolicy({ ...policy, document_approval_required: e.target.checked })} />
          <Checkbox disabled={!admin || !policy.journal_approval_required} label="Allow a person to approve their own journal (weakens separation of duties - not recommended)" checked={policy.allow_self_approval} onChange={(e) => setPolicy({ ...policy, allow_self_approval: e.target.checked })} /></div>
        {admin && <div className="sm:col-span-2"><Button disabled={save.pending} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save changes"}</Button></div>}
      </div></Panel>)}</QueryBoundary>
  );
}

function People() {
  const { reload } = useFinance();
  const q = useFinanceQuery<{ items: Member[] }>("/members");
  const [add, setAdd] = useState(false); const [v, setV] = useState({ email: "", role: "accountant", display_name: "" });
  const invite = useFinanceMutation(() => fin.post("/members", { email: v.email, role: v.role, display_name: v.display_name || undefined }), { invalidate: ["/members", "/audit"], success: "Member added - they can open Finance with this e-mail address", onSuccess: () => { setAdd(false); setV({ email: "", role: "accountant", display_name: "" }); } });
  const change = useFinanceMutation((a: { id: number; role?: string; status?: string }) => fin.patch(`/members/${a.id}`, { role: a.role, status: a.status }), { invalidate: ["/members", "/audit"], success: "Member updated", onSuccess: () => reload() });
  return (<>
    <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setAdd(true)}>Add person</Button></div>
    <Panel flush><QueryBoundary q={q}>{(d) => <DataTable caption="Members" rows={d.items} rowKey={(m) => m.id} columns={[
      { key: "e", header: "E-mail", render: (m: Member) => <>{m.email}{m.display_name ? <span className="text-muted-foreground"> · {m.display_name}</span> : null}</> },
      { key: "r", header: "Role", render: (m: Member) => <Select aria-label={`Role for ${m.email}`} className="w-52" value={m.role} onChange={(e) => void change.run({ id: m.id, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select> },
      { key: "s", header: "Status", render: (m: Member) => <StatusBadge status={m.status} /> },
      { key: "a", header: "", render: (m: Member) => <Button size="sm" variant="ghost" onClick={() => void change.run({ id: m.id, status: m.status === "active" ? "suspended" : "active" })}>{m.status === "active" ? "Suspend" : "Reactivate"}</Button> },
    ]} />}</QueryBoundary></Panel>
    <Modal open={add} onClose={() => setAdd(false)} title="Add person" footer={<><Button variant="outline" onClick={() => setAdd(false)}>Cancel</Button><Button disabled={invite.pending || !v.email.includes("@")} onClick={() => void invite.run()}>Add</Button></>}>
      <Field label="E-mail address" required error={invite.error?.issues.find((i) => i.path === "email")?.message}><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      <Field label="Name"><Input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
      <Field label="Role"><Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select></Field>
    </Modal>
  </>);
}

function Roles() {
  const q = useFinanceQuery<{ roles: Record<string, string[]> }>("/permissions");
  return (
    <Panel flush><QueryBoundary q={q}>{(d) => { const perms = [...new Set(Object.values(d.roles).flat())].sort(); return (
      <div className="overflow-x-auto"><table className="w-full text-xs"><caption className="sr-only">Permissions by role</caption><thead><tr className="border-b text-left"><th className="sticky left-0 bg-card px-3 py-2">Role</th>{perms.map((p) => <th key={p} className="px-2 py-2 font-mono font-normal [writing-mode:vertical-rl]">{p}</th>)}</tr></thead>
        <tbody>{Object.entries(d.roles).map(([r, ps]) => <tr key={r} className="border-b last:border-0"><th scope="row" className="sticky left-0 bg-card px-3 py-1.5 text-left font-medium">{label(r)}</th>{perms.map((p) => <td key={p} className="px-2 text-center">{ps.includes(p) ? <span aria-label="allowed">●</span> : <span className="text-muted-foreground/40" aria-label="not allowed">·</span>}</td>)}</tr>)}</tbody></table></div>); }}</QueryBoundary></Panel>
  );
}
