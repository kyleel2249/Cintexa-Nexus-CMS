import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, QueryBoundary, Field, Input, Select, FilterBar, DataTable, EmptyState, StatusBadge } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, fmtMoney, todayYmd } from "@/lib/finance/api";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { useToast } from "@/hooks/use-toast";

interface Row { account_id: number; code: string; name: string; type: string; debit_balance: string; credit_balance: string; opening_balance?: string; opening_side?: string; movement_debit?: string; movement_credit?: string }
interface Tb { as_of: string; basis: string; rows: Row[]; total_debit: string; total_credit: string; balanced: boolean; difference: string }
const BASES = [["unadjusted", "Unadjusted (before adjusting entries)"], ["adjusted", "Adjusted (before closing entries)"], ["post_closing", "Post-closing"]];

export default function TrialBalancePage() {
  const { can, currency } = useFinance();
  const { toast } = useToast();
  const [asOf, setAsOf] = useState(todayYmd()); const [basis, setBasis] = useState("adjusted"); const [from, setFrom] = useState(""); const [cmp, setCmp] = useState("");
  const q = useFinanceQuery<{ trial_balance: Tb; comparative?: Tb }>("/trial-balance", { as_of: asOf, basis, from, compare_as_of: cmp });
  const exportCsv = async () => { try { await fin.download("/trial-balance", { as_of: asOf, basis }, "trial-balance.csv"); } catch (e) { toast({ title: e instanceof Error ? e.message : "Export failed", variant: "destructive" }); } };
  const cmpMap = new Map((q.data?.comparative?.rows ?? []).map((r) => [r.account_id, r]));
  return (
    <>
      <PageHeader title="Trial balance" description="Built from posted ledger entries. If debits and credits ever differ the page says so loudly - that would indicate a data-integrity fault."
        actions={can("reports:export") ? <Button size="sm" variant="outline" onClick={() => void exportCsv()}><Download className="mr-1.5 h-3.5 w-3.5" />Export CSV</Button> : undefined} />
      <FilterBar>
        <Field label="As of" className="mb-0"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <Field label="Basis" className="mb-0"><Select value={basis} onChange={(e) => setBasis(e.target.value)} className="w-72">{BASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Show movement from" className="mb-0"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Compare with date" className="mb-0"><Input type="date" value={cmp} onChange={(e) => setCmp(e.target.value)} /></Field>
      </FilterBar>
      <Panel flush>
        <QueryBoundary q={q}>{({ trial_balance: t, comparative }) => (<>
          <div role="status" className={`border-b px-4 py-2 text-sm ${t.balanced ? "text-emerald-500" : "font-semibold text-rose-500"}`}>{t.balanced ? <>Balanced <StatusBadge status="balanced" /></> : `OUT OF BALANCE by ${fmtMoney(t.difference, currency)}`}</div>
          <DataTable caption="Trial balance" rows={t.rows} rowKey={(r) => r.account_id} empty={<EmptyState title="No posted activity yet" description="Post journals to see balances." />} columns={[
            { key: "c", header: "Code", render: (r: Row) => <span className="font-mono">{r.code}</span> }, { key: "n", header: "Account", render: (r: Row) => r.name },
            ...(from ? [{ key: "o", header: "Opening", align: "right" as const, render: (r: Row) => `${fmtMoney(r.opening_balance, currency)} ${r.opening_side === "credit" ? "Cr" : "Dr"}` }, { key: "md", header: "Period Dr", align: "right" as const, render: (r: Row) => fmtMoney(r.movement_debit, currency) }, { key: "mc", header: "Period Cr", align: "right" as const, render: (r: Row) => fmtMoney(r.movement_credit, currency) }] : []),
            { key: "d", header: "Debit", align: "right", render: (r: Row) => (Number(r.debit_balance) ? fmtMoney(r.debit_balance, currency) : "") },
            { key: "k", header: "Credit", align: "right", render: (r: Row) => (Number(r.credit_balance) ? fmtMoney(r.credit_balance, currency) : "") },
            ...(comparative ? [{ key: "p", header: `Net at ${comparative.as_of}`, align: "right" as const, render: (r: Row) => { const p = cmpMap.get(r.account_id); return p ? fmtMoney(String(Number(p.debit_balance) - Number(p.credit_balance)), currency) : fmtMoney("0", currency); } }] : []),
          ]} />
          <div className="flex justify-end gap-8 border-t px-4 py-3 text-sm font-semibold tabular-nums"><span>Total debit {fmtMoney(t.total_debit, currency)}</span><span>Total credit {fmtMoney(t.total_credit, currency)}</span></div>
        </>)}</QueryBoundary>
      </Panel>
    </>
  );
}
