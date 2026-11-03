import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost, formatMinor } from "@/lib/finance/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Mode = "accounts" | "journals" | "ledger" | "tb" | "pnl" | "bs" | "invoices" | "payments" | "audit";

export default function FinancePage({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const cur = "GHS";

  if (mode === "accounts") {
    const q = useQuery({ queryKey: ["fin", "acc"], queryFn: () => finGet<{ items: any[] }>("/accounts") });
    return (
      <Shell title="Chart of Accounts" desc="Template structure — no fabricated balances">
        <div className="space-y-1 text-sm">
          {(q.data?.items || []).map((a) => (
            <div key={a.id} className="flex justify-between border-b py-2">
              <span><code className="text-xs">{a.code}</code> {a.name}</span>
              <span className="text-xs text-muted-foreground">{a.type}</span>
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "journals") {
    const q = useQuery({ queryKey: ["fin", "je"], queryFn: () => finGet<{ items: any[] }>("/journals") });
    const [desc, setDesc] = useState("Manual journal");
    const [dCode, setDCode] = useState("5500");
    const [cCode, setCCode] = useState("1010");
    const [amount, setAmount] = useState("10000");
    const create = useMutation({
      mutationFn: () =>
        finPost("/journals", {
          description: desc,
          journalType: "general",
          post: true,
          lines: [
            { accountCode: dCode, debit: Number(amount), credit: 0 },
            { accountCode: cCode, debit: 0, credit: Number(amount) },
          ],
        }),
      onSuccess: inv,
    });
    return (
      <Shell title="Journal Entries" desc="Must balance · posted entries immutable (use reverse)">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className="min-w-[160px]" />
          <Input value={dCode} onChange={(e) => setDCode(e.target.value)} placeholder="Debit acct" className="w-24" />
          <Input value={cCode} onChange={(e) => setCCode(e.target.value)} placeholder="Credit acct" className="w-24" />
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Minor units" className="w-28" />
          <Button disabled={create.isPending} onClick={() => create.mutate()}>Post balanced journal</Button>
        </div>
        {create.isError && <p className="text-sm text-rose-600 mb-2">Rejected (check balance / accounts).</p>}
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((j) => (
            <Card key={j.id}><CardContent className="py-3">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{j.number} · {j.status}</span>
                <span className="text-xs text-muted-foreground">{j.entryDate}</span>
              </div>
              <p className="text-muted-foreground">{j.description}</p>
              <p className="text-xs">Dr {j.totals?.debit} / Cr {j.totals?.credit} {j.totals?.balanced ? "✓" : "UNBALANCED"}</p>
              {j.status === "posted" && !j.reversedBy && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => finPost(`/journals/${j.id}/reverse`, {}).then(inv)}>Reverse</Button>
              )}
            </CardContent></Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "tb") {
    const q = useQuery({ queryKey: ["fin", "tb"], queryFn: () => finGet<any>("/trial-balance") });
    return (
      <Shell title="Trial Balance" desc="Posted journals only">
        {q.data && (
          <>
            <p className={`text-sm mb-2 ${q.data.balanced ? "text-emerald-600" : "text-rose-600"}`}>
              {q.data.balanced ? "Balanced" : "Out of balance"} — Dr {q.data.totalDebit} Cr {q.data.totalCredit}
            </p>
            <div className="space-y-1 text-sm">
              {(q.data.rows || []).map((r: any) => (
                <div key={r.code} className="grid grid-cols-4 gap-2 border-b py-1">
                  <span>{r.code}</span><span>{r.name}</span>
                  <span className="tabular-nums text-right">{r.debit || ""}</span>
                  <span className="tabular-nums text-right">{r.credit || ""}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Shell>
    );
  }

  if (mode === "pnl") {
    const q = useQuery({ queryKey: ["fin", "pnl"], queryFn: () => finGet<any>("/pnl") });
    return (
      <Shell title="Profit & Loss" desc={q.data?.note || ""}>
        {q.data && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Revenue" value={formatMinor(q.data.revenue, cur)} />
            <Metric label="Expenses" value={formatMinor(q.data.expense, cur)} />
            <Metric label="Net profit" value={formatMinor(q.data.netProfit, cur)} />
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "bs") {
    const q = useQuery({ queryKey: ["fin", "bs"], queryFn: () => finGet<any>("/balance-sheet") });
    return (
      <Shell title="Balance Sheet" desc="Accounting equation check">
        {q.data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 mb-2">
              <Metric label="Assets" value={formatMinor(q.data.assets, cur)} />
              <Metric label="Liabilities" value={formatMinor(q.data.liabilities, cur)} />
              <Metric label="Equity" value={formatMinor(q.data.equity, cur)} />
            </div>
            <p className={`text-sm ${q.data.balanced ? "text-emerald-600" : "text-rose-600"}`}>{q.data.equation}</p>
          </>
        )}
      </Shell>
    );
  }

  if (mode === "invoices") {
    const q = useQuery({ queryKey: ["fin", "inv"], queryFn: () => finGet<{ items: any[] }>("/invoices") });
    const [name, setName] = useState("");
    const [amount, setAmount] = useState("1500000");
    const create = useMutation({
      mutationFn: () => finPost("/invoices", { customerName: name, amountMinor: Number(amount), revenueAccountCode: "4000" }),
      onSuccess: inv,
    });
    return (
      <Shell title="Invoices / AR" desc="Creates balanced AR + revenue journal · amount in minor units">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Amount (minor)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>Issue invoice</Button>
        </div>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((i) => (
            <Card key={i.id}><CardContent className="py-3">
              <p className="font-medium">{i.number} · {i.customerName}</p>
              <p className="text-xs text-muted-foreground">{i.issueDate} · {i.status} · {formatMinor(i.amountMinor, i.currency)} · bal {formatMinor(i.balanceMinor ?? i.amountMinor - i.amountPaidMinor, i.currency)}</p>
            </CardContent></Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "payments") {
    const invs = useQuery({ queryKey: ["fin", "inv"], queryFn: () => finGet<{ items: any[] }>("/invoices") });
    const pays = useQuery({ queryKey: ["fin", "pay"], queryFn: () => finGet<{ items: any[] }>("/payments") });
    const [invoiceId, setInvoiceId] = useState("");
    const [amount, setAmount] = useState("");
    const create = useMutation({
      mutationFn: () => finPost("/payments", { invoiceId, amountMinor: Number(amount) }),
      onSuccess: () => { inv(); setAmount(""); },
    });
    return (
      <Shell title="Customer payments" desc="Allocates to invoice · posts bank Dr / AR Cr">
        <div className="flex flex-wrap gap-2 mb-4">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">Select invoice</option>
            {(invs.data?.items || []).filter((i) => i.status !== "paid").map((i) => (
              <option key={i.id} value={i.id}>{i.number} — {i.customerName}</option>
            ))}
          </select>
          <Input placeholder="Amount minor" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          <Button disabled={!invoiceId || !amount || create.isPending} onClick={() => create.mutate()}>Record payment</Button>
        </div>
        {create.isError && <p className="text-sm text-rose-600 mb-2">Payment rejected (over-allocation or error).</p>}
        <div className="space-y-2 text-sm">
          {(pays.data?.items || []).map((p) => (
            <Card key={p.id}><CardContent className="py-3">{p.paymentDate}: {formatMinor(p.amountMinor, p.currency)} — {p.customerName}</CardContent></Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "ledger") {
    const [code, setCode] = useState("1100");
    const q = useQuery({ queryKey: ["fin", "led", code], queryFn: () => finGet<any>("/ledger", { account: code }), enabled: !!code });
    return (
      <Shell title="General Ledger" desc="Account movement from posted journals">
        <div className="flex gap-2 mb-4">
          <Input value={code} onChange={(e) => setCode(e.target.value)} className="w-28" placeholder="Account code" />
        </div>
        {q.data && (
          <>
            <p className="text-sm mb-2">Balance: {formatMinor(q.data.balance, cur)}</p>
            <div className="space-y-1 text-sm">
              {(q.data.lines || []).map((l: any, i: number) => (
                <div key={i} className="grid grid-cols-5 gap-2 border-b py-1 text-xs">
                  <span>{l.date}</span><span>{l.journalNumber}</span><span className="truncate">{l.description}</span>
                  <span className="text-right">{l.debit || ""}</span><span className="text-right">{l.credit || ""}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Shell>
    );
  }

  // audit
  const q = useQuery({ queryKey: ["fin", "audit"], queryFn: () => finGet<{ items: any[] }>("/audit") });
  return (
    <Shell title="Audit trail" desc="Immutable event log for finance actions">
      <div className="space-y-1 text-sm">
        {(q.data?.items || []).map((a) => (
          <div key={a.id} className="border-b py-2 text-xs">
            <span className="text-muted-foreground">{a.createdAt}</span> · {a.action} · {a.entityType}/{a.entityId.slice(0, 8)} {a.detail}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Shell({ title, desc, children }: { title: string; desc: string; children: import("react").ReactNode }) {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div><h1 className="text-xl font-semibold">{title}</h1><p className="text-sm text-muted-foreground">{desc}</p></div>
      {children}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="pt-4"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p></CardContent></Card>;
}
