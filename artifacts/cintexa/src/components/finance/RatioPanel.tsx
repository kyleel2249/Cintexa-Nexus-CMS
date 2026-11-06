import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { finGet, finPost, formatCurrency } from "@/lib/finance/api";

type Unit = "x" | "%" | "days" | "money" | "months";
export interface Ratio { id: string; name: string; category: string; unit: Unit; formula: string; meaning: string; better: "higher" | "lower"; healthy?: number; value: number | null; reading: "healthy" | "watch" | "unknown"; improve: string }
interface RatiosResponse { period: { from: string; to: string; days: number }; ratios: Ratio[]; findings: Array<{ severity: string; ratio: string; text: string }>; customers: { total: number; new: number } }
interface Change { id: string; name: string; unit: Unit; before: number | null; after: number | null; direction: "improves" | "worsens" | "unchanged" | "new"; explanation: string; impact: string }

export function fmtRatio(v: number | null, unit: Unit): string {
  if (v === null || v === undefined) return "n/a";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "x") return `${v.toFixed(2)}x`;
  if (unit === "days") return `${Math.round(v)} days`;
  if (unit === "months") return `${v.toFixed(1)} months`;
  return formatCurrency(Math.round(v));
}

const CATEGORY_LABEL: Record<string, string> = { liquidity: "Liquidity", profitability: "Profitability", leverage: "Leverage", efficiency: "Efficiency", acquisition: "Customer acquisition" };
const tone = (r: Ratio["reading"]) => (r === "healthy" ? "text-emerald-600" : r === "watch" ? "text-amber-600" : "text-muted-foreground");

export function useRatios(from?: string, to?: string) {
  return useQuery({ queryKey: ["fin", "ratios", from, to], queryFn: () => finGet<RatiosResponse>("/analytics/ratios", { from, to }), retry: false, refetchInterval: 60_000 });
}

/** Every ratio, grouped, with formula, meaning, reading and how to improve. Part of the financial analysis. */
export function RatioPanel({ compact = false }: { compact?: boolean }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useRatios(from || undefined, to || undefined);
  const groups = useMemo(() => {
    const m = new Map<string, Ratio[]>();
    for (const r of q.data?.ratios ?? []) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()];
  }, [q.data]);

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">Ratios are unavailable right now.</p>;
  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border bg-background px-2" /></label>
          <label className="grid gap-1">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border bg-background px-2" /></label>
          <p className="text-xs text-muted-foreground pb-2">Period {q.data.period.from} to {q.data.period.to} ({q.data.period.days} days). Balance-sheet ratios use closing balances. Customers: {q.data.customers.total} total, {q.data.customers.new} new in period.</p>
        </div>
      )}
      {q.data.findings.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="py-3"><CardTitle className="text-base">What to look at</CardTitle></CardHeader>
          <CardContent><ul className="list-disc pl-5 text-sm space-y-1">{q.data.findings.map((f) => <li key={f.ratio + f.text.slice(0, 12)}>{f.text}</li>)}</ul></CardContent>
        </Card>
      )}
      {groups.map(([cat, items]) => (
        <Card key={cat}>
          <CardHeader className="py-3"><CardTitle className="text-base">{CATEGORY_LABEL[cat] ?? cat}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {items.map((r) => (
              <div key={r.id} className="rounded border p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className={`font-semibold ${tone(r.reading)}`}>{fmtRatio(r.value, r.unit)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.formula}</p>
                {!compact && (
                  <>
                    <p className="text-xs mt-1">{r.meaning}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.value === null ? "Not enough data in this period to calculate." : r.reading === "healthy" ? "Within the healthy range." : r.reading === "watch" ? `Needs attention. ${r.improve}` : r.improve}
                      {r.healthy !== undefined && ` Guide: ${r.better === "higher" ? "at least" : "at most"} ${fmtRatio(r.healthy, r.unit)}.`}
                    </p>
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">Guides are general rules of thumb, not standards: healthy levels differ by industry. Customer Acquisition Cost uses account 6200 Marketing and Advertising and counts a customer as new in the period of their first invoice.</p>
    </div>
  );
}

export interface ImpactLine { accountCode: string; debit: number; credit: number }

/** Shows what a transaction does to every ratio it touches, with an explanation and its impact. */
export function RatioImpactCard({ lines, entryDate }: { lines: ImpactLine[]; entryDate?: string }) {
  const key = JSON.stringify([lines, entryDate]);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => { const t = setTimeout(() => setDebounced(key), 400); return () => clearTimeout(t); }, [key]);
  const q = useQuery({
    queryKey: ["fin", "ratio-impact", debounced],
    queryFn: () => finPost<{ changes: Change[]; unknownAccounts: string[] }>("/analytics/ratio-impact", { lines, entryDate }),
    enabled: lines.length > 0,
    retry: false,
  });
  if (lines.length === 0) return null;
  return (
    <Card className="mb-6 border-emerald-500/30 bg-emerald-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Effect on financial ratios</CardTitle>
        <CardDescription>Updates as you change accounts and amounts. Based on this year's posted journals plus this entry.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {q.isLoading && <Skeleton className="h-10 w-full" />}
        {q.isError && <p className="text-xs text-muted-foreground">Ratio effects are unavailable right now.</p>}
        {q.data && q.data.changes.length === 0 && <p className="text-xs text-muted-foreground">This entry does not change any ratio.</p>}
        {q.data?.changes.map((c) => (
          <div key={c.id} className="rounded border px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-xs">{c.name}</span>
              <span className={`text-xs font-semibold ${c.direction === "improves" ? "text-emerald-600" : c.direction === "worsens" ? "text-amber-600" : "text-muted-foreground"}`}>
                {fmtRatio(c.before, c.unit)} → {fmtRatio(c.after, c.unit)} ({c.direction})
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{c.explanation} {c.impact}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Ratios fed by one account, and why. Shown on the Chart of Accounts. */
export function AccountRatios({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["fin", "account-ratios", code], queryFn: () => finGet<{ ratios: Array<{ id: string; name: string; why: string }> }>("/analytics/account-ratios", { code }), retry: false, staleTime: 300_000 });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  const rows = q.data?.ratios ?? [];
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">This account does not feed any ratio.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((r) => (<li key={r.id}><span className="font-medium">{r.name}</span><span className="text-muted-foreground"> — {r.why}</span></li>))}
    </ul>
  );
}

/** Collapsible "ratios this account feeds"; loads only when opened so a long chart of accounts stays light. */
export function AccountRatiosToggle({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide ratio effects" : "Ratios this account affects"}
      </button>
      {open && <div className="mt-1 rounded border bg-muted/30 p-2"><AccountRatios code={code} /></div>}
    </div>
  );
}
