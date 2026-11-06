import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost } from "@/lib/finance/api";
import { AccountSelect, type AccountOption } from "@/components/finance/AccountSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge2, Field, Notice, Page, Section, Table, Td, TabBar, money, selectCls, toMinor, today } from "@/components/finance/engine-ui";

type Tab = "packs" | "new" | "years";
type Line = { account: AccountOption | null; debit: string; credit: string };

export default function RestatementsPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const [tab, setTab] = useState<Tab>("packs");
  const [open, setOpen] = useState("");
  return (
    <Page title="Prior-period restatements" desc="Corrections to a closed, issued year. The original statements are preserved, the restated ones are shown beside them, and a material error moves through opening retained earnings instead of silently reopening the old period.">
      <TabBar<Tab> value={tab} onChange={setTab} tabs={[{ key: "packs", label: "Restatement packs" }, { key: "new", label: "New restatement" }, { key: "years", label: "Fiscal years (year-end close)" }]} />
      {tab === "packs" && <Packs open={open} setOpen={setOpen} refresh={refresh} goNew={() => setTab("new")} />}
      {tab === "new" && <NewPack refresh={refresh} done={(id) => { setOpen(id); setTab("packs"); }} />}
      {tab === "years" && <Years refresh={refresh} />}
    </Page>
  );
}

const treatmentLabel: Record<string, string> = {
  retrospective_restatement: "Retrospective restatement (material)",
  current_period_correction: "Current-period correction (immaterial)",
  prospective: "Prospective (change in estimate)",
  prospective_impracticable: "Prospective (retrospective impracticable)",
};

function Packs({ open, setOpen, refresh, goNew }: { open: string; setOpen: (s: string) => void; refresh: () => void; goNew: () => void }) {
  const list = useQuery({ queryKey: ["fin", "rs", "list"], queryFn: () => finGet<{ items: any[] }>("/restatements") });
  return (
    <div className="space-y-3">
      <Notice error={list.error} />
      {list.data && !list.data.items.length && (
        <p className="text-sm text-muted-foreground">No restatements yet. <button className="underline" onClick={goNew}>Create one</button> (the year must be closed first — see the Fiscal years tab).</p>
      )}
      {(list.data?.items || []).map((r) => (
        <div key={r.id} className="rounded-md border p-3 text-sm">
          <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? "" : r.id)}>
            <span className="font-medium">FY{r.fiscalYear} · {r.type.replace("_", " ")} <Badge2 tone={r.status === "posted" ? "ok" : r.status === "approved" ? "warn" : "muted"}>{r.status}</Badge2></span>
            <span className="text-xs text-muted-foreground">{treatmentLabel[r.treatment] || r.treatment} · profit effect {money(r.netProfitImpactMinor)}</span>
          </button>
          {open === r.id && <Pack id={r.id} refresh={refresh} />}
        </div>
      ))}
    </div>
  );
}

