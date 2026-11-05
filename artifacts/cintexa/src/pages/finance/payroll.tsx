import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost } from "@/lib/finance/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge2, Field, Notice, Page, Section, Table, Td, TabBar, money, previousMonth, selectCls, toMinor, today } from "@/components/finance/engine-ui";

type Tab = "runs" | "employees" | "rules";

export default function PayrollPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const [tab, setTab] = useState<Tab>("runs");
  const rules = useQuery({ queryKey: ["fin", "payroll", "rules"], queryFn: () => finGet<{ items: any[] }>("/payroll/rules") });
  const noRules = rules.data && !rules.data.items.length;
  return (
    <Page title="Payroll accounting" desc="Statutory rates are effective-dated settings you enter from the current GRA / SSNIT schedule — never built into the software. Approved payroll posts salaries, PAYE, pension and net pay payable; payment clears net pay.">
      {noRules && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          No statutory rule is configured, so payroll cannot be calculated. Add one on the <button className="underline" onClick={() => setTab("rules")}>Statutory rules</button> tab first.
        </div>
      )}
      <TabBar<Tab> value={tab} onChange={setTab} tabs={[{ key: "runs", label: "Payroll runs" }, { key: "employees", label: "Employees" }, { key: "rules", label: "Statutory rules" }]} />
      {tab === "runs" && <Runs refresh={refresh} />}
      {tab === "employees" && <Employees refresh={refresh} />}
      {tab === "rules" && <Rules refresh={refresh} />}
    </Page>
  );
}

