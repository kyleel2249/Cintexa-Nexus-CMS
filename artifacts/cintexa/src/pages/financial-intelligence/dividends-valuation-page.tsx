/** Phase 7 — Dividends & Business Valuation. */
import { useState } from "react";
import { Link } from "wouter";
import { PageHeader, Panel, QueryBoundary, EmptyState, DataTable, Field, Input, Select } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import { useFinance } from "@/context/FinanceContext";
import { useFinanceMutation, useFinanceQuery, invalidateFinance } from "@/lib/finance/hooks";
import { fin, fmtMoney } from "@/lib/finance/api";

type Mode = "dividends" | "valuation";

export default function DividendsValuationPage({ mode }: { mode: Mode }) {
  const { can, currency } = useFinance();
  const dividends = useFinanceQuery<{ items: any[] }>(mode === "dividends" ? "/dividends" : null);
  const nav = useFinanceQuery<any>(mode === "valuation" ? "/valuation/nav" : null);
  const scenarios = useFinanceQuery<{ items: any[] }>(mode === "valuation" ? "/valuation/scenarios" : null);
  const classes = useFinanceQuery<{ items: any[] }>(mode === "dividends" ? "/share-classes" : null);

  const [showDiv, setShowDiv] = useState(false);
  const [showVal, setShowVal] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useFinanceQuery<any>(selectedId ? `/dividends/${selectedId}` : null);

  const [divForm, setDivForm] = useState({ title: "", declaration_date: new Date().toISOString().slice(0, 10), amount_per_share: "", share_class_id: "" });
  const [valForm, setValForm] = useState({ name: "", method: "nav", as_of_date: new Date().toISOString().slice(0, 10), equity_value: "", enterprise_value: "", multiple: "", base_metric: "", base_metric_label: "", notes: "" });

  const refreshDiv = () => { invalidateFinance("/dividends"); if (selectedId) invalidateFinance(`/dividends/${selectedId}`); };
  const refreshVal = () => { invalidateFinance("/valuation"); };

  const createDiv = useFinanceMutation(
    () => fin.post("/dividends", {
      title: divForm.title,
      declaration_date: divForm.declaration_date,
      amount_per_share: divForm.amount_per_share || undefined,
      share_class_id: divForm.share_class_id ? Number(divForm.share_class_id) : undefined,
    }),
    { success: "Dividend declaration created (draft)", onSuccess: () => { setShowDiv(false); refreshDiv(); } },
  );
  const genLines = useFinanceMutation((id: number) => fin.post(`/dividends/${id}/generate-lines`, {}), { success: "Lines generated from shareholdings", onSuccess: refreshDiv });
  const approveDiv = useFinanceMutation((id: number) => fin.post(`/dividends/${id}/approve`, {}), { success: "Dividend approved", onSuccess: refreshDiv });
  const markPaid = useFinanceMutation((id: number) => fin.post(`/dividends/${id}/mark-paid`, {}), { success: "Marked paid", onSuccess: refreshDiv });
  const voidDiv = useFinanceMutation((id: number) => fin.post(`/dividends/${id}/void`, {}), { success: "Voided", onSuccess: refreshDiv });

  const createVal = useFinanceMutation(
    () => fin.post("/valuation/scenarios", {
      name: valForm.name,
      method: valForm.method,
      as_of_date: valForm.as_of_date,
      equity_value: valForm.equity_value || undefined,
      enterprise_value: valForm.enterprise_value || undefined,
      multiple: valForm.multiple || undefined,
      base_metric: valForm.base_metric || undefined,
      base_metric_label: valForm.base_metric_label || undefined,
      notes: valForm.notes || undefined,
    }),
    { success: "Valuation scenario saved", onSuccess: () => { setShowVal(false); refreshVal(); } },
  );

  if (mode === "dividends") {
    return (
      <>
        <PageHeader title="Dividends & Investor Returns" description="Explicit dividend declarations only. Nothing is assumed payable until declared, approved, and paid." actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence/shareholders">Cap table</Link></Button>
            {can("finance:create") && <Button size="sm" onClick={() => setShowDiv((v) => !v)}>{showDiv ? "Cancel" : "New declaration"}</Button>}
          </div>
        } />
        {showDiv && (
          <Panel title="New dividend declaration">
            <div className="p-4 space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Title" required><Input value={divForm.title} onChange={(e) => setDivForm((p) => ({ ...p, title: e.target.value }))} /></Field>
                <Field label="Declaration date" required><Input type="date" value={divForm.declaration_date} onChange={(e) => setDivForm((p) => ({ ...p, declaration_date: e.target.value }))} /></Field>
                <Field label="Amount per share"><Input value={divForm.amount_per_share} onChange={(e) => setDivForm((p) => ({ ...p, amount_per_share: e.target.value }))} placeholder="0.00" /></Field>
                <Field label="Share class (optional)"><Select value={divForm.share_class_id} onChange={(e) => setDivForm((p) => ({ ...p, share_class_id: e.target.value }))}><option value="">All classes</option>{(classes.data?.items ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</Select></Field>
              </div>
              <Button disabled={createDiv.pending || !divForm.title.trim()} onClick={() => void createDiv.run()}>{createDiv.pending ? "Saving…" : "Save draft"}</Button>
            </div>
          </Panel>
        )}
        <Panel title="Declarations" description="Draft → Approved → Paid. Lines are generated from the share register.">
          <QueryBoundary q={dividends}>{(d) => d.items.length === 0
            ? <EmptyState title="No dividend declarations" description="Create a draft declaration when the board authorises a distribution." />
            : <DataTable columns={[
                { key: "code", header: "Code" }, { key: "title", header: "Title" }, { key: "date", header: "Declared" },
                { key: "aps", header: "Per share", align: "right" as const }, { key: "total", header: "Total", align: "right" as const },
                { key: "status", header: "Status" }, { key: "actions", header: "" },
              ] as any} rows={d.items.map((x: any) => ({
                code: x.code, title: x.title, date: String(x.declaration_date).slice(0, 10),
                aps: x.amount_per_share ?? "—", total: x.total_amount != null ? fmtMoney(x.total_amount, x.currency || currency) : "—",
                status: x.status,
                actions: (
                  <div className="flex flex-wrap gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(x.id)}>View</Button>
                    {x.status === "draft" && can("finance:create") && <Button size="sm" variant="outline" onClick={() => void genLines.run(x.id)} disabled={genLines.pending}>Generate lines</Button>}
                    {x.status === "draft" && can("finance:approve") && <Button size="sm" onClick={() => void approveDiv.run(x.id)} disabled={approveDiv.pending}>Approve</Button>}
                    {x.status === "approved" && can("finance:update") && <Button size="sm" onClick={() => void markPaid.run(x.id)} disabled={markPaid.pending}>Mark paid</Button>}
                    {x.status !== "paid" && x.status !== "void" && can("finance:update") && <Button size="sm" variant="outline" onClick={() => void voidDiv.run(x.id)} disabled={voidDiv.pending}>Void</Button>}
                  </div>
                ),
              }))} />
          }</QueryBoundary>
        </Panel>
        {selectedId && (
          <Panel title="Declaration detail" actions={<Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>Close</Button>}>
            <QueryBoundary q={detail}>{(d) => (
              <div className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">{d.declaration.code} · {d.declaration.status} · total {d.declaration.total_amount != null ? fmtMoney(d.declaration.total_amount, d.declaration.currency || currency) : "—"}</p>
                {(d.lines?.length ?? 0) === 0
                  ? <EmptyState title="No lines yet" description="Generate lines from the share register while the declaration is draft." />
                  : <DataTable columns={[{ key: "investor", header: "Investor" }, { key: "shares", header: "Shares", align: "right" as const }, { key: "amount", header: "Amount", align: "right" as const }] as any}
                      rows={d.lines.map((l: any) => ({ investor: `${l.investor_code} — ${l.investor_name}`, shares: l.shares, amount: fmtMoney(l.amount, d.declaration.currency || currency) }))} />}
              </div>
            )}</QueryBoundary>
          </Panel>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Business Valuation" description="Book NAV from posted equity; optional scenario models are user-entered and never invent market prices." actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link href="/financial-intelligence">Overview</Link></Button>
          {can("finance:create") && <Button size="sm" onClick={() => setShowVal((v) => !v)}>{showVal ? "Cancel" : "Add scenario"}</Button>}
        </div>
      } />
      <QueryBoundary q={nav}>{(n) => (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
          {[
            { label: "Net asset value", value: fmtMoney(n.net_asset_value, n.currency) },
            { label: "Book equity", value: fmtMoney(n.book_equity, n.currency) },
            { label: "Current year P&L", value: fmtMoney(n.current_year_profit, n.currency) },
            { label: "Total assets", value: fmtMoney(n.total_assets, n.currency) },
          ].map((x) => (
            <div key={x.label} className="rounded-xl border bg-card p-3">
              <div className="text-xs text-muted-foreground">{x.label}</div>
              <div className="text-lg font-semibold mt-1 tabular-nums">{x.value}</div>
            </div>
          ))}
          <p className="col-span-full text-xs text-muted-foreground">{n.note} As of {n.as_of}.</p>
        </div>
      )}</QueryBoundary>
      {showVal && (
        <Panel title="New valuation scenario">
          <div className="p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Name" required><Input value={valForm.name} onChange={(e) => setValForm((p) => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Method"><Select value={valForm.method} onChange={(e) => setValForm((p) => ({ ...p, method: e.target.value }))}>{["nav","earnings_multiple","revenue_multiple","dcf","transaction","other"].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
              <Field label="As of" required><Input type="date" value={valForm.as_of_date} onChange={(e) => setValForm((p) => ({ ...p, as_of_date: e.target.value }))} /></Field>
              <Field label="Equity value"><Input value={valForm.equity_value} onChange={(e) => setValForm((p) => ({ ...p, equity_value: e.target.value }))} /></Field>
              <Field label="Enterprise value"><Input value={valForm.enterprise_value} onChange={(e) => setValForm((p) => ({ ...p, enterprise_value: e.target.value }))} /></Field>
              <Field label="Multiple"><Input value={valForm.multiple} onChange={(e) => setValForm((p) => ({ ...p, multiple: e.target.value }))} /></Field>
              <Field label="Base metric"><Input value={valForm.base_metric} onChange={(e) => setValForm((p) => ({ ...p, base_metric: e.target.value }))} /></Field>
              <Field label="Base metric label"><Input value={valForm.base_metric_label} onChange={(e) => setValForm((p) => ({ ...p, base_metric_label: e.target.value }))} placeholder="e.g. EBITDA" /></Field>
              <Field label="Notes"><Input value={valForm.notes} onChange={(e) => setValForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
            </div>
            <Button disabled={createVal.pending || !valForm.name.trim()} onClick={() => void createVal.run()}>{createVal.pending ? "Saving…" : "Save scenario"}</Button>
          </div>
        </Panel>
      )}
      <Panel title="Saved scenarios" description="User-entered models. NAV above is the only figure derived from the ledger.">
        <QueryBoundary q={scenarios}>{(d) => d.items.length === 0
          ? <EmptyState title="No valuation scenarios" description="Record board-approved or advisory valuations here. They do not alter the books." />
          : <DataTable columns={[
              { key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "method", header: "Method" },
              { key: "as_of", header: "As of" }, { key: "equity", header: "Equity value", align: "right" as const },
              { key: "ev", header: "Enterprise value", align: "right" as const }, { key: "multiple", header: "Multiple", align: "right" as const },
            ] as any} rows={d.items.map((s: any) => ({
              code: s.code, name: s.name, method: s.method, as_of: String(s.as_of_date).slice(0, 10),
              equity: s.equity_value != null ? fmtMoney(s.equity_value, s.currency || currency) : "—",
              ev: s.enterprise_value != null ? fmtMoney(s.enterprise_value, s.currency || currency) : "—",
              multiple: s.multiple ?? "—",
            }))} />
        }</QueryBoundary>
      </Panel>
    </>
  );
}
