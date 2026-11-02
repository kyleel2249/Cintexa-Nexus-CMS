/** Phase 6 — Investor register, share classes, shareholdings, contributions. */
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader, Panel, QueryBoundary, EmptyState, DataTable, Field, Input, Select } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceMutation, useFinanceQuery, invalidateFinance } from "@/lib/finance/hooks";
import { fin, fmtMoney } from "@/lib/finance/api";

type Mode = "investors" | "shareholders";
interface Summary { currency: string; active_investors: number; share_classes: number; shareholding_records: number; contribution_total: string; ledger_equity: string; note: string }
interface Investor { id: number; code: string; name: string; investor_type: string; email?: string; is_active: boolean }
interface CapTable {
  has_shareholdings: boolean; total_shares_issued: string; note: string;
  holdings: { investor_code: string; investor_name: string; class_code: string; class_name: string; shares: string; ownership_pct_of_class: string | null; ownership_pct_of_total: string | null }[];
}

export default function CapitalPage({ mode }: { mode: Mode }) {
  const { can, currency } = useFinance();
  const summary = useFinanceQuery<Summary>("/capital/summary");
  const investors = useFinanceQuery<{ items: Investor[] }>("/investors");
  const classes = useFinanceQuery<{ items: any[] }>("/share-classes");
  const cap = useFinanceQuery<CapTable>("/cap-table");
  const contributions = useFinanceQuery<{ items: any[] }>("/contributions");
  const [showInv, setShowInv] = useState(false);
  const [showClass, setShowClass] = useState(false);
  const [showHold, setShowHold] = useState(false);
  const [showCont, setShowCont] = useState(false);
  const [invForm, setInvForm] = useState({ name: "", investor_type: "individual", email: "" });
  const [classForm, setClassForm] = useState({ name: "", class_type: "ordinary", authorized_shares: "" });
  const [holdForm, setHoldForm] = useState({ investor_id: "", share_class_id: "", shares: "", issued_on: new Date().toISOString().slice(0, 10), consideration: "cash" });
  const [contForm, setContForm] = useState({ investor_id: "", amount: "", contribution_date: new Date().toISOString().slice(0, 10), form: "cash" });
  const refresh = () => { invalidateFinance("/investors"); invalidateFinance("/share-classes"); invalidateFinance("/cap-table"); invalidateFinance("/contributions"); invalidateFinance("/capital"); };
  const createInv = useFinanceMutation(() => fin.post("/investors", { ...invForm, email: invForm.email || undefined }), { success: "Investor created", onSuccess: () => { setShowInv(false); refresh(); } });
  const createClass = useFinanceMutation(() => fin.post("/share-classes", { name: classForm.name, class_type: classForm.class_type, authorized_shares: classForm.authorized_shares ? Number(classForm.authorized_shares) : undefined }), { success: "Share class created", onSuccess: () => { setShowClass(false); refresh(); } });
  const createHold = useFinanceMutation(() => fin.post("/shareholdings", { investor_id: Number(holdForm.investor_id), share_class_id: Number(holdForm.share_class_id), shares: holdForm.shares, issued_on: holdForm.issued_on, consideration: holdForm.consideration }), { success: "Shareholding recorded", onSuccess: () => { setShowHold(false); refresh(); } });
  const createCont = useFinanceMutation(() => fin.post("/contributions", { investor_id: Number(contForm.investor_id), amount: contForm.amount, contribution_date: contForm.contribution_date, form: contForm.form }), { success: "Contribution recorded", onSuccess: () => { setShowCont(false); refresh(); } });

  return (
    <>
      <PageHeader
        title={mode === "investors" ? "Investor Management" : "Shareholder Management"}
        description={mode === "investors" ? "Investor profiles and capital contributions. Ownership only via share issuances." : "Share register and capitalisation table from recorded shareholdings only."}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
            {mode === "investors"
              ? <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/shareholders">Cap table</Link></Button>
              : <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/investors">Investors</Link></Button>}
          </div>
        }
      />
      <QueryBoundary q={summary}>{(s) => (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
          {[
            { label: "Active investors", value: String(s.active_investors) },
            { label: "Share classes", value: String(s.share_classes) },
            { label: "Shareholdings", value: String(s.shareholding_records) },
            { label: "Contributions", value: fmtMoney(s.contribution_total, s.currency || currency) },
            { label: "Ledger equity", value: fmtMoney(s.ledger_equity, s.currency || currency) },
          ].map((x) => (
            <div key={x.label} className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">{x.label}</div>
              <div className="text-lg font-semibold mt-1 tabular-nums">{x.value}</div>
            </div>
          ))}
          <p className="col-span-full text-xs text-muted-foreground">{s.note}</p>
        </div>
      )}</QueryBoundary>

      {mode === "investors" && (
        <div className="space-y-4">
          <Panel title="Investors" actions={can("finance:create") ? <Button size="sm" onClick={() => setShowInv((v) => !v)}>{showInv ? "Cancel" : "Add investor"}</Button> : undefined}>
            {showInv && (
              <div className="p-4 border-b space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" required><Input value={invForm.name} onChange={(e) => setInvForm((p) => ({ ...p, name: e.target.value }))} /></Field>
                  <Field label="Type"><Select value={invForm.investor_type} onChange={(e) => setInvForm((p) => ({ ...p, investor_type: e.target.value }))}>{["individual","company","fund","other"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                  <Field label="Email"><Input value={invForm.email} onChange={(e) => setInvForm((p) => ({ ...p, email: e.target.value }))} /></Field>
                </div>
                <Button disabled={createInv.pending || !invForm.name.trim()} onClick={() => void createInv.run()}>{createInv.pending ? "Saving…" : "Save"}</Button>
              </div>
            )}
            <QueryBoundary q={investors}>{(d) => d.items.length === 0
              ? <EmptyState title="No investors yet" description="Add an investor to begin." />
              : <DataTable
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "code", header: "Code", render: (r: Investor) => r.code },
                    { key: "name", header: "Name", render: (r) => r.name },
                    { key: "type", header: "Type", render: (r) => r.investor_type },
                    { key: "email", header: "Email", render: (r) => r.email || "—" },
                    { key: "active", header: "Active", render: (r) => r.is_active ? "Yes" : "No" },
                  ]}
                  rows={d.items}
                />
            }</QueryBoundary>
          </Panel>
          <Panel title="Contributions" description="Do not confer ownership" actions={can("finance:create") ? <Button size="sm" onClick={() => setShowCont((v) => !v)}>{showCont ? "Cancel" : "Record"}</Button> : undefined}>
            {showCont && (
              <div className="p-4 border-b space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Investor" required>
                    <Select value={contForm.investor_id} onChange={(e) => setContForm((p) => ({ ...p, investor_id: e.target.value }))}>
                      <option value="">Select…</option>
                      {(investors.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Amount" required><Input value={contForm.amount} onChange={(e) => setContForm((p) => ({ ...p, amount: e.target.value }))} /></Field>
                  <Field label="Date" required><Input type="date" value={contForm.contribution_date} onChange={(e) => setContForm((p) => ({ ...p, contribution_date: e.target.value }))} /></Field>
                  <Field label="Form"><Select value={contForm.form} onChange={(e) => setContForm((p) => ({ ...p, form: e.target.value }))}>{["cash","asset","services","other"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                </div>
                <Button disabled={createCont.pending || !contForm.investor_id || !contForm.amount} onClick={() => void createCont.run()}>{createCont.pending ? "Saving…" : "Save"}</Button>
              </div>
            )}
            <QueryBoundary q={contributions}>{(d) => d.items.length === 0
              ? <EmptyState title="No contributions" description="Optional context only." />
              : <DataTable
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "date", header: "Date", render: (r: any) => String(r.contribution_date).slice(0, 10) },
                    { key: "investor", header: "Investor", render: (r: any) => `${r.investor_code} — ${r.investor_name}` },
                    { key: "amount", header: "Amount", align: "right", render: (r: any) => fmtMoney(r.amount, r.currency || currency) },
                    { key: "form", header: "Form", render: (r: any) => r.form },
                    { key: "status", header: "Status", render: (r: any) => r.status },
                  ]}
                  rows={d.items}
                />
            }</QueryBoundary>
          </Panel>
        </div>
      )}

      {mode === "shareholders" && (
        <div className="space-y-4">
          <Panel title="Share classes" actions={can("finance:create") ? <Button size="sm" onClick={() => setShowClass((v) => !v)}>{showClass ? "Cancel" : "Add class"}</Button> : undefined}>
            {showClass && (
              <div className="p-4 border-b space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Name" required><Input value={classForm.name} onChange={(e) => setClassForm((p) => ({ ...p, name: e.target.value }))} /></Field>
                  <Field label="Type"><Select value={classForm.class_type} onChange={(e) => setClassForm((p) => ({ ...p, class_type: e.target.value }))}>{["ordinary","preference","other"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                  <Field label="Authorised shares"><Input value={classForm.authorized_shares} onChange={(e) => setClassForm((p) => ({ ...p, authorized_shares: e.target.value }))} /></Field>
                </div>
                <Button disabled={createClass.pending || !classForm.name.trim()} onClick={() => void createClass.run()}>{createClass.pending ? "Saving…" : "Save"}</Button>
              </div>
            )}
            <QueryBoundary q={classes}>{(d) => d.items.length === 0
              ? <EmptyState title="No share classes" description="Create a class before issuing shares." />
              : <DataTable
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "code", header: "Code", render: (r: any) => r.code },
                    { key: "name", header: "Name", render: (r: any) => r.name },
                    { key: "type", header: "Type", render: (r: any) => r.class_type },
                    { key: "auth", header: "Authorised", render: (r: any) => r.authorized_shares ?? "—" },
                    { key: "vote", header: "Voting", render: (r: any) => r.voting_rights ? "Yes" : "No" },
                  ]}
                  rows={d.items}
                />
            }</QueryBoundary>
          </Panel>
          <Panel title="Issue shares" description="Only source of ownership" actions={can("finance:create") ? <Button size="sm" onClick={() => setShowHold((v) => !v)}>{showHold ? "Cancel" : "Issue"}</Button> : undefined}>
            {showHold && (
              <div className="p-4 border-b space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Investor" required>
                    <Select value={holdForm.investor_id} onChange={(e) => setHoldForm((p) => ({ ...p, investor_id: e.target.value }))}>
                      <option value="">Select…</option>
                      {(investors.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Class" required>
                    <Select value={holdForm.share_class_id} onChange={(e) => setHoldForm((p) => ({ ...p, share_class_id: e.target.value }))}>
                      <option value="">Select…</option>
                      {(classes.data?.items ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Shares" required><Input value={holdForm.shares} onChange={(e) => setHoldForm((p) => ({ ...p, shares: e.target.value }))} /></Field>
                  <Field label="Issued on" required><Input type="date" value={holdForm.issued_on} onChange={(e) => setHoldForm((p) => ({ ...p, issued_on: e.target.value }))} /></Field>
                </div>
                <Button disabled={createHold.pending || !holdForm.investor_id || !holdForm.share_class_id || !holdForm.shares} onClick={() => void createHold.run()}>{createHold.pending ? "Saving…" : "Record"}</Button>
              </div>
            )}
          </Panel>
          <Panel title="Capitalisation table" description="From shareholdings only">
            <QueryBoundary q={cap}>{(d) => !d.has_shareholdings
              ? <EmptyState title="No shareholdings" description="Ownership appears after shares are issued." />
              : (
                <div className="space-y-3">
                  <p className="px-4 pt-3 text-sm text-muted-foreground">Total shares issued: <span className="font-medium tabular-nums">{d.total_shares_issued}</span></p>
                  <DataTable
                    rowKey={(r) => `${r.investor_code}-${r.class_code}`}
                    columns={[
                      { key: "investor", header: "Investor", render: (h: CapTable["holdings"][0]) => `${h.investor_code} — ${h.investor_name}` },
                      { key: "class", header: "Class", render: (h) => `${h.class_code} ${h.class_name}` },
                      { key: "shares", header: "Shares", align: "right", render: (h) => h.shares },
                      { key: "pc", header: "% class", align: "right", render: (h) => h.ownership_pct_of_class != null ? `${h.ownership_pct_of_class}%` : "—" },
                      { key: "pt", header: "% total", align: "right", render: (h) => h.ownership_pct_of_total != null ? `${h.ownership_pct_of_total}%` : "—" },
                    ]}
                    rows={d.holdings}
                  />
                  <p className="px-4 pb-3 text-xs text-muted-foreground">{d.note}</p>
                </div>
              )
            }</QueryBoundary>
          </Panel>
        </div>
      )}
    </>
  );
}
