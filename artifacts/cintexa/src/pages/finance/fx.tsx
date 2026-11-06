import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost } from "@/lib/finance/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge2, Field, Notice, Page, Section, Table, Td, TabBar, money, previousMonth, rateText, selectCls, toMinor, today, useIdempotencyKey } from "@/components/finance/engine-ui";

type Tab = "exposure" | "rates" | "revalue" | "settle" | "report";

export default function FxPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const [tab, setTab] = useState<Tab>("exposure");
  const [approver, setApprover] = useState("");

  return (
    <Page title="Foreign exchange" desc="Rates, period-end revaluation of monetary foreign balances, settlements and FX gains and losses. All amounts are posted through the single accounting engine.">
      <TabBar<Tab> value={tab} onChange={setTab} tabs={[
        { key: "exposure", label: "Exposure" }, { key: "rates", label: "Rates" }, { key: "revalue", label: "Revaluation" },
        { key: "settle", label: "Settlement" }, { key: "report", label: "Gain / loss report" },
      ]} />
      {tab === "exposure" && <Exposure />}
      {tab === "rates" && <Rates approver={approver} setApprover={setApprover} refresh={refresh} />}
      {tab === "revalue" && <Revalue refresh={refresh} />}
      {tab === "settle" && <Settle refresh={refresh} />}
      {tab === "report" && <Report />}
    </Page>
  );
}

