import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fiGet, fiPost, fiPut, formatMinor } from "@/lib/financial-intelligence/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";

type Mode =
  | "health" | "pnl" | "balance-sheet" | "ratios" | "forecast"
  | "scenarios" | "entries" | "fx" | "settings";

export default function FiPage({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const currency = "GHS";

  if (mode === "health") {
    const q = useQuery({ queryKey: ["fi", "health"], queryFn: () => fiGet<any>("/health") });
    return (
      <Shell title="Financial Health" desc="Weighted native score — not generative AI">
        {q.data && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <p className="text-3xl font-semibold">{q.data.score ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{q.data.method}</p>
              {q.data.insufficientData && <p className="text-sm text-amber-600">Insufficient posted data for a score.</p>}
              <ul className="text-sm space-y-1">
                {(q.data.components || []).map((c: any) => (
                  <li key={c.key}>{c.key}: {c.score ?? "—"} (weight {c.weight}) — {c.note}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </Shell>
    );
  }

  if (mode === "pnl") {
    const q = useQuery({ queryKey: ["fi", "pnl"], queryFn: () => fiGet<any>("/pnl") });
    const d = q.data;
    return (
      <Shell title="Profit & Loss" desc="From posted journals only">
        {d && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(["revenue", "cogs", "grossProfit", "operatingExpenses", "operatingProfit", "netProfit"] as const).map((k) => (
              <Card key={k}><CardContent className="pt-4"><p className="text-xs uppercase text-muted-foreground">{k}</p><p className="text-lg font-semibold">{formatMinor(d[k], d.currency || currency)}</p></CardContent></Card>
            ))}
            <Card className="sm:col-span-2"><CardContent className="pt-4 text-xs text-muted-foreground">{JSON.stringify(d.formula)}</CardContent></Card>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "balance-sheet") {
    const q = useQuery({ queryKey: ["fi", "bs"], queryFn: () => fiGet<any>("/balance-sheet") });
    const d = q.data;
    return (
      <Shell title="Balance Sheet" desc="Accounting equation check included">
        {d && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card><CardContent className="pt-4"><p className="text-xs uppercase text-muted-foreground">Assets</p><p className="text-lg font-semibold">{formatMinor(d.assets, currency)}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs uppercase text-muted-foreground">Liabilities</p><p className="text-lg font-semibold">{formatMinor(d.liabilities, currency)}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs uppercase text-muted-foreground">Equity</p><p className="text-lg font-semibold">{formatMinor(d.equity, currency)}</p></CardContent></Card>
            </div>
            <p className={`text-sm ${d.balanced ? "text-emerald-600" : "text-rose-600"}`}>{d.equationCheck}</p>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "ratios") {
    const q = useQuery({ queryKey: ["fi", "ratios"], queryFn: () => fiGet<any>("/ratios") });
    const d = q.data;
    return (
      <Shell title="Financial Ratios" desc="Transparent formulas">
        {d && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Current ratio" value={d.currentRatio ?? "—"} />
              <Metric label="Working capital" value={formatMinor(d.workingCapital ?? 0, d.currency || currency)} />
              <Metric label="Debt / equity" value={d.debtToEquity ?? "—"} />
              <Metric label="Net margin %" value={d.netMarginPct ?? "—"} />
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{JSON.stringify(d.formulas, null, 2)}</pre>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "forecast") {
    const q = useQuery({ queryKey: ["fi", "forecast"], queryFn: () => fiGet<any>("/forecast?ahead=3") });
    return (
      <Shell title="Revenue forecast" desc="OLS linear regression on monthly revenue">
        {q.data && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{q.data.note}</p>
            <Card><CardHeader><CardTitle className="text-sm">History</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">{(q.data.series || []).map((s: any) => <div key={s.period}>{s.period}: {formatMinor(s.value, currency)}</div>)}</CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-sm">Forecast</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">{(q.data.forecast || []).map((s: any) => <div key={s.period}>{s.period}: {formatMinor(s.value, currency)} <span className="text-xs text-muted-foreground">({s.method})</span></div>)}</CardContent>
            </Card>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "scenarios") {
    const [rg, setRg] = useState("10");
    const [eg, setEg] = useState("5");
    const [result, setResult] = useState<any>(null);
    const run = useMutation({
      mutationFn: () => fiPost("/scenarios", { revenueGrowthPct: Number(rg), expenseGrowthPct: Number(eg) }),
      onSuccess: setResult,
    });
    return (
      <Shell title="Scenario simulator" desc="Does not modify ledger records">
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <label className="text-sm">Revenue growth %<Input value={rg} onChange={(e) => setRg(e.target.value)} className="w-28" /></label>
          <label className="text-sm">Expense growth %<Input value={eg} onChange={(e) => setEg(e.target.value)} className="w-28" /></label>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>Run scenario</Button>
        </div>
        {result && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-sm">Base net</CardTitle></CardHeader><CardContent>{formatMinor(result.base?.netProfit ?? 0, currency)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Scenario net</CardTitle></CardHeader><CardContent>{formatMinor(result.scenario?.netProfit ?? 0, currency)}</CardContent></Card>
            <p className="text-xs text-muted-foreground sm:col-span-2">{result.scenario?.note}</p>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "entries") {
    const q = useQuery({ queryKey: ["fi", "entries"], queryFn: () => fiGet<any>("/entries") });
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const post = useMutation({
      mutationFn: () =>
        fiPost("/entries", {
          date,
          lines: [
            { accountCode: "1000", accountName: "Cash", type: "asset", debit: 10000, credit: 0 },
            { accountCode: "4000", accountName: "Sales", type: "revenue", debit: 0, credit: 10000 },
          ],
          memo: "Quick cash sale (minor units)",
        }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["fi"] }),
    });
    return (
      <Shell title="Journal entries" desc="Debits must equal credits (minor units)">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          <Button onClick={() => post.mutate()} disabled={post.isPending}>Post sample balanced entry</Button>
        </div>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((e: any) => (
            <Card key={e.id}><CardContent className="py-3">
              <div className="flex justify-between gap-2"><span>{e.date} · {e.status}</span><span className="text-xs text-muted-foreground">{e.id.slice(0, 8)}</span></div>
              {e.memo && <p className="text-xs text-muted-foreground">{e.memo}</p>}
            </CardContent></Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "fx") {
    const q = useQuery({ queryKey: ["fi", "fx"], queryFn: () => fiGet<any>("/fx") });
    const [base, setBase] = useState("USD");
    const [quote, setQuote] = useState("GHS");
    const [rate, setRate] = useState("15.5");
    const add = useMutation({
      mutationFn: () => fiPost("/fx", { base, quote, rate: Number(rate), source: "manual" }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["fi", "fx"] }),
    });
    return (
      <Shell title="Exchange rates" desc="Manual rates only — no live FX API required">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input value={base} onChange={(e) => setBase(e.target.value)} className="w-24" placeholder="Base" />
          <Input value={quote} onChange={(e) => setQuote(e.target.value)} className="w-24" placeholder="Quote" />
          <Input value={rate} onChange={(e) => setRate(e.target.value)} className="w-28" placeholder="Rate" />
          <Button onClick={() => add.mutate()}>Add rate</Button>
        </div>
        <ul className="text-sm space-y-1">
          {(q.data?.items || []).map((r: any) => (
            <li key={r.id}>{r.effectiveDate}: 1 {r.base} = {r.rate} {r.quote} ({r.source})</li>
          ))}
        </ul>
      </Shell>
    );
  }

  // settings
  const org = useQuery({ queryKey: ["fi", "org"], queryFn: () => fiGet<any>("/org") });
  const meta = useQuery({ queryKey: ["fi", "meta"], queryFn: () => fiGet<any>("/meta") });
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () => fiPut("/org", { name: name || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fi", "org"] }),
  });
  return (
    <Shell title="FI Settings" desc="Organisation display — no API key fields">
      {meta.data && (
        <Card className="mb-4"><CardContent className="pt-4 text-sm space-y-1">
          <p>Version: {meta.data.version}</p>
          <p>Storage: {meta.data.storage}</p>
        </CardContent></Card>
      )}
      <div className="flex gap-2">
        <Input placeholder={org.data?.name || "Organisation name"} value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => save.mutate()}>Save</Button>
      </div>
    </Shell>
  );
}

function Shell({ title, desc, children }: { title: string; desc: string; children: import('react').ReactNode }) {
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card><CardContent className="pt-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </CardContent></Card>
  );
}
