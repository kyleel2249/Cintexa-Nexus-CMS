import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost, finDelete, formatMinor, formatCurrency, majorToMinor, minorToMajor } from "@/lib/finance/api";
import {
  generateDocumentation,
  explainAccount,
  type DocumentationResult,
} from "@/lib/finance/documentation-engine";
import {
  narrativeForFinanceInvoice,
  narrativeForFinancePayment,
} from "@/lib/finance/sales-narratives";



import { AccountSelect, type AccountOption } from "@/components/finance/AccountSelect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";


type Mode = "accounts" | "journals" | "ledger" | "tb" | "pnl" | "bs" | "invoices" | "payments" | "discounts" | "audit" | "assets" | "integrity" | "periods";

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


  if (mode === "assets") {
    const q = useQuery({ queryKey: ["fin", "assets"], queryFn: () => finGet<{ items: any[] }>("/assets") });
    const [name, setName] = useState("");
    const [cost, setCost] = useState("8000");
    const [cat, setCat] = useState("laptop");
    const create = useMutation({
      mutationFn: () =>
        finPost("/assets", {
          name,
          category: cat,
          costMinor: majorToMinor(Number(cost) || 0),
          residualMinor: 0,
        }),
      onSuccess: inv,
    });
    const runDep = useMutation({
      mutationFn: () => finPost("/assets/depreciate", {}),
      onSuccess: inv,
    });
    return (
      <Shell title="Fixed assets & depreciation" desc="Computers/laptops: mandatory 25% p.a. straight-line accounting depreciation (not Ghana tax capital allowance). Amounts in major units on entry.">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Asset name e.g. Dell Laptop" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="laptop">Laptop</option>
            <option value="computer">Desktop computer</option>
            <option value="server">Server</option>
            <option value="office_equipment">Office equipment</option>
            <option value="furniture">Furniture</option>
            <option value="other">Other</option>
          </select>
          <Input placeholder="Cost GHS" value={cost} onChange={(e) => setCost(e.target.value)} className="w-32" />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>Register asset</Button>
          <Button variant="secondary" disabled={runDep.isPending} onClick={() => runDep.mutate()}>
            {runDep.isPending ? "Posting…" : "Run monthly depreciation"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Example: cost GH₵ 8,000 → annual GH₵ 2,000 → monthly GH₵ 166.67 (stored as minor units). Idempotent per asset-period.
        </p>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((a) => (
            <Card key={a.id}>
              <CardContent className="py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{a.assetNumber} · {a.name}</span>
                  <span className="text-xs uppercase text-muted-foreground">{a.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {a.category} · rate {(a.depreciationRateBps / 100).toFixed(0)}% · cost {formatCurrency(a.costMinor)} · accum {formatCurrency(a.accumulatedMinor)} · NBV {formatCurrency(a.netBookValueMinor)}
                </p>
                <p className="text-xs">Monthly charge {formatCurrency(a.monthlyDepreciationMinor)} · {a.policyNote}</p>
              </CardContent>
            </Card>
          ))}
          {!q.data?.items?.length && <p className="text-muted-foreground">No fixed assets yet.</p>}
        </div>
      </Shell>
    );
  }


  if (mode === "periods") {
    const q = useQuery({ queryKey: ["fin", "periods"], queryFn: () => finGet<{ items: any[] }>("/periods") });
    const [reason, setReason] = useState("");
    const closeMut = useMutation({
      mutationFn: (periodYm: string) =>
        finPost("/periods/close", { periodYm, confirm: "CLOSE_PERIOD", reason: reason || "Month-end close", actor: "finance_user" }),
      onSuccess: inv,
    });
    const reopenMut = useMutation({
      mutationFn: (periodYm: string) =>
        finPost("/periods/reopen", { periodYm, confirm: "REOPEN_PERIOD", reason: reason || "Authorized correction", actor: "finance_user" }),
      onSuccess: inv,
    });
    return (
      <Shell title="Accounting periods" desc="Close a month to block new posts and deletions for that period. Reopen requires a reason (elevated authorization).">
        <div className="mb-4 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Close / reopen reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Month-end close / Correct posting error" />
          </div>
        </div>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((p) => (
            <Card key={p.id || p.periodYm}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{p.periodYm} · <span className={p.status === "closed" ? "text-rose-600" : "text-emerald-600"}>{p.status}</span></p>
                  {p.status === "closed" && (
                    <p className="text-xs text-muted-foreground">Closed {p.closedAt?.slice(0, 16)} by {p.closedBy}: {p.closeReason}</p>
                  )}
                  {p.reopenedAt && (
                    <p className="text-xs text-muted-foreground">Last reopen {p.reopenedAt?.slice(0, 16)} by {p.reopenedBy}: {p.reopenReason}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {p.status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={closeMut.isPending}
                      onClick={() => {
                        if (!window.confirm(`Close period ${p.periodYm}? Posting and deletes for this month will be blocked.`)) return;
                        closeMut.mutate(p.periodYm);
                      }}
                    >
                      Close period
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={reopenMut.isPending}
                      onClick={() => {
                        if (!reason || reason.length < 3) {
                          window.alert("Enter a reopen reason (min 3 characters).");
                          return;
                        }
                        if (!window.confirm(`Reopen period ${p.periodYm}? Only for authorized corrections.`)) return;
                        reopenMut.mutate(p.periodYm);
                      }}
                    >
                      Reopen period
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "integrity") {
    const q = useQuery({ queryKey: ["fin", "integrity"], queryFn: () => finGet<any>("/integrity") });
    return (
      <Shell title="Accounting integrity" desc="Detects unbalanced journals, over-depreciation, and trial balance mismatches">
        {q.data && (
          <div className="space-y-3">
            <p className={`text-sm font-medium ${q.data.ok ? "text-emerald-600" : "text-rose-600"}`}>
              {q.data.ok ? "No integrity issues detected" : `${q.data.issues?.length || 0} issue(s)`}
            </p>
            <p className="text-xs text-muted-foreground">Journals: {q.data.journalCount} · Assets: {q.data.assetCount}</p>
            <div className="space-y-2">
              {(q.data.issues || []).map((i: any, idx: number) => (
                <Card key={idx}><CardContent className="py-2 text-sm">
                  <span className="text-xs uppercase text-muted-foreground">{i.code}</span>
                  <p>{i.message}</p>
                </CardContent></Card>
              ))}
            </div>
          </div>
        )}
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
    // Major units in the form (15000 = GH₵ 15,000.00); converted to minor on post
    const [amount, setAmount] = useState("15000");
    const [rev, setRev] = useState<AccountOption | null>(null);
    const amountMinor = majorToMinor(Number(amount) || 0);
    const invNarrative = useMemo(
      () =>
        narrativeForFinanceInvoice({
          customerName: name || "Customer",
          amountMinor,
          revenueAccountCode: rev?.code,
          revenueAccountName: rev?.name,
        }),
      [name, amountMinor, rev?.code, rev?.name],
    );
    const create = useMutation({
      mutationFn: () =>
        finPost("/invoices", {
          customerName: name,
          amountMinor,
          revenueAccountCode: rev?.code || "4020",
          description: invNarrative.description,
          arMemo: invNarrative.arMemo,
          revenueMemo: invNarrative.revenueMemo,
        }),
      onSuccess: inv,
    });
    return (
      <Shell title="Invoices / AR" desc="Posts Dr 1050 AR / Cr selected revenue · enter major units (e.g. 5000 = GH₵ 5,000.00)">
        <div className="grid gap-2 mb-4 sm:grid-cols-2">
          <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Amount (GHS major units)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <AccountSelect value={rev} onChange={setRev} placeholder="Revenue account (search)…" />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>Issue invoice</Button>
        </div>
        {name && amountMinor > 0 && (
          <Card className="mb-4 border-primary/20 bg-primary/5">
            <CardContent className="py-3 text-xs space-y-1">
              <p className="font-medium text-sm">Auto documentation</p>
              <p>{invNarrative.description}</p>
              <p className="text-muted-foreground">{invNarrative.documentation.financialImpact.summary}</p>
              <p className="text-muted-foreground">Completeness: {invNarrative.documentation.completenessScore}%</p>
            </CardContent>
          </Card>
        )}
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((i) => (
            <Card key={i.id}><CardContent className="py-3">
              <p className="font-medium">{i.number} · {i.customerName}</p>
              <p className="text-xs text-muted-foreground">{i.issueDate} · {i.status} · {formatCurrency(i.amountMinor, i.currency)}</p>
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
    const selectedInv = (invs.data?.items || []).find((i) => i.id === invoiceId);
    const payMinor = majorToMinor(Number(amount) || 0);
    const payNarrative = useMemo(
      () =>
        narrativeForFinancePayment({
          customerName: selectedInv?.customerName || "Customer",
          amountMinor: payMinor,
          invoiceNumber: selectedInv?.number,
        }),
      [selectedInv?.customerName, selectedInv?.number, payMinor],
    );
    const create = useMutation({
      mutationFn: () =>
        finPost("/payments", {
          invoiceId,
          amountMinor: payMinor,
          bankAccountCode: "1030",
          description: payNarrative.description,
          bankMemo: payNarrative.bankMemo,
          arMemo: payNarrative.arMemo,
        }),
      onSuccess: () => { inv(); setAmount(""); },
    });
    return (
      <Shell title="Customer payments" desc="Dr Bank 1030 / Cr AR 1050 · enter major units (e.g. 5000 = GH₵ 5,000.00)">
        <div className="flex flex-wrap gap-2 mb-4">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">Select invoice</option>
            {(invs.data?.items || []).filter((i) => i.status !== "paid").map((i) => (
              <option key={i.id} value={i.id}>{i.number} — {i.customerName} · {formatCurrency(i.amountMinor, i.currency)}</option>
            ))}
          </select>
          <Input placeholder="Amount (GHS)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" />
          <Button disabled={!invoiceId || !amount || create.isPending} onClick={() => create.mutate()}>Record payment</Button>
        </div>
        {invoiceId && payMinor > 0 && (
          <Card className="mb-4 border-primary/20 bg-primary/5">
            <CardContent className="py-3 text-xs space-y-1">
              <p className="font-medium text-sm">Auto documentation</p>
              <p>{payNarrative.description}</p>
              <p className="text-muted-foreground">{payNarrative.documentation.financialImpact.summary}</p>
            </CardContent>
          </Card>
        )}
        {create.isError && <p className="text-sm text-rose-600 mb-2">Payment rejected.</p>}
        <div className="space-y-2 text-sm">
          {(pays.data?.items || []).map((p) => (
            <Card key={p.id}><CardContent className="py-3">{p.paymentDate}: {formatCurrency(p.amountMinor, p.currency)} — {p.customerName}</CardContent></Card>
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
  const [descTouched, setDescTouched] = useState(false);
  const [journalType, setJournalType] = useState("general");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([
    { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
    { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
  ]);
  const [docsOpen, setDocsOpen] = useState(true);

  /**
   * Journal form amounts are MAJOR currency units (e.g. 5000 = GHS 5,000.00).
   * Storage and API require INTEGER MINOR units (5000 major → 500000 minor).
   * Converting only at the post boundary prevents the 100× display understatement.
   */
  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) {
      d += Number(l.debit) || 0;
      c += Number(l.credit) || 0;
    }
    // Compare in minor space for exact balance (avoids float noise)
    const dMin = majorToMinor(d);
    const cMin = majorToMinor(c);
    return {
      debitMajor: d,
      creditMajor: c,
      debit: dMin,
      credit: cMin,
      difference: dMin - cMin,
      balanced: dMin === cMin && dMin > 0,
    };
  }, [lines]);

  const docs: DocumentationResult = useMemo(
    () =>
      generateDocumentation({
        journalType,
        entryDate,
        currency: "GHS",
        description: desc,
        preserveUserEdits: descTouched,
        lines: lines.map((l) => ({
          key: l.key,
          account: l.account
            ? {
                code: l.account.code,
                name: l.account.name,
                type: l.account.type as any,
                subtype: (l.account as any).subtype,
              }
            : null,
          memo: l.memo,
          // Engine expects minor units for formatCurrency
          debit: majorToMinor(Number(l.debit) || 0),
          credit: majorToMinor(Number(l.credit) || 0),
        })),
      }),
    [lines, journalType, entryDate, desc, descTouched],
  );


  // Auto-fill description from engine when user has not manually edited it
  useEffect(() => {
    if (!descTouched && docs.journalMemo) {
      setDesc(docs.journalMemo);
    }
  }, [docs.journalMemo, descTouched]);

  // Auto-fill empty line memos from engine notes
  useEffect(() => {
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (l.memo.trim()) return l;
        const note = docs.lineNotes.find((n) => n.key === l.key);
        if (note?.autoNote) {
          changed = true;
          return { ...l, memo: note.autoNote };
        }
        return l;
      });
      return changed ? next : prev;
    });
  }, [docs.lineNotes]);

  const post = useMutation({
    mutationFn: () =>
      finPost("/journals", {
        description: desc || docs.journalMemo || `${journalType} journal`,
        journalType,
        entryDate,
        post: true,
        // Explicit contract: debit/credit are integer MINOR units
        amountUnit: "minor",
        lines: lines
          .filter((l) => l.account && (Number(l.debit) || Number(l.credit)))
          .map((l) => {
            const auto = docs.lineNotes.find((n) => n.key === l.key);
            return {
              accountCode: l.account!.code,
              memo: l.memo || auto?.autoNote || "",
              // Convert major form values → minor for storage (5000 GHS → 500000)
              debit: majorToMinor(Number(l.debit) || 0),
              credit: majorToMinor(Number(l.credit) || 0),
            };
          }),
      }),

    onSuccess: () => {
      onPosted();
      qc.invalidateQueries({ queryKey: ["fin", "je"] });
      setDesc("");
      setDescTouched(false);
      setLines([
        { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
        { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" },
      ]);
    },
  });

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const applyAutoMemo = () => {
    setDesc(docs.journalMemo);
    setDescTouched(false);
  };

  const applyLineNotes = () => {
    setLines((prev) =>
      prev.map((l) => {
        const note = docs.lineNotes.find((n) => n.key === l.key);
        return note ? { ...l, memo: note.autoNote } : l;
      }),
    );
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
          <label className="text-xs text-muted-foreground">Description / journal memo</label>
          <Input
            className="mt-1"
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              setDescTouched(true);
            }}
            placeholder="Auto-generated from accounts — edit freely"
          />
          <button
            type="button"
            className="mt-1 text-[11px] text-primary hover:underline"
            onClick={applyAutoMemo}
          >
            Regenerate from accounts
          </button>
        </div>
      </div>


      <p className="mb-2 text-[11px] text-muted-foreground">
        Enter amounts in <strong className="text-foreground">major units</strong> (e.g. type{" "}
        <code className="text-xs">5000</code> for GH₵ 5,000.00). Values are converted to minor units on post so the
        ledger and dashboard stay consistent.
      </p>
      <div className="mb-2 hidden grid-cols-12 gap-2 text-[11px] uppercase text-muted-foreground sm:grid">
        <div className="col-span-5">Account</div>
        <div className="col-span-3">Memo</div>
        <div className="col-span-1 text-right">Debit (GHS)</div>
        <div className="col-span-1 text-right">Credit (GHS)</div>
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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, { key: crypto.randomUUID(), account: null, memo: "", debit: "", credit: "" }])}>
          Add line
        </Button>
        <div className="text-sm tabular-nums">
          Dr <strong>{formatCurrency(totals.debit)}</strong> · Cr <strong>{formatCurrency(totals.credit)}</strong> · Diff{" "}
          <strong className={totals.difference === 0 ? "text-emerald-600" : "text-rose-600"}>
            {formatCurrency(Math.abs(totals.difference))}
          </strong>
        </div>

        <Button disabled={!totals.balanced || post.isPending} onClick={() => post.mutate()}>
          {post.isPending ? "Posting…" : "Post balanced journal"}
        </Button>
      </div>
      {post.isError && <p className="text-sm text-rose-600 mb-4">Post rejected — check balance and accounts.</p>}

      {/* Automatic accounting documentation panel */}
      <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
        <CardHeader className="py-3 flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Accounting documentation & intelligence</CardTitle>
            <CardDescription>
              Deterministic notes from Chart of Accounts and line structure — no external AI keys.
              Completeness score: <strong className="text-foreground">{docs.completenessScore}%</strong>
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={applyLineNotes}>
              Apply line notes
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDocsOpen((o) => !o)}>
              {docsOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
        </CardHeader>
        {docsOpen && (
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {docs.completeness.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-md border px-2 py-1.5 text-xs ${
                    c.status === "complete"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : c.status === "partial"
                        ? "border-yellow-500/30 bg-yellow-500/5"
                        : "border-muted bg-muted/30"
                  }`}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="ml-1 uppercase text-[10px] text-muted-foreground">{c.status}</span>
                  {c.detail && <p className="text-muted-foreground">{c.detail}</p>}
                </div>
              ))}
            </div>

            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Journal memo</p>
              <p className="mt-0.5">{docs.journalMemo || "—"}</p>
            </div>

            {docs.lineNotes.length > 0 && (
              <div>
                <p className="text-[11px] uppercase text-muted-foreground mb-1">Line explanations</p>
                <ul className="space-y-1.5">
                  {docs.lineNotes.map((n) => (
                    <li key={`${n.accountCode}-${n.side}`} className="rounded border px-2 py-1.5 text-xs">
                      <span className="font-medium">
                        {n.side === "debit" ? "Dr" : "Cr"} {n.accountCode} {n.accountName}
                      </span>{" "}
                      <span className="tabular-nums text-muted-foreground">{formatCurrency(n.amount)}</span>
                      <p className="text-muted-foreground mt-0.5">{n.autoNote}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Financial impact</p>
              <p className="mt-0.5 text-xs">{docs.financialImpact.summary}</p>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                <span>Assets: {docs.financialImpact.assets}</span>
                <span>Liabilities: {docs.financialImpact.liabilities}</span>
                <span>Cash: {docs.financialImpact.cash}</span>
                <span>Profit: {docs.financialImpact.profit}</span>
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Accounting treatment</p>
              <p className="mt-0.5 text-xs">
                <span className="font-medium">{docs.treatment.classification}</span> — {docs.treatment.principle}
              </p>
              {docs.treatment.alternatives && (
                <p className="text-xs text-muted-foreground mt-0.5">Alternative: {docs.treatment.alternatives}</p>
              )}
            </div>

            {docs.accountExplanations.length > 0 && (
              <div>
                <p className="text-[11px] uppercase text-muted-foreground mb-1">Account context</p>
                <ul className="space-y-1">
                  {docs.accountExplanations.map((a) => (
                    <li key={a.code} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{a.code} {a.name}:</span> {a.explanation}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {docs.alerts.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase text-muted-foreground">Intelligence alerts</p>
                {docs.alerts.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-md border px-3 py-2 text-xs ${
                      a.severity === "critical"
                        ? "border-red-500/40 bg-red-500/5"
                        : a.severity === "caution"
                          ? "border-yellow-500/40 bg-yellow-500/5"
                          : "border-sky-500/30 bg-sky-500/5"
                    }`}
                  >
                    <p className="font-medium">
                      <span className="uppercase text-[10px] text-muted-foreground mr-1">{a.severity}</span>
                      {a.title}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{a.observation}</p>
                    <p className="mt-0.5">
                      <span className="font-medium">Recommendation:</span> {a.recommendation}
                    </p>
                    <p className="text-muted-foreground mt-0.5">{a.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>


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
            <div className="mt-2 flex flex-wrap gap-2">
              {j.status === "posted" && !j.reversedBy && (
                <Button size="sm" variant="outline" onClick={() => finPost(`/journals/${j.id}/reverse`, {}).then(() => { onPosted(); qc.invalidateQueries({ queryKey: ["fin", "je"] }); })}>
                  Reverse
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (!window.confirm(`Permanently delete ${j.number}? This removes active ledger effects. Audit retains the deletion event.`)) return;
                  finDelete(`/journals/${j.id}`, { confirm: "DELETE_JOURNAL", reason: "User correction from journals UI" }).then(() => {
                    onPosted();
                    qc.invalidateQueries({ queryKey: ["fin"] });
                  });
                }}
              >
                Delete
              </Button>
            </div>
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
