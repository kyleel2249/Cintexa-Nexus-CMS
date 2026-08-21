import { useCallback, useEffect, useState } from "react";
import { LineChart, RefreshCw, Sparkles } from "lucide-react";
import { nexusFinanceApi } from "@/lib/nexus-finance-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FIELDS = [
  "revenue", "cogs", "operatingExpenses", "ebit", "ebitda", "interestExpense", "netIncome",
  "currentAssets", "cash", "inventory", "receivables", "totalAssets",
  "currentLiabilities", "totalLiabilities", "totalEquity", "totalDebt",
  "operatingCashFlow", "freeCashFlow", "monthlyBurn",
] as const;

export default function NexusFinancePage() {
  const [companyName, setCompanyName] = useState("");
  const [periodLabel, setPeriodLabel] = useState("2025");
  const [currency, setCurrency] = useState("GHS");
  const [form, setForm] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("How long can the company survive?");
  const [cfoAnswer, setCfoAnswer] = useState<any>(null);
  const [scenario, setScenario] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await nexusFinanceApi.analyses();
      setHistory(r.items || []);
    } catch { /* soft */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async () => {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { companyName: companyName || "Company", periodLabel, currency };
      for (const f of FIELDS) {
        if (form[f] !== undefined && form[f] !== "") payload[f] = Number(form[f]);
      }
      const r = await nexusFinanceApi.analyze(payload);
      setAnalysis(r);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-primary text-sm font-semibold flex items-center gap-2">
            <LineChart className="w-4 h-4" /> NEXUS FINANCE
          </div>
          <h1 className="text-3xl font-bold mt-1">Corporate financial intelligence</h1>
          <p className="text-muted-foreground mt-1">
            Health scoring, ratios, distress indicators and survival estimates from provided statements — analytical only, not an audit opinion.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New analysis</CardTitle>
          <CardDescription>Enter statement figures. Missing fields stay UNKNOWN rather than invented.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div><Label>Company</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
            <div><Label>Period</Label><Input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} /></div>
            <div><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FIELDS.map((f) => (
              <div key={f}>
                <Label className="text-xs">{f}</Label>
                <Input value={form[f] || ""} onChange={(e) => setForm((s) => ({ ...s, [f]: e.target.value }))} />
              </div>
            ))}
          </div>
          <Button onClick={() => void run()} disabled={busy}>{busy ? "Analyzing…" : "Start analysis"}</Button>
        </CardContent>
      </Card>

      {analysis && (
        <>
          <div className="grid md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Health score</div>
                <div className="text-3xl font-bold">{analysis.health?.overall}/100</div>
                <Badge className="mt-2">{analysis.health?.rating}</Badge>
              </CardContent>
            </Card>
            {Object.entries(analysis.health?.dimensions || {}).map(([k, v]) => (
              <Card key={k}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground capitalize">{k}</div>
                  <div className="text-2xl font-bold tabular-nums">{String(v)}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Distress model</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                <div>{analysis.distress?.model}</div>
                <div>Score: <b>{analysis.distress?.score ?? "—"}</b> · Risk: <Badge variant="outline">{analysis.distress?.risk}</Badge></div>
                <p>{analysis.distress?.interpretation}</p>
                <p className="text-xs text-muted-foreground">{analysis.distress?.limitations}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Survival estimate</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                <div>Runway (months): <b>{analysis.survival?.estimatedRunwayMonths ?? "n/a"}</b></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="border rounded p-2">Base<br /><b>{analysis.survival?.baseCase ?? "—"}</b></div>
                  <div className="border rounded p-2">Stress<br /><b>{analysis.survival?.stressCase ?? "—"}</b></div>
                  <div className="border rounded p-2">Recovery<br /><b>{analysis.survival?.recoveryCase ?? "—"}</b></div>
                </div>
                <p className="text-xs text-muted-foreground">{analysis.survival?.note}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Ratios</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left"><th className="p-2">Ratio</th><th>Value</th><th>Risk</th><th>Interpretation</th></tr></thead>
                <tbody>
                  {(analysis.health?.ratios || []).map((r: any) => (
                    <tr key={r.name} className="border-b">
                      <td className="p-2 font-medium">{r.name}</td>
                      <td>{r.value ?? "—"}</td>
                      <td><Badge variant="outline">{r.risk}</Badge></td>
                      <td className="text-muted-foreground">{r.interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" /> AI CFO</CardTitle>
                <CardDescription>Answers from this analysis only — cites calculated evidence.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />
                <Button variant="outline" onClick={async () => {
                  setCfoAnswer(await nexusFinanceApi.cfoChat({ question, analysisId: analysis.id }));
                }}>Ask</Button>
                {cfoAnswer && (
                  <div className="border rounded-lg p-3 text-sm">
                    <p>{cfoAnswer.answer}</p>
                    <Badge variant="outline" className="mt-2">{cfoAnswer.confidence}</Badge>
                    <p className="text-xs text-muted-foreground mt-1">{cfoAnswer.disclaimer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Scenario (revenue −20%)</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Button variant="outline" onClick={async () => {
                  setScenario(await nexusFinanceApi.scenarios({ base: analysis.input, changes: { revenueGrowthPct: -20 } }));
                }}>Simulate stress</Button>
                {scenario && (
                  <div>
                    Health under scenario: <b>{scenario.health?.overall}/100</b> ({scenario.health?.rating})
                    <p className="text-xs text-muted-foreground mt-1">{scenario.note}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">{analysis.health?.disclaimer}</p>
        </>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Recent analyses</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {history.length === 0 && <p className="text-muted-foreground">No analyses yet.</p>}
          {history.map((h) => (
            <button key={h.id} type="button" className="w-full text-left border rounded-lg p-3 hover:bg-muted/40" onClick={() => setAnalysis(h)}>
              <div className="font-medium">{h.companyName} · {h.periodLabel || "—"}</div>
              <div className="text-xs text-muted-foreground">Health {h.health?.overall}/100 · {h.health?.rating}</div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