function Exposure() {
  const [asOf, setAsOf] = useState(today());
  const q = useQuery({ queryKey: ["fin", "fx", "exposure", asOf], queryFn: () => finGet<{ items: any[] }>("/fx/exposure", { asOf }) });
  return (
    <Section title="Open foreign-currency positions" hint="Monetary items only (cash, bank, receivables, payables, loans). Inventory, fixed assets and deferred revenue are never revalued.">
      <div className="flex flex-wrap items-end gap-2"><Field label="As of"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field></div>
      <Notice error={q.error} />
      <Table head={["Account", "Currency", "Foreign balance", "Carrying (GHS)", "Closing rate", "Revalued (GHS)", "Unrealized pending"]} empty={q.data && !q.data.items.length ? "No open foreign-currency balances. Post a journal line with a foreign currency and rate to create one." : undefined}>
        {(q.data?.items || []).map((p) => (
          <tr key={p.code + p.currency} className="border-b">
            <Td>{p.code} · {p.name}</Td><Td>{p.currency}</Td>
            <Td right>{money(p.netFc, p.currency)}</Td><Td right>{money(p.carryingMinor)}</Td>
            <Td right>{p.closingRateMicro ? rateText(p.closingRateMicro) : <Badge2 tone="warn">no approved rate</Badge2>}</Td>
            <Td right>{money(p.revaluedMinor)}</Td>
            <Td right>{p.unrealizedPendingMinor == null ? "—" : p.unrealizedPendingMinor === 0 ? <Badge2 tone="ok">up to date</Badge2> : money(p.unrealizedPendingMinor)}</Td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

function Rates({ approver, setApprover, refresh }: { approver: string; setApprover: (s: string) => void; refresh: () => void }) {
  const q = useQuery({ queryKey: ["fin", "fx", "rates"], queryFn: () => finGet<{ items: any[]; functionalCurrency: string }>("/fx/rates") });
  const [f, setF] = useState({ currency: "USD", rate: "", rateDate: today(), type: "closing", source: "", approvedBy: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const add = useMutation({ mutationFn: () => finPost("/fx/rates", { ...f, rate: Number(f.rate), approvedBy: f.approvedBy || undefined }), onSuccess: () => { refresh(); set("rate", ""); } });
  const approve = useMutation({ mutationFn: (id: string) => finPost(`/fx/rates/${id}/approve`, { approvedBy: approver }), onSuccess: refresh });
  return (
    <div className="space-y-4">
      <Section title="Add exchange rate" hint={`Units of ${q.data?.functionalCurrency || "GHS"} per 1 unit of the foreign currency (up to 6 decimals). A rate is only used once approved.`}>
        <div className="flex flex-wrap gap-2">
          <Field label="Currency"><Input value={f.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field label="Rate"><Input inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="12.500000" /></Field>
          <Field label="Rate date"><Input type="date" value={f.rateDate} onChange={(e) => set("rateDate", e.target.value)} /></Field>
          <Field label="Type">
            <select className={selectCls} value={f.type} onChange={(e) => set("type", e.target.value)}>
              {["closing", "average", "transaction", "settlement"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Source (required)"><Input value={f.source} onChange={(e) => set("source", e.target.value)} placeholder="e.g. Bank of Ghana" /></Field>
          <Field label="Approved by (optional)"><Input value={f.approvedBy} onChange={(e) => set("approvedBy", e.target.value)} /></Field>
        </div>
        <Button disabled={add.isPending || !f.rate || !f.source} onClick={() => add.mutate()}>Save rate</Button>
        <Notice error={add.error} ok={add.isSuccess ? "Rate saved." : null} />
      </Section>
      <Section title="Rate register">
        <Field label="Approver name (used by the Approve buttons)" className="max-w-xs"><Input value={approver} onChange={(e) => setApprover(e.target.value)} /></Field>
        <Notice error={approve.error} />
        <Table head={["Date", "Currency", "Type", "Rate", "Source", "Status", ""]} empty={q.data && !q.data.items.length ? "No rates yet." : undefined}>
          {(q.data?.items || []).map((r) => (
            <tr key={r.id} className="border-b">
              <Td>{r.rateDate}</Td><Td>{r.currency}</Td><Td>{r.type}</Td><Td right>{rateText(r.rateMicro)}</Td><Td>{r.source}</Td>
              <Td>{r.status === "approved" ? <Badge2 tone="ok">approved{r.approvedBy ? ` · ${r.approvedBy}` : ""}</Badge2> : <Badge2 tone="warn">pending</Badge2>}</Td>
              <Td>{r.status !== "approved" && <Button size="sm" variant="outline" disabled={!approver || approve.isPending} onClick={() => approve.mutate(r.id)}>Approve</Button>}</Td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function Revalue({ refresh }: { refresh: () => void }) {
  const [ym, setYm] = useState(previousMonth());
  const [previewYm, setPreviewYm] = useState("");
  const prev = useQuery({ queryKey: ["fin", "fx", "preview", previewYm], enabled: !!previewYm, queryFn: () => finGet<any>("/fx/revaluation/preview", { periodYm: previewYm }) });
  const post = useMutation({ mutationFn: () => finPost<any>("/fx/revalue", { periodYm: ym }), onSuccess: () => { refresh(); prev.refetch(); } });
  return (
    <Section title="Period-end revaluation" hint="Adjusts monetary foreign balances to the approved closing rate. Cumulative method: earlier revaluations are part of the carrying amount, so nothing is double counted. Posts once per period.">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Period (YYYY-MM)" className="w-40"><Input value={ym} onChange={(e) => setYm(e.target.value)} /></Field>
        <Button variant="outline" onClick={() => { setPreviewYm(ym); prev.refetch(); }}>Preview</Button>
        <Button disabled={post.isPending || previewYm !== ym || !prev.data || prev.data.missingRates?.length > 0 || !prev.data.lines?.length}
          onClick={() => { if (window.confirm(`Post FX revaluation for ${ym}?`)) post.mutate(); }}>Post revaluation</Button>
      </div>
      <Notice error={prev.error || post.error} ok={post.data ? (post.data.posted ? `Posted ${post.data.journal.number}.` : post.data.note) : null} />
      {prev.data?.missingRates?.length > 0 && <p className="text-sm text-amber-700">Approved closing rate missing for {prev.data.missingRates.join(", ")} on or before {prev.data.entryDate}. Add and approve it on the Rates tab.</p>}
      {prev.data && !prev.data.lines.length && !prev.data.missingRates.length && <p className="text-sm text-emerald-700">Nothing to revalue — carrying amounts already equal closing-rate values.</p>}
      {prev.data?.detail?.length > 0 && (
        <Table head={["Account", "Currency", "Foreign balance", "Closing rate", "Carrying", "Revalued", "Difference"]}>
          {prev.data.detail.map((d: any) => (
            <tr key={d.account + d.currency} className="border-b">
              <Td>{d.account}</Td><Td>{d.currency}</Td><Td right>{money(d.foreignBalance, d.currency)}</Td><Td right>{rateText(d.closingRateMicro)}</Td>
              <Td right>{money(d.carrying)}</Td><Td right>{money(d.revalued)}</Td><Td right className={d.difference < 0 ? "text-rose-600" : ""}>{money(d.difference)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

function Settle({ refresh }: { refresh: () => void }) {
  const pos = useQuery({ queryKey: ["fin", "fx", "exposure", "now"], queryFn: () => finGet<{ items: any[] }>("/fx/exposure", { asOf: today() }) });
  const [sel, setSel] = useState("");
  const [fc, setFc] = useState("");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(today());
  const [counter, setCounter] = useState("1030");
  const idem = useIdempotencyKey();
  const open = (pos.data?.items || []).filter((p) => p.netFc > 0);
  const chosen = open.find((p) => `${p.code}|${p.currency}` === sel);
  const run = useMutation({
    mutationFn: () => {
      if (!chosen) throw new Error("Choose an open position.");
      return finPost<any>("/fx/settle", { accountCode: chosen.code, currency: chosen.currency, fcAmount: toMinor(fc, chosen.currency, "Foreign amount"), rate: Number(rate), date, counterAccountCode: counter, idempotencyKey: idem.key });
    },
    onSuccess: () => { refresh(); idem.reset(); setFc(""); },
  });
  return (
    <Section title="Settle a foreign balance" hint="Receipts clear receivables; payments clear payables. The engine splits the result into realized gain/loss and reverses any unrealized revaluation previously booked on the settled portion.">
      <div className="flex flex-wrap gap-2">
        <Field label="Open position">
          <select className={selectCls} value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Select…</option>
            {open.map((p) => <option key={p.code + p.currency} value={`${p.code}|${p.currency}`}>{p.code} {p.name} — {p.currency} {money(p.netFc, p.currency)}</option>)}
          </select>
        </Field>
        <Field label={`Amount settled${chosen ? ` (${chosen.currency})` : ""}`}><Input inputMode="decimal" value={fc} onChange={(e) => setFc(e.target.value)} /></Field>
        <Field label="Settlement rate (GHS per unit)"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Bank / cash account code"><Input value={counter} onChange={(e) => setCounter(e.target.value)} /></Field>
      </div>
      <Button disabled={run.isPending || !chosen || !fc || !rate} onClick={() => run.mutate()}>Post settlement</Button>
      <Notice error={run.error} ok={run.data ? `Posted ${run.data.journal?.number}${run.data.duplicate ? " (already posted — duplicate ignored)" : ""}.` : null} />
      {pos.data && !open.length && <p className="text-sm text-muted-foreground">No open foreign receivables or payables to settle.</p>}
    </Section>
  );
}

function Report() {
  const [from, setFrom] = useState(`${new Date().getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(today());
  const q = useQuery({ queryKey: ["fin", "fx", "report", from, to], queryFn: () => finGet<any>("/fx/report", { from, to }) });
  const r = q.data;
  return (
    <Section title="FX gains and losses">
      <div className="flex flex-wrap gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Notice error={q.error} />
      {r && (
        <Table head={["", "Gain", "Loss", "Net"]}>
          <tr className="border-b"><Td>Realized (settled)</Td><Td right>{money(r.realizedGain)}</Td><Td right>{money(r.realizedLoss)}</Td><Td right>{money(r.netRealized)}</Td></tr>
          <tr className="border-b"><Td>Unrealized (revaluation)</Td><Td right>{money(r.unrealizedGain)}</Td><Td right>{money(r.unrealizedLoss)}</Td><Td right>{money(r.netUnrealized)}</Td></tr>
          <tr className="font-medium"><Td>Total FX result</Td><Td /><Td /><Td right>{money(r.netFx)}</Td></tr>
        </Table>
      )}
    </Section>
  );
}
