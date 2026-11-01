import { Fragment, useState } from "react";
import { PageHeader, Panel, QueryBoundary, Field, Input, FilterBar, EmptyState, StatusBadge } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fmtMoney, todayYmd } from "@/lib/finance/api";
import { useFinanceQuery } from "@/lib/finance/hooks";

interface Item { party_id: number; party_name: string; current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; total: string; documents: { id: number; number: string; due_date: string; days_past_due: number; outstanding: string }[] }
interface Ageing { as_of: string; items: Item[]; totals: Record<string, string>; control_account_balance: string; difference: string; reconciled: boolean }
const COLS: [keyof Item, string][] = [["current", "Not yet due"], ["d1_30", "1–30 days"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "90+ days"]];

export function AgeingPage({ kind }: { kind: "receivables" | "payables" }) {
  const { currency } = useFinance();
  const [asOf, setAsOf] = useState(todayYmd()); const [open, setOpen] = useState<number | null>(null);
  const q = useFinanceQuery<Ageing>(`/${kind}/ageing`, { as_of: asOf });
  return (
    <>
      <PageHeader title={kind === "receivables" ? "Receivables ageing" : "Payables ageing"} description={`Outstanding ${kind === "receivables" ? "customer invoices" : "supplier bills"} by days past due as at the chosen date. The total is checked against the general-ledger control account.`} />
      <FilterBar><Field label="As at" className="mb-0"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field></FilterBar>
      <Panel flush><QueryBoundary q={q}>{(d) => (<>
        <div role="status" className={`border-b px-4 py-2 text-sm ${d.reconciled ? "text-emerald-500" : "font-semibold text-amber-500"}`}>
          {d.reconciled ? <>Agrees to the ledger control account <StatusBadge status="balanced" /></> : `Differs from the ledger control account (${fmtMoney(d.control_account_balance, currency)}) by ${fmtMoney(d.difference, currency)} - manual journals have been posted to the control account.`}
        </div>
        {d.items.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Ageing</caption>
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="px-3 py-2">{kind === "receivables" ? "Customer" : "Supplier"}</th>{COLS.map(([, l]) => <th key={l} className="px-2 text-right">{l}</th>)}<th className="px-3 text-right">Total</th></tr></thead>
            <tbody>{d.items.map((r) => (<Fragment key={r.party_id}>
              <tr className="cursor-pointer border-b hover:bg-secondary/40" onClick={() => setOpen(open === r.party_id ? null : r.party_id)}><td className="px-3 py-2 font-medium">{r.party_name}</td>{COLS.map(([k]) => <td key={k} className="px-2 text-right tabular-nums">{Number(r[k]) ? fmtMoney(r[k] as string, currency) : ""}</td>)}<td className="px-3 text-right font-semibold tabular-nums">{fmtMoney(r.total, currency)}</td></tr>
              {open === r.party_id && r.documents.map((x) => <tr key={`d${x.id}`} className="border-b bg-secondary/20 text-xs"><td className="py-1.5 pl-6 font-mono" colSpan={4}>{x.number} · due {x.due_date}</td><td colSpan={2} className="text-right text-muted-foreground">{x.days_past_due ? `${x.days_past_due} days past due` : "not yet due"}</td><td colSpan={2} className="px-3 text-right tabular-nums">{fmtMoney(x.outstanding, currency)}</td></tr>)}
            </Fragment>))}</tbody>
            <tfoot><tr className="font-semibold"><td className="px-3 py-2">Total</td>{COLS.map(([k]) => <td key={k} className="px-2 text-right tabular-nums">{fmtMoney(d.totals[k as string], currency)}</td>)}<td className="px-3 text-right tabular-nums">{fmtMoney(d.totals.total, currency)}</td></tr></tfoot></table></div>)}
      </>)}</QueryBoundary></Panel>
    </>
  );
}
