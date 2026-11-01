import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, QueryBoundary, EmptyState, Modal, Field, Input, Select, Tag } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, ymd, todayYmd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";
import type { Account } from "./accounts";

interface Rate { id: number; component: string; rate: string; effective_from: string; effective_to: string | null; recoverable: boolean; note: string | null; account_code: string; account_name: string }
interface Code { id: number; code: string; name: string; kind: string; is_active: boolean; rates: Rate[] }

export default function TaxPage() {
  const { can } = useFinance();
  const q = useFinanceQuery<{ items: Code[] }>("/tax-codes"); const manage = can("tax:manage");
  const [add, setAdd] = useState<Code | null>(null); const [end, setEnd] = useState<Rate | null>(null);
  const seed = useFinanceMutation(() => fin.post("/tax-codes/seed-ghana"), { invalidate: ["/tax-codes"], success: "Ghana tax codes added" });
  return (
    <>
      <PageHeader title="Tax configuration" description="Tax is data, not code: each component has a rate, an effective date window and a payable account. A document uses the rates in force on its own date, so changing a rate never alters past documents."
        actions={manage ? <Button size="sm" variant="outline" disabled={seed.pending} onClick={() => void seed.run()}>Add Ghana defaults</Button> : undefined} />
      <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600">The seeded Ghana structure (VAT 15% + NHIL 2.5% + GETFund 2.5% from 1 Jan 2026) and which components are recoverable on purchases are configuration for you to confirm with GRA or your tax adviser. CINTEXA Finance has not been certified by GRA and does not submit returns or e-invoices.</p>
      <QueryBoundary q={q}>{(d) => d.items.length === 0 ? <Panel><EmptyState title="No tax codes" description="Add the Ghana defaults to get started." /></Panel> : (
        <div className="space-y-4">{d.items.map((t) => (
          <Panel key={t.id} title={`${t.code} · ${t.name}`} actions={<span className="flex items-center gap-2"><Tag>{t.kind.replace("_", " ")}</Tag>{manage && t.kind === "standard" && <Button size="sm" variant="outline" onClick={() => setAdd(t)}>Add rate</Button>}</span>}>
            {t.rates.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t.kind === "standard" ? "No rates yet." : "No tax is charged under this code."}</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2">Component</th><th>Rate</th><th>Effective from</th><th>Until</th><th>Payable account</th><th>Recoverable</th><th /></tr></thead>
                <tbody>{t.rates.map((r) => <tr key={r.id} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{r.component}</td><td>{Number(r.rate)}%</td><td>{ymd(r.effective_from)}</td><td>{r.effective_to ? ymd(r.effective_to) : "open"}</td><td>{r.account_code} {r.account_name}</td><td>{r.recoverable ? "Yes" : "No"}</td><td>{manage && !r.effective_to && <Button size="sm" variant="ghost" onClick={() => setEnd(r)}>End rate</Button>}</td></tr>)}</tbody></table></div>)}
          </Panel>))}</div>)}</QueryBoundary>
      {add && <AddRate code={add} onClose={() => setAdd(null)} />}
      {end && <EndRate rate={end} onClose={() => setEnd(null)} />}
    </>
  );
}

function AddRate({ code, onClose }: { code: Code; onClose: () => void }) {
  const accounts = useFinanceQuery<{ items: Account[] }>("/accounts", { type: "liability", active: "true" });
  const [v, setV] = useState({ component: "", rate: "", effective_from: todayYmd(), payable_account_id: "", recoverable: false });
  const save = useFinanceMutation(() => fin.post("/tax-rates", { tax_code_id: code.id, component: v.component, rate: v.rate, effective_from: v.effective_from, payable_account_id: Number(v.payable_account_id), recoverable: v.recoverable }), { invalidate: ["/tax-codes"], success: "Rate added", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`Add rate to ${code.code}`} description="If a component already has an open-ended rate, end it first - rates for the same component cannot overlap." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || !v.component || !v.rate || !v.payable_account_id} onClick={() => void save.run()}>Add</Button></>}>
      {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Component" hint="e.g. VAT, NHIL, GETFUND"><Input value={v.component} maxLength={20} onChange={(e) => setV({ ...v, component: e.target.value })} /></Field>
        <Field label="Rate (%)"><Input inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></Field>
        <Field label="Effective from"><Input type="date" value={v.effective_from} onChange={(e) => setV({ ...v, effective_from: e.target.value })} /></Field>
        <Field label="Payable account"><Select value={v.payable_account_id} onChange={(e) => setV({ ...v, payable_account_id: e.target.value })}><option value="">Select…</option>{(accounts.data?.items ?? []).filter((a) => a.allow_posting).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.recoverable} onChange={(e) => setV({ ...v, recoverable: e.target.checked })} />Recoverable as input tax on purchases</label>
    </Modal>
  );
}
function EndRate({ rate, onClose }: { rate: Rate; onClose: () => void }) {
  const [to, setTo] = useState(todayYmd());
  const save = useFinanceMutation(() => fin.patch(`/tax-rates/${rate.id}`, { effective_to: to }), { invalidate: ["/tax-codes"], success: "Rate ended", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`End ${rate.component} ${Number(rate.rate)}%`} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending} onClick={() => void save.run()}>End rate</Button></>}>
      {save.error && <p role="alert" className="mb-3 text-sm text-rose-500">{save.error.message}</p>}
      <Field label="Last day this rate applies"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </Modal>
  );
}
