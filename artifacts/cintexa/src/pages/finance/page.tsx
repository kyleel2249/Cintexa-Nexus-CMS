import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost, formatMinor, formatCurrency } from "@/lib/finance/api";

import { AccountSelect, type AccountOption } from "@/components/finance/AccountSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Mode = "accounts" | "journals" | "ledger" | "tb" | "pnl" | "bs" | "invoices" | "payments" | "discounts" | "audit";

interface DraftLine {
  key: string;
  account: AccountOption | null;
  memo: string;
  debit: string;
  credit: string;
}

export default function FinancePage({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const cur = "GHS";

  if (mode === "accounts") {
    const q = useQuery({ queryKey: ["fin", "acc"], queryFn: () => finGet<{ items: any[] }>("/accounts") });
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [type, setType] = useState("revenue");
    const create = useMutation({
      mutationFn: () => finPost("/accounts", { code, name, type }),
      onSuccess: () => {
        inv();
        setCode("");
        setName("");
        qc.invalidateQueries({ queryKey: ["fin", "acc-search"] });
      },
    });
    return (
      <Shell title="Chart of Accounts" desc="Authoritative account list for all journal dropdowns · new accounts appear immediately">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Code e.g. 4500" value={code} onChange={(e) => setCode(e.target.value)} className="w-28" />
          <Input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} className="min-w-[180px]" />
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            {["asset", "liability", "equity", "revenue", "expense"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Button disabled={!code || !name || create.isPending} onClick={() => create.mutate()}>Add account</Button>
        </div>
        {create.isError && <p className="text-sm text-rose-600 mb-2">Could not create (duplicate code?).</p>}
        <div className="space-y-1 text-sm max-h-[60vh] overflow-auto">
          {(q.data?.items || []).map((a) => (
            <div key={a.id} className="flex justify-between gap-2 border-b py-2">
              <span><code className="text-xs">{a.code}</code> {a.name}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground capitalize">
                {a.type}
                {a.active === false && <span className="text-rose-500">inactive</span>}
                {a.active !== false && (
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => finPost(`/accounts/${a.id}/deactivate`, {}).then(inv)}>
                    Deactivate
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "journals") {
    return <JournalWorkspace onPosted={inv} />;
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
              {!(q.data.rows || []).length && <p className="text-muted-foreground">No posted activity yet.</p>}
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Gross revenue" value={formatCurrency(q.data.grossRevenue ?? q.data.revenue, cur)} />
            <Metric label="Discount Allowed" value={formatCurrency(q.data.discountAllowed || 0, cur)} />
            <Metric label="Net revenue" value={formatCurrency(q.data.netRevenue ?? q.data.revenue, cur)} />
            <Metric label="Expenses" value={formatCurrency(q.data.expense, cur)} />
            <Metric label="Discount Received" value={formatCurrency(q.data.discountReceived || 0, cur)} />
            <Metric label="Net profit" value={formatCurrency(q.data.netProfit, cur)} />

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
              <Metric label="Assets" value={formatCurrency(q.data.assets, cur)} />
              <Metric label="Liabilities" value={formatCurrency(q.data.liabilities, cur)} />
              <Metric label="Equity" value={formatCurrency(q.data.equity, cur)} />

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
    const [rev, setRev] = useState<AccountOption | null>(null);
    const create = useMutation({
      mutationFn: () =>
        finPost("/invoices", {
          customerName: name,
          amountMinor: Number(amount),
          revenueAccountCode: rev?.code || "4020",
        }),
      onSuccess: inv,
    });
    return (
      <Shell title="Invoices / AR" desc="Posts Dr 1050 AR / Cr selected revenue · minor units">
        <div className="grid gap-2 mb-4 sm:grid-cols-2">
          <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Amount (minor)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <AccountSelect value={rev} onChange={setRev} placeholder="Revenue account (search)…" />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>Issue invoice</Button>
        </div>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((i) => (
            <Card key={i.id}><CardContent className="py-3">
              <p className="font-medium">{i.number} · {i.customerName}</p>
              <p className="text-xs text-muted-foreground">{i.issueDate} · {i.status} · {formatMinor(i.amountMinor, i.currency)}</p>
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
      mutationFn: () => finPost("/payments", { invoiceId, amountMinor: Number(amount), bankAccountCode: "1030" }),
      onSuccess: () => { inv(); setAmount(""); },
    });
    return (
      <Shell title="Customer payments" desc="Dr Bank 1030 / Cr AR 1050 · no double revenue">
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
        {create.isError && <p className="text-sm text-rose-600 mb-2">Payment rejected.</p>}
        <div className="space-y-2 text-sm">
          {(pays.data?.items || []).map((p) => (
            <Card key={p.id}><CardContent className="py-3">{p.paymentDate}: {formatMinor(p.amountMinor, p.currency)} — {p.customerName}</CardContent></Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "ledger") {
    const [acc, setAcc] = useState<AccountOption | null>(null);
    const q = useQuery({
      queryKey: ["fin", "led", acc?.code],
      queryFn: () => finGet<any>("/ledger", { account: acc!.code }),
      enabled: !!acc?.code,
    });
    return (
      <Shell title="General Ledger" desc="Pick any COA account — movements from posted journals">
        <AccountSelect value={acc} onChange={setAcc} className="mb-4 max-w-md" />
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


  if (mode === "discounts") {
    return <DiscountsWorkspace onDone={inv} />;
  }

  const q = useQuery({ queryKey: ["fin", "audit"], queryFn: () => finGet<{ items: any[] }>("/audit") });
  return (
    <Shell title="Audit trail" desc="Finance action log">
      <div className="space-y-1 text-sm">
        {(q.data?.items || []).map((a) => (
          <div key={a.id} className="border-b py-2 text-xs">
            <span className="text-muted-foreground">{a.createdAt}</span> · {a.action} · {a.entityType}/{String(a.entityId).slice(0, 8)} {a.detail}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function JournalWorkspace({ onPosted }: { onPosted: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["fin", "je"], queryFn: () => finGet<{ items: any[] }>("/journals") });
  const [desc, setDesc] = useState("");
  const [journalType, setJournalType] = useState("general");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([
    { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
    { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
  ]);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) {
      d += Math.round(Number(l.debit) || 0);
      c += Math.round(Number(l.credit) || 0);
    }
    return { debit: d, credit: c, difference: d - c, balanced: d === c && d > 0 };
  }, [lines]);

  const post = useMutation({
    mutationFn: () =>
      finPost("/journals", {
        description: desc || `${journalType} journal`,
        journalType,
        entryDate,
        post: true,
        lines: lines
          .filter((l) => l.account && (Number(l.debit) || Number(l.credit)))
          .map((l) => ({
            accountCode: l.account!.code,
            memo: l.memo,
            debit: Math.round(Number(l.debit) || 0),
            credit: Math.round(Number(l.credit) || 0),
          })),
      }),
    onSuccess: () => {
      onPosted();
      qc.invalidateQueries({ queryKey: ["fin", "je"] });
      setDesc("");
      setLines([
        { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
        { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
      ]);
    },
  });

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  return (
    <Shell title="General Journal / Journal Entries" desc="Searchable Chart of Accounts on every line · posts only when balanced">
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div>
          <label className="text-xs text-muted-foreground">Journal type</label>
          <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={journalType} onChange={(e) => setJournalType(e.target.value)}>
            {["general", "sales", "purchase", "cash_receipt", "cash_payment", "bank", "payroll", "adjustment", "depreciation", "reversal"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Entry date</label>
          <Input type="date" className="mt-1" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Description</label>
          <Input className="mt-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Narration" />
        </div>
      </div>

      <div className="mb-2 hidden grid-cols-12 gap-2 text-[11px] uppercase text-muted-foreground sm:grid">
        <div className="col-span-5">Account</div>
        <div className="col-span-3">Memo</div>
        <div className="col-span-1 text-right">Debit</div>
        <div className="col-span-1 text-right">Credit</div>
        <div className="col-span-2" />
      </div>

      <div className="space-y-3 mb-4">
        {lines.map((l) => (
          <div key={l.key} className="grid gap-2 sm:grid-cols-12 items-start">
            <div className="sm:col-span-5">
              <AccountSelect value={l.account} onChange={(a) => updateLine(l.key, { account: a })} />
            </div>
            <div className="sm:col-span-3">
              <Input placeholder="Line memo" value={l.memo} onChange={(e) => updateLine(l.key, { memo: e.target.value })} />
            </div>
            <div className="sm:col-span-1">
              <Input className="text-right" placeholder="0" value={l.debit} onChange={(e) => updateLine(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            </div>
            <div className="sm:col-span-1">
              <Input className="text-right" placeholder="0" value={l.credit} onChange={(e) => updateLine(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>Remove</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" }])}>
          Add line
        </Button>
        <div className="text-sm tabular-nums">
          Dr <strong>{totals.debit}</strong> · Cr <strong>{totals.credit}</strong> · Diff{" "}
          <strong className={totals.difference === 0 ? "text-emerald-600" : "text-rose-600"}>{totals.difference}</strong>
        </div>
        <Button disabled={!totals.balanced || post.isPending} onClick={() => post.mutate()}>
          {post.isPending ? "Posting…" : "Post balanced journal"}
        </Button>
      </div>
      {post.isError && <p className="text-sm text-rose-600 mb-4">Post rejected — check balance and accounts.</p>}

      <h2 className="text-sm font-semibold mb-2">Posted / draft journals</h2>
      <div className="space-y-2 text-sm">
        {(list.data?.items || []).map((j) => (
          <Card key={j.id}><CardContent className="py-3">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{j.number} · {j.journalType} · {j.status}</span>
              <span className="text-xs text-muted-foreground">{j.entryDate}</span>
            </div>
            <p className="text-muted-foreground">{j.description}</p>
            <p className="text-xs">Dr {j.totals?.debit} / Cr {j.totals?.credit}</p>
            <ul className="mt-1 text-xs text-muted-foreground">
              {(j.lines || []).map((ln: any) => (
                <li key={ln.id}>{ln.accountCode} Dr {ln.debit} Cr {ln.credit}</li>
              ))}
            </ul>
            {j.status === "posted" && !j.reversedBy && (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => finPost(`/journals/${j.id}/reverse`, {}).then(() => { onPosted(); qc.invalidateQueries({ queryKey: ["fin", "je"] }); })}>
                Reverse
              </Button>
            )}
          </CardContent></Card>
        ))}
      </div>
    </Shell>
  );
}


function DiscountsWorkspace({ onDone }: { onDone: () => void }) {
  const [customer, setCustomer] = useState("");
  const [gross, setGross] = useState("1000000");
  const [disc, setDisc] = useState("50000");
  const [revAcc, setRevAcc] = useState<AccountOption | null>(null);
  const [discAcc, setDiscAcc] = useState<AccountOption | null>(null);
  const [msg, setMsg] = useState("");
  const invDisc = useMutation({
    mutationFn: () =>
      finPost<any>("/invoices/with-discount", {
        customerName: customer,
        grossMinor: Number(gross),
        discountMinor: Number(disc),
        revenueAccountCode: revAcc?.code || "4230",
        discountAccountCode: discAcc?.code || "4320",
      }),
    onSuccess: (r) => {
      setMsg(`Invoice ${r.invoice?.number}: gross ${r.gross} disc ${r.discount} net ${r.net}`);
      onDone();
    },
    onError: () => setMsg("Invoice with discount failed"),
  });
  const [expGross, setExpGross] = useState("500000");
  const [expDisc, setExpDisc] = useState("25000");
  const [expAcc, setExpAcc] = useState<AccountOption | null>(null);
  const expMut = useMutation({
    mutationFn: () =>
      finPost<any>("/expenses/with-discount", {
        grossMinor: Number(expGross),
        discountMinor: Number(expDisc),
        expenseAccountCode: expAcc?.code || "6410",
        description: "Professional services purchase net of discount received",
      }),
    onSuccess: (r) => {
      setMsg(`Purchase JE ${r.journal?.number}: gross ${r.gross} disc received ${r.discount} net ${r.net}`);
      onDone();
    },
  });
  return (
    <Shell title="Discounts & Professional Services" desc="Discount Allowed reduces revenue; Discount Received reduces purchase cost · COA-backed">
      <Card className="mb-4"><CardContent className="pt-4 space-y-3">
        <p className="text-sm font-medium">Customer invoice with Discount Allowed</p>
        <p className="text-xs text-muted-foreground">Dr AR (net) + Dr 4320 Discount Allowed / Cr Revenue (gross)</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <Input placeholder="Gross (minor)" value={gross} onChange={(e) => setGross(e.target.value)} />
          <Input placeholder="Discount Allowed (minor)" value={disc} onChange={(e) => setDisc(e.target.value)} />
          <AccountSelect value={revAcc} onChange={setRevAcc} placeholder="Revenue account (e.g. 4230)…" />
          <AccountSelect value={discAcc} onChange={setDiscAcc} placeholder="Discount Allowed account (4320)…" />
          <Button disabled={!customer || invDisc.isPending} onClick={() => invDisc.mutate()}>Post discounted invoice</Button>
        </div>
      </CardContent></Card>
      <Card className="mb-4"><CardContent className="pt-4 space-y-3">
        <p className="text-sm font-medium">Supplier bill with Discount Received (net method)</p>
        <p className="text-xs text-muted-foreground">Dr expense (net) / Cr AP (net) — discount reduces cost, not revenue</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Gross (minor)" value={expGross} onChange={(e) => setExpGross(e.target.value)} />
          <Input placeholder="Discount Received (minor)" value={expDisc} onChange={(e) => setExpDisc(e.target.value)} />
          <AccountSelect value={expAcc} onChange={setExpAcc} placeholder="Expense account (e.g. 6410)…" />
          <Button disabled={expMut.isPending} onClick={() => expMut.mutate()}>Post purchase with discount</Button>
        </div>
      </CardContent></Card>
      {msg && <p className="text-sm text-emerald-700 dark:text-emerald-400">{msg}</p>}
      <p className="text-xs text-muted-foreground">
        Accounts 432x, 516x, 423x, 641x are in the central Chart of Accounts and appear in every journal AccountSelect search.
      </p>
    </Shell>
  );
}

function Shell({ title, desc, children }: { title: string; desc: string; children: import("react").ReactNode }) {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs uppercase text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