function Pack({ id, refresh }: { id: string; refresh: () => void }) {
  const q = useQuery({ queryKey: ["fin", "rs", "pack", id], queryFn: () => finGet<{ pack: any }>(`/restatements/${id}`) });
  const [by, setBy] = useState(""); const [comment, setComment] = useState(""); const [date, setDate] = useState(today());
  const approve = useMutation({ mutationFn: () => finPost(`/restatements/${id}/approve`, { approvedBy: by, comment }), onSuccess: () => { refresh(); setComment(""); } });
  const post = useMutation({ mutationFn: () => finPost<any>(`/restatements/${id}/post`, { entryDate: date }), onSuccess: refresh });
  const p = q.data?.pack;
  if (q.error) return <Notice error={q.error} />;
  if (!p) return <p className="mt-2 text-sm text-muted-foreground">Loading…</p>;
  const rows: [string, string][] = [["Revenue", "revenue"], ["Expenses", "expense"], ["Net profit", "netProfit"], ["Total assets", "assets"], ["Total liabilities", "liabilities"], ["Equity", "equity"]];
  return (
    <div className="mt-3 space-y-4">
      <div className="space-y-1">
        <p><b>Treatment:</b> {treatmentLabel[p.treatment] || p.treatment}</p>
        <p><b>What happened:</b> {p.description}</p>
        <p><b>Root cause:</b> {p.rootCause}</p>
        {p.managementExplanation && <p><b>Management explanation:</b> {p.managementExplanation}</p>}
        {p.impracticable && <p><b>Why retrospective restatement is impracticable:</b> {p.impracticable.reason}</p>}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Materiality assessment</p>
        <p>Profit effect {money(p.materiality.netProfitImpactMinor)} against a threshold of {money(p.materiality.thresholdMinor)} ({p.materiality.thresholdBps / 100}% of revenue): {p.materiality.quantitativelyMaterial ? <Badge2 tone="bad">quantitatively material</Badge2> : <Badge2 tone="ok">below threshold</Badge2>} {p.materiality.qualitativelyMaterial && <Badge2 tone="bad">qualitatively material</Badge2>}</p>
      </div>
      <Table head={["FY" + p.fiscalYear, "As originally issued", "Restated", "Effect"]}>
        {rows.map(([label, k]) => (
          <tr key={k} className="border-b"><Td>{label}</Td><Td right>{money(p.original[k])}</Td><Td right>{money(p.restated[k])}</Td><Td right className={p.impact[k] < 0 ? "text-rose-600" : ""}>{money(p.impact[k])}</Td></tr>
        ))}
      </Table>
      <p className="text-xs text-muted-foreground">Original statements preserved {p.original.preservedAt?.slice(0, 16)} and never overwritten. Both versions balance: {p.original.balanced && p.restated.balanced ? "yes" : "NO — investigate"}.</p>
      <Table head={["Account", "Name", "Originally", "Restated"]}>
        {p.accountImpact.map((a: any) => <tr key={a.accountCode} className="border-b"><Td>{a.accountCode}</Td><Td>{a.name}</Td><Td right>{money(a.originalMinor)}</Td><Td right>{money(a.restatedMinor)}</Td></tr>)}
      </Table>
      {p.treatment === "retrospective_restatement" && <p>Opening retained earnings adjustment in the current period: <b>{money(p.openingRetainedEarningsAdjustmentMinor)}</b></p>}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Approval history</p>
        {p.approvals.length ? p.approvals.map((a: any, i: number) => <p key={i}>{a.at.slice(0, 16)} · {a.approvedBy}: {a.comment}</p>) : <p className="text-muted-foreground">Not yet approved.</p>}
      </div>
      {p.status !== "posted" && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Approver" className="w-44"><Input value={by} onChange={(e) => setBy(e.target.value)} /></Field>
            <Field label="Approval comment" className="min-w-[220px] flex-1"><Input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <Button variant="outline" disabled={!by || comment.length < 3 || approve.isPending} onClick={() => approve.mutate()}>Approve</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Posting date (current open period)" className="w-52"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Button disabled={p.status !== "approved" || post.isPending} onClick={() => { if (window.confirm("Post the correcting journal? This changes current-period balances.")) post.mutate(); }}>Post correcting journal</Button>
          </div>
          <Notice error={approve.error || post.error} />
        </div>
      )}
      {p.status === "posted" && <p className="text-emerald-700">Posted {p.postedAt?.slice(0, 16)} — journal recorded in the General Journal.</p>}
    </div>
  );
}