function Rules({ refresh }: { refresh: () => void }) {
  const q = useQuery({ queryKey: ["fin", "payroll", "rules"], queryFn: () => finGet<{ items: any[] }>("/payroll/rules") });
  const [f, setF] = useState({ effectiveFrom: today(), ee: "", er: "", base: "basic", deductible: true, source: "" });
  const [bands, setBands] = useState([{ upTo: "", rate: "" }]);
  const m = useMutation({
    mutationFn: () => {
      const payeBands = bands.map((b, i) => ({
        upToMinor: i === bands.length - 1 ? null : toMinor(b.upTo, "GHS", `Band ${i + 1} upper limit`),
        rateBps: Math.round(Number(b.rate) * 100),
      }));
      if (payeBands.some((b) => !Number.isFinite(b.rateBps))) throw new Error("Enter a rate for every band.");
      return finPost("/payroll/rules", { effectiveFrom: f.effectiveFrom, employeePensionBps: Math.round(Number(f.ee) * 100), employerPensionBps: Math.round(Number(f.er) * 100), pensionBase: f.base, pensionDeductibleForPaye: f.deductible, source: f.source, payeBands });
    },
    onSuccess: refresh,
  });
  return (
    <div className="space-y-4">
      <Section title="Add statutory rule" hint="Enter the figures from the current official schedule. When rates change, add a new rule with a new effective date; earlier months keep the rule that applied to them.">
        <div className="flex flex-wrap gap-2">
          <Field label="Effective from"><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
          <Field label="Employee pension (%)"><Input inputMode="decimal" value={f.ee} onChange={(e) => setF({ ...f, ee: e.target.value })} /></Field>
          <Field label="Employer pension (%)"><Input inputMode="decimal" value={f.er} onChange={(e) => setF({ ...f, er: e.target.value })} /></Field>
          <Field label="Pension calculated on">
            <select className={selectCls} value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}><option value="basic">Basic salary</option><option value="gross">Gross pay</option></select>
          </Field>
          <Field label="Source (required)"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="e.g. GRA PAYE schedule, <date>" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.deductible} onChange={(e) => setF({ ...f, deductible: e.target.checked })} />Employee pension is deducted before PAYE</label>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Monthly PAYE bands, lowest first. The last band has no upper limit.</p>
          {bands.map((b, i) => {
            const last = i === bands.length - 1;
            return (
              <div key={i} className="mb-2 flex flex-wrap items-end gap-2">
                <Field label={last ? "Band (remaining income)" : "Band up to (GHS / month)"} className="w-48">
                  <Input disabled={last} inputMode="decimal" value={last ? "" : b.upTo} placeholder={last ? "no limit" : ""} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
                </Field>
                <Field label="Rate (%)" className="w-28"><Input inputMode="decimal" value={b.rate} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></Field>
                {bands.length > 1 && <Button size="sm" variant="outline" onClick={() => setBands(bands.filter((_, j) => j !== i))}>Remove</Button>}
              </div>
            );
          })}
          <Button size="sm" variant="outline" onClick={() => setBands([...bands.slice(0, -1), { upTo: "", rate: "" }, bands[bands.length - 1]!])}>Add band</Button>
        </div>
        <Button disabled={m.isPending || !f.ee || !f.er || !f.source} onClick={() => m.mutate()}>Save rule</Button>
        <Notice error={m.error} ok={m.isSuccess ? "Rule saved." : null} />
      </Section>
      <Section title="Rules on file">
        <Table head={["Effective from", "Employee %", "Employer %", "Base", "Bands", "Source"]} empty={q.data && !q.data.items.length ? "No rules yet." : undefined}>
          {(q.data?.items || []).map((r) => (
            <tr key={r.id} className="border-b align-top">
              <Td>{r.effectiveFrom}</Td><Td right>{r.employeePensionBps / 100}</Td><Td right>{r.employerPensionBps / 100}</Td><Td>{r.pensionBase}</Td>
              <Td className="text-xs">{r.payeBands.map((b: any, i: number) => <div key={i}>{b.upToMinor == null ? "remainder" : `to ${money(b.upToMinor)}`} @ {b.rateBps / 100}%</div>)}</Td>
              <Td className="text-xs text-muted-foreground">{r.source}</Td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function Employees({ refresh }: { refresh: () => void }) {
  const q = useQuery({ queryKey: ["fin", "payroll", "employees"], queryFn: () => finGet<{ items: any[] }>("/payroll/employees") });
  const [f, setF] = useState({ name: "", basic: "", enrolled: true });
  const [allow, setAllow] = useState<{ name: string; amount: string }[]>([]);
  const m = useMutation({
    mutationFn: () => finPost("/payroll/employees", {
      name: f.name, basicMinor: toMinor(f.basic, "GHS", "Monthly basic"), pensionEnrolled: f.enrolled,
      allowances: Object.fromEntries(allow.filter((a) => a.name && a.amount).map((a) => [a.name, toMinor(a.amount, "GHS", `Allowance ${a.name}`)])),
    }),
    onSuccess: () => { refresh(); setF({ name: "", basic: "", enrolled: true }); setAllow([]); },
  });
  return (
    <div className="space-y-4">
      <Section title="Add employee" hint="Payroll data is sensitive. This system has no login, so anyone who can open this page can see it.">
        <div className="flex flex-wrap gap-2">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Monthly basic (GHS)"><Input inputMode="decimal" value={f.basic} onChange={(e) => setF({ ...f, basic: e.target.value })} /></Field>
        </div>
        {allow.map((a, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label="Allowance name" className="w-48"><Input value={a.name} onChange={(e) => setAllow(allow.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Field>
            <Field label="Monthly amount (GHS)" className="w-40"><Input inputMode="decimal" value={a.amount} onChange={(e) => setAllow(allow.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} /></Field>
            <Button size="sm" variant="outline" onClick={() => setAllow(allow.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setAllow([...allow, { name: "", amount: "" }])}>Add allowance</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enrolled} onChange={(e) => setF({ ...f, enrolled: e.target.checked })} />Enrolled in pension</label>
        </div>
        <Button disabled={m.isPending || !f.name || !f.basic} onClick={() => m.mutate()}>Add employee</Button>
        <Notice error={m.error} />
      </Section>
      <Section title="Employees">
        <Table head={["Name", "Basic / month", "Allowances", "Pension"]} empty={q.data && !q.data.items.length ? "No employees yet." : undefined}>
          {(q.data?.items || []).map((e) => (
            <tr key={e.id} className="border-b">
              <Td>{e.name}</Td><Td right>{money(e.basicMinor)}</Td>
              <Td className="text-xs">{Object.entries(e.allowances || {}).map(([k, v]) => `${k}: ${money(Number(v))}`).join(" · ") || "—"}</Td>
              <Td>{e.pensionEnrolled ? "enrolled" : "not enrolled"}</Td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function Runs({ refresh }: { refresh: () => void }) {
  const runs = useQuery({ queryKey: ["fin", "payroll", "runs"], queryFn: () => finGet<{ items: any[] }>("/payroll/runs") });
  const emps = useQuery({ queryKey: ["fin", "payroll", "employees"], queryFn: () => finGet<{ items: any[] }>("/payroll/employees") });
  const [ym, setYm] = useState(previousMonth());
  const [adj, setAdj] = useState<Record<string, { overtime: string; bonus: string; commission: string; other: string }>>({});
  const [showAdj, setShowAdj] = useState(false);
  const [approver, setApprover] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [bank, setBank] = useState("1030");
  const [open, setOpen] = useState<string>("");
  const create = useMutation({
    mutationFn: () => {
      const adjustments = Object.entries(adj).map(([employeeId, a]) => ({
        employeeId,
        overtimeMinor: a.overtime ? toMinor(a.overtime, "GHS", "Overtime") : 0, bonusMinor: a.bonus ? toMinor(a.bonus, "GHS", "Bonus") : 0,
        commissionMinor: a.commission ? toMinor(a.commission, "GHS", "Commission") : 0, otherDeductionsMinor: a.other ? toMinor(a.other, "GHS", "Deductions") : 0,
      }));
      return finPost<any>("/payroll/runs", { periodYm: ym, adjustments });
    },
    onSuccess: (d) => { refresh(); setOpen(d.run.id); },
  });
  const approve = useMutation({ mutationFn: (id: string) => finPost(`/payroll/runs/${id}/approve`, { approvedBy: approver }), onSuccess: refresh });
  const pay = useMutation({ mutationFn: (id: string) => finPost(`/payroll/runs/${id}/pay`, { date: payDate, bankCode: bank }), onSuccess: refresh });
  const tone = (s: string) => (s === "paid" ? "ok" : s === "approved" ? "warn" : "muted");
  const setA = (id: string, k: string, v: string) => setAdj((s) => ({ ...s, [id]: { ...(s[id] ?? { overtime: "", bonus: "", commission: "", other: "" }), [k]: v } }));
  return (
    <div className="space-y-4">
      <Section title="Calculate payroll" hint="One run per month. Calculation uses the statutory rule in force on the last day of the month.">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Period (YYYY-MM)" className="w-40"><Input value={ym} onChange={(e) => setYm(e.target.value)} /></Field>
          <Button variant="outline" onClick={() => setShowAdj(!showAdj)}>{showAdj ? "Hide" : "Add"} overtime / bonus / deductions</Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>Calculate</Button>
        </div>
        {showAdj && (
          <Table head={["Employee", "Overtime", "Bonus", "Commission", "Other deductions"]} empty={emps.data && !emps.data.items.length ? "Add employees first." : undefined}>
            {(emps.data?.items || []).map((e) => (
              <tr key={e.id} className="border-b">
                <Td>{e.name}</Td>
                {(["overtime", "bonus", "commission", "other"] as const).map((k) => <Td key={k}><Input className="h-8 w-28" inputMode="decimal" value={adj[e.id]?.[k] || ""} onChange={(ev) => setA(e.id, k, ev.target.value)} /></Td>)}
              </tr>
            ))}
          </Table>
        )}
        <Notice error={create.error} />
      </Section>
      <Section title="Payroll runs">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Approver name" className="w-48"><Input value={approver} onChange={(e) => setApprover(e.target.value)} /></Field>
          <Field label="Payment date" className="w-40"><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
          <Field label="Bank account code" className="w-36"><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        </div>
        <Notice error={approve.error || pay.error} />
        {(runs.data?.items || []).map((r) => (
          <div key={r.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="text-left font-medium" onClick={() => setOpen(open === r.id ? "" : r.id)}>{r.periodYm} <Badge2 tone={tone(r.status) as any}>{r.status}</Badge2></button>
              <span className="tabular-nums">Gross {money(r.totals.gross)} · PAYE {money(r.totals.paye)} · Net {money(r.totals.net)}</span>
              <div className="flex gap-2">
                {r.status === "calculated" && <Button size="sm" disabled={!approver || approve.isPending} onClick={() => { if (window.confirm(`Approve and post payroll for ${r.periodYm}?`)) approve.mutate(r.id); }}>Approve & post</Button>}
                {r.status === "approved" && <Button size="sm" disabled={pay.isPending} onClick={() => { if (window.confirm(`Record payment of net salaries ${money(r.totals.net)}?`)) pay.mutate(r.id); }}>Record payment</Button>}
              </div>
            </div>
            {open === r.id && (
              <div className="mt-3">
                <Table head={["Employee", "Gross", "Employee pension", "PAYE", "Other", "Net pay", "Employer pension"]}>
                  {r.lines.map((l: any) => (
                    <tr key={l.employeeId} className="border-b"><Td>{l.name}</Td><Td right>{money(l.gross)}</Td><Td right>{money(l.employeePension)}</Td><Td right>{money(l.paye)}</Td><Td right>{money(l.otherDeductions)}</Td><Td right>{money(l.net)}</Td><Td right>{money(l.employerPension)}</Td></tr>
                  ))}
                  <tr className="font-medium"><Td>Total</Td><Td right>{money(r.totals.gross)}</Td><Td right>{money(r.totals.employeePension)}</Td><Td right>{money(r.totals.paye)}</Td><Td right>{money(r.totals.otherDeductions)}</Td><Td right>{money(r.totals.net)}</Td><Td right>{money(r.totals.employerPension)}</Td></tr>
                </Table>
                {r.approvedBy && <p className="mt-2 text-xs text-muted-foreground">Approved by {r.approvedBy} · {r.approvedAt?.slice(0, 16)}</p>}
              </div>
            )}
          </div>
        ))}
        {runs.data && !runs.data.items.length && <p className="text-sm text-muted-foreground">No payroll runs yet.</p>}
      </Section>
    </div>
  );
}