function NewPack({ refresh, done }: { refresh: () => void; done: (id: string) => void }) {
  const years = useQuery({ queryKey: ["fin", "ye", "status"], queryFn: () => finGet<{ items: any[] }>("/year-end/status") });
  const closed = (years.data?.items || []).filter((y) => y.status === "closed");
  const [f, setF] = useState({ fy: "", type: "error", description: "", rootCause: "", explanation: "", qualitative: false, impracticable: "" });
  const [lines, setLines] = useState<Line[]>([{ account: null, debit: "", credit: "" }, { account: null, debit: "", credit: "" }]);
  const upd = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const dr = lines.reduce((t, l) => t + (Number(l.debit.replace(/,/g, "")) || 0), 0);
  const cr = lines.reduce((t, l) => t + (Number(l.credit.replace(/,/g, "")) || 0), 0);
  const m = useMutation({
    mutationFn: () => finPost<any>("/restatements", {
      fiscalYear: Number(f.fy), type: f.type, description: f.description, rootCause: f.rootCause, managementExplanation: f.explanation || undefined,
      qualitativeMaterial: f.qualitative, impracticable: f.impracticable ? { reason: f.impracticable } : undefined,
      adjustments: lines.filter((l) => l.account && (l.debit || l.credit)).map((l) => ({ accountCode: l.account!.code, debit: l.debit ? toMinor(l.debit, "GHS", "Debit") : 0, credit: l.credit ? toMinor(l.credit, "GHS", "Credit") : 0 })),
    }),
    onSuccess: (d) => { refresh(); done(d.pack.id); },
  });
  return (
    <Section title="Prepare a restatement pack" hint="Enter the correcting adjustments as they should have been recorded in the closed year (balance-sheet and P&L accounts; do not use retained earnings — it is derived). Nothing is posted until the pack is approved.">
      {years.data && !closed.length && <p className="text-sm text-amber-700">No year has been closed yet. A restatement applies to an issued (closed) year — close it on the Fiscal years tab, or correct an open year with a normal journal.</p>}
      <div className="flex flex-wrap gap-2">
        <Field label="Closed fiscal year"><select className={selectCls} value={f.fy} onChange={(e) => setF({ ...f, fy: e.target.value })}><option value="">Select…</option>{closed.map((y) => <option key={y.fiscalYear} value={y.fiscalYear}>FY{y.fiscalYear}</option>)}</select></Field>
        <Field label="Nature">
          <select className={selectCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="error">Prior-period error</option><option value="policy_change">Change in accounting policy</option><option value="estimate_change">Change in estimate (prospective)</option>
          </select>
        </Field>
      </div>
      <Field label="What happened" className="w-full"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Root cause" className="w-full"><Input value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} /></Field>
      <Field label="Management explanation (optional)" className="w-full"><Input value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} /></Field>
      <Field label="If retrospective restatement is impracticable, explain why (optional)" className="w-full"><Input value={f.impracticable} onChange={(e) => setF({ ...f, impracticable: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.qualitative} onChange={(e) => setF({ ...f, qualitative: e.target.checked })} />Qualitatively material (e.g. affects covenants, related parties, trends) even if the amount is small</label>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Adjustments (GHS)</p>
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[240px] flex-1"><AccountSelect value={l.account} onChange={(a) => upd(i, { account: a })} /></div>
            <Input className="w-32" inputMode="decimal" placeholder="Debit" value={l.debit} onChange={(e) => upd(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input className="w-32" inputMode="decimal" placeholder="Credit" value={l.credit} onChange={(e) => upd(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            {lines.length > 2 && <Button size="sm" variant="outline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setLines([...lines, { account: null, debit: "", credit: "" }])}>Add line</Button>
          <span className="text-sm">Debits {dr.toLocaleString()} · Credits {cr.toLocaleString()} {dr === cr && dr > 0 ? <Badge2 tone="ok">balanced</Badge2> : <Badge2 tone="warn">must balance</Badge2>}</span>
        </div>
      </div>
      <Button disabled={m.isPending || !f.fy || f.description.length < 3 || f.rootCause.length < 3 || dr !== cr || dr === 0} onClick={() => m.mutate()}>Prepare pack</Button>
      <Notice error={m.error} />
    </Section>
  );
}

function Years({ refresh }: { refresh: () => void }) {
  const status = useQuery({ queryKey: ["fin", "ye", "status"], queryFn: () => finGet<{ items: any[] }>("/year-end/status") });
  const [year, setYear] = useState(String(new Date().getUTCFullYear() - 1));
  const [previewYear, setPreviewYear] = useState("");
  const [reason, setReason] = useState("");
  const prev = useQuery({ queryKey: ["fin", "ye", "preview", previewYear], enabled: !!previewYear, queryFn: () => finGet<any>("/year-end/preview", { year: previewYear }) });
  const close = useMutation({ mutationFn: () => finPost<any>("/year-end/close", { year: Number(year), confirm: "CLOSE_YEAR", reason }), onSuccess: () => { refresh(); prev.refetch(); } });
  const reopen = useMutation({ mutationFn: (y: number) => finPost("/year-end/reopen", { year: y, confirm: "REOPEN_YEAR", reason }), onSuccess: refresh });
  const c = prev.data?.closing;
  return (
    <div className="space-y-4">
      <Section title="Close a fiscal year" hint="Zeroes revenue and expense accounts into retained earnings, closes owner drawings, locks all twelve months and blocks a second close. Preview first.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Fiscal year" className="w-32"><Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></Field>
          <Field label="Reason (required to close or reopen)" className="min-w-[240px] flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button variant="outline" onClick={() => { setPreviewYear(year); prev.refetch(); }}>Preview</Button>
          <Button disabled={close.isPending || previewYear !== year || !prev.data?.canClose || reason.length < 3} onClick={() => { if (window.confirm(`Close FY${year}? All its months will be locked.`)) close.mutate(); }}>Close year</Button>
        </div>
        <Notice error={prev.error || close.error} ok={close.data ? `FY${year} closed. Retained earnings now ${money(close.data.postClosing.retainedEarnings)}.` : null} />
        {prev.data && (
          <div className="space-y-2 text-sm">
            <p>Net {c.netResultMinor >= 0 ? "profit" : "loss"} to transfer: <b>{money(Math.abs(c.netResultMinor))}</b>{c.drawingsMinor ? <> · drawings closed: <b>{money(c.drawingsMinor)}</b></> : null} · closing entry {c.totals.balanced ? <Badge2 tone="ok">balanced</Badge2> : <Badge2 tone="bad">unbalanced</Badge2>}</p>
            {prev.data.blockers.map((b: any) => <p key={b.code} className="text-rose-700">✕ {b.message}</p>)}
            {prev.data.warnings.map((w: string, i: number) => <p key={i} className="text-amber-700">! {w}</p>)}
            {prev.data.canClose && <p className="text-emerald-700">✓ Ready to close.</p>}
          </div>
        )}
      </Section>
      <Section title="Year-end history">
        <Table head={["Year", "Status", "Net result", "Closed", ""]} empty={status.data && !status.data.items.length ? "No fiscal year closed yet." : undefined}>
          {(status.data?.items || []).map((y) => (
            <tr key={y.id} className="border-b">
              <Td>FY{y.fiscalYear}</Td><Td>{y.status === "closed" ? <Badge2 tone="ok">closed</Badge2> : <Badge2 tone="warn">reopened</Badge2>}</Td>
              <Td right>{money(y.netResultMinor)}</Td><Td className="text-xs text-muted-foreground">{y.closedAt?.slice(0, 16)} · {y.reason}</Td>
              <Td>{y.status === "closed" && <Button size="sm" variant="outline" disabled={reason.length < 3 || reopen.isPending} onClick={() => { if (window.confirm(`Reopen FY${y.fiscalYear}? The closing journal is reversed and its months unlock.`)) reopen.mutate(y.fiscalYear); }}>Reopen</Button>}</Td>
            </tr>
          ))}
        </Table>
        <Notice error={reopen.error} />
      </Section>
    </div>
  );
}
