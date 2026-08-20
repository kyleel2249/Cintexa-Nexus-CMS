import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot, Users, Target, TrendingUp, Zap, Phone, FileText, Shield,
  Play, Pause, RefreshCw, Plus, Sparkles, AlertTriangle, ChevronRight,
} from "lucide-react";
import { salesForceApi } from "@/lib/sales-force-api";
import { downloadProposalPdf } from "@/lib/sales-proposal-pdf";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Agent = {
  id: number;
  name: string;
  role: string;
  status?: string;
  specialization?: string;
  personality?: string;
  autonomyLevel?: number;
};

export default function SalesForcePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<Record<string, any>>({});
  const [activities, setActivities] = useState<any[]>([]);
  const [genSession, setGenSession] = useState<Record<string, any> | null>(null);
  const [gapPlan, setGapPlan] = useState<Record<string, any> | null>(null);
  const [objectionIn, setObjectionIn] = useState("");
  const [objectionOut, setObjectionOut] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [leadForm, setLeadForm] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    industry: "",
    website: "",
    companySize: "",
    consentEmail: true,
    estimatedValue: "",
  });
  const [target, setTarget] = useState("100000");
  const [diagForm, setDiagForm] = useState({ companyName: "", industry: "", health: "55", weakestPillar: "Sales", website: "", contactEmail: "", consentEmail: true });
  const [diagResult, setDiagResult] = useState<Record<string, any> | null>(null);
  const [whatSell, setWhatSell] = useState<any[]>([]);
  const [outreachNote, setOutreachNote] = useState<string | null>(null);
  const [dailyBrief, setDailyBrief] = useState<Record<string, any> | null>(null);
  const [negResult, setNegResult] = useState<Record<string, any> | null>(null);
  const [quoteResult, setQuoteResult] = useState<Record<string, any> | null>(null);
  const [bantResult, setBantResult] = useState<Record<string, any> | null>(null);
  const [listPrice, setListPrice] = useState("10000");
  const [reqDiscount, setReqDiscount] = useState("5");
  const [commandText, setCommandText] = useState("Show me all deals at risk");
  const [commandResult, setCommandResult] = useState<Record<string, any> | null>(null);
  const [seqPlan, setSeqPlan] = useState<any[]>([]);
  const [perf, setPerf] = useState<any[]>([]);
  const [reactivation, setReactivation] = useState<Record<string, any> | null>(null);
  const [actual, setActual] = useState("0");

  const refresh = useCallback(async () => {
    try {
      const [a, l, o, cc, act] = await Promise.all([
        salesForceApi.agents(),
        salesForceApi.leads(),
        salesForceApi.opportunities(),
        salesForceApi.commandCenter(),
        salesForceApi.activities(),
      ]);
      setAgents(a.items || []);
      setLeads(l.items || []);
      setOpps(o.items || []);
      setMetrics(cc);
      setActivities(act.items || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void salesForceApi.bootstrap().finally(() => void refresh());
  }, [refresh]);

  const roleLabel = (role: string) =>
    ({
      director: "Sales Director",
      manager: "Sales Manager",
      prospector: "Prospector",
      sdr: "SDR",
      qualification: "Qualification",
      ae: "Account Executive",
      closer: "Closer",
      account_manager: "Account Manager",
      upsell: "Upsell",
      reactivation: "Reactivation",
      researcher: "Researcher",
      analyst: "Analyst",
      proposal: "Proposal",
      negotiator: "Negotiator",
    }[role] || role);

  const createLead = async () => {
    if (!leadForm.companyName.trim()) return;
    setBusy(true);
    try {
      await salesForceApi.createLead({
        ...leadForm,
        estimatedValue: leadForm.estimatedValue ? Number(leadForm.estimatedValue) : null,
      });
      setLeadForm({ companyName: "", contactName: "", contactEmail: "", industry: "", website: "", companySize: "", consentEmail: true, estimatedValue: "" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runGenerate = async () => {
    setBusy(true);
    try {
      const r = await salesForceApi.generateSales(Number(target) || 0);
      setGenSession(r);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runGap = async () => {
    const r = await salesForceApi.closeTheGap({
      target: Number(target) || 0,
      actual: Number(actual) || Number(metrics.revenueClosed || 0),
      avgDealSize: 5000,
      winRatePercent: 20,
    });
    setGapPlan(r);
  };

  const pipelineByStage = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of opps) map[o.stage] = (map[o.stage] || 0) + 1;
    for (const l of leads) map[`lead:${l.stage}`] = (map[`lead:${l.stage}`] || 0) + 1;
    return map;
  }, [opps, leads]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-primary text-sm font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4" /> CINTEXA NEXUS — AI SALES FORCE
          </div>
          <h1 className="text-3xl font-bold mt-1">Sales Command Center</h1>
          <p className="text-muted-foreground mt-1">
            Digital sales department: research → score → engage → qualify → propose → close within authority. Metrics are live records only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button onClick={() => void runGenerate()} disabled={busy}>
            <Zap className="w-4 h-4 mr-2" /> Generate Sales
          </Button>
        </div>
      </div>

      {outreachNote && (
        <Card className="border-primary/20"><CardContent className="p-3 text-sm">{outreachNote}</CardContent></Card>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Leads", value: metrics.leadsTotal ?? 0, icon: Users },
          { label: "High intent", value: metrics.leadsHighIntent ?? 0, icon: Target },
          { label: "Open opps", value: metrics.opportunitiesOpen ?? 0, icon: TrendingUp },
          { label: "Pipeline", value: metrics.pipelineValue ?? 0, icon: FileText },
          { label: "Closed revenue", value: metrics.revenueClosed ?? 0, icon: Sparkles },
          { label: "Active agents", value: metrics.agentsActive ?? agents.length, icon: Bot },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <k.icon className="w-5 h-5 text-primary shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className="text-xl font-bold tabular-nums">{typeof k.value === "number" ? k.value.toLocaleString() : k.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {metrics.forecast && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue forecast (estimates)</CardTitle>
            <CardDescription>{String(metrics.forecast.note || "")}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="border rounded-lg p-3">Expected<br /><b>{Number(metrics.forecast.expectedCase || 0).toLocaleString()}</b></div>
            <div className="border rounded-lg p-3">Best case<br /><b>{Number(metrics.forecast.bestCase || 0).toLocaleString()}</b></div>
            <div className="border rounded-lg p-3">Worst case<br /><b>{Number(metrics.forecast.worstCase || 0).toLocaleString()}</b></div>
            <div className="border rounded-lg p-3">Weighted pipeline<br /><b>{Number(metrics.forecast.weightedPipeline || 0).toLocaleString()}</b></div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="workforce">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="workforce">AI Employees</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="bridge">Diagnostic bridge</TabsTrigger>
          <TabsTrigger value="sell">What to sell</TabsTrigger>
          <TabsTrigger value="ops">Ops & policy</TabsTrigger>
          <TabsTrigger value="warroom">War room</TabsTrigger>
        </TabsList>

        <TabsContent value="workforce" className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {agents.map((a, i) => (
              <motion.div key={a.id || a.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Card className="h-full">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center font-bold text-primary">
                          {(a.name || "?").slice(0, 1)}
                        </div>
                        <div>
                          <div className="font-semibold">{a.name}</div>
                          <div className="text-xs text-muted-foreground">{roleLabel(a.role)}</div>
                        </div>
                      </div>
                      <Badge variant="outline">{a.status || "active"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{a.specialization}</p>
                    <div className="flex gap-1 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={a.id < 0}
                        onClick={() => a.id > 0 && void salesForceApi.updateAgent(a.id, { status: a.status === "paused" ? "active" : "paused" }).then(refresh)}
                      >
                        {a.status === "paused" ? <Play className="w-3 h-3 mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                        {a.status === "paused" ? "Start" : "Pause"}
                      </Button>
                      <Badge variant="secondary" className="text-[10px]">L{a.autonomyLevel ?? 1}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leads" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" /> New lead</CardTitle>
              <CardDescription>Creates lead, scores it, and generates a research brief from provided fields only.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {([
                ["companyName", "Company *"],
                ["contactName", "Contact"],
                ["contactEmail", "Email"],
                ["industry", "Industry"],
                ["website", "Website"],
                ["companySize", "Company size"],
                ["estimatedValue", "Est. value"],
              ] as const).map(([k, label]) => (
                <div key={k}>
                  <Label>{label}</Label>
                  <Input
                    value={(leadForm as any)[k]}
                    onChange={(e) => setLeadForm((f) => ({ ...f, [k]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex items-end">
                <Button onClick={() => void createLead()} disabled={busy || !leadForm.companyName.trim()}>
                  Score & add lead
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {leads.length === 0 && (
              <p className="text-sm text-muted-foreground">No leads yet. Add one above — numbers stay at zero until real data exists.</p>
            )}
            {leads.map((l) => (
              <Card key={l.id}>
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {l.companyName}
                      {l.isDemo && <Badge variant="outline">DEMO</Badge>}
                      <Badge>{l.qualityLabel || "unscored"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {l.contactName || "—"} · {l.industry || "Industry UNKNOWN"} · Stage: {l.stage}
                    </div>
                    <div className="text-xs mt-1">
                      Priority <b>{l.priorityScore ?? "—"}</b> · Next: {l.nextAction || "—"}
                      {l.nextActionReason ? ` — ${l.nextActionReason}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void salesForceApi.scoreLead(l.id).then(refresh)}>Rescore</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await salesForceApi.createOpportunity({
                          leadId: l.id,
                          companyName: l.companyName,
                          name: `${l.companyName} — opportunity`,
                          amount: l.estimatedValue || null,
                        });
                        await refresh();
                      }}
                    >
                      Create opp
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await salesForceApi.createProposal({
                          leadId: l.id,
                          companyName: l.companyName,
                          contactName: l.contactName,
                          problem: "Confirmed in discovery",
                        });
                        await refresh();
                      }}
                    >
                      Draft proposal
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const r = await salesForceApi.outreachEmail({
                          leadId: l.id,
                          autonomyLevel: 1,
                          theme: "intro",
                          agentName: "Ryan",
                        });
                        setOutreachNote(
                          r.sent
                            ? `Sent: ${r.reason}`
                            : `Not sent (${r.status}): ${r.reason}. Prepared subject: ${(r as any).preparedMessage?.subject || ""}`,
                        );
                        await refresh();
                      }}
                    >
                      Prepare email
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
            {Object.entries(pipelineByStage).map(([stage, n]) => (
              <div key={stage} className="border rounded-lg p-3 flex justify-between">
                <span className="text-muted-foreground truncate">{stage}</span>
                <b>{n}</b>
              </div>
            ))}
          </div>
          {opps.map((o) => (
            <Card key={o.id}>
              <CardContent className="p-4 flex flex-col md:flex-row justify-between gap-2">
                <div>
                  <div className="font-semibold">{o.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.companyName} · {o.stage} · {o.currency} {o.amount ?? "—"} · Risk {o.riskScore ?? "—"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void salesForceApi.setOppStage(o.id, "proposal_sent").then(refresh)}>Proposal stage</Button>
                  <Button size="sm" variant="outline" onClick={() => void salesForceApi.setOppStage(o.id, "negotiation").then(refresh)}>Negotiate</Button>
                  <Button size="sm" onClick={() => void salesForceApi.setOppStage(o.id, "closed_won").then(refresh)}>Mark won*</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground">* Closed won only when you confirm a real agreement — AI does not invent closes.</p>
        </TabsContent>

        <TabsContent value="commands" className="mt-4 space-y-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Generate Sales</CardTitle>
                <CardDescription>Analyzes real leads/opps and prioritizes actions. Does not send messages without integrations + autonomy.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Revenue target</Label>
                  <Input value={target} onChange={(e) => setTarget(e.target.value)} />
                </div>
                <Button onClick={() => void runGenerate()} disabled={busy}><Zap className="w-4 h-4 mr-2" /> Run session</Button>
                {genSession && (
                  <div className="text-sm border rounded-lg p-3 space-y-1">
                    <div>Leads analyzed: <b>{genSession.leadsAnalyzed}</b></div>
                    <div>High-intent: <b>{genSession.highIntentProspects}</b></div>
                    <div>Prioritized actions: <b>{(genSession.prioritizedActions || []).length}</b></div>
                    <div>Executed sends: <b>{genSession.executedSends}</b> (requires channel integration)</div>
                    <p className="text-xs text-muted-foreground">{genSession.note}</p>
                    <ul className="max-h-40 overflow-auto text-xs space-y-1 mt-2">
                      {(genSession.prioritizedActions || []).slice(0, 15).map((a: any, i: number) => (
                        <li key={i} className="flex gap-1"><ChevronRight className="w-3 h-3 mt-0.5" />{a.action}: {a.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Close the gap</CardTitle>
                <CardDescription>Planning math from target vs actual — not a guarantee.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Target</Label><Input value={target} onChange={(e) => setTarget(e.target.value)} /></div>
                  <div><Label>Actual</Label><Input value={actual} onChange={(e) => setActual(e.target.value)} /></div>
                </div>
                <Button variant="outline" onClick={() => void runGap()}>Calculate plan</Button>
                {gapPlan && (
                  <div className="text-sm border rounded-lg p-3 space-y-1">
                    <div>Gap: <b>{Number(gapPlan.gap || 0).toLocaleString()}</b></div>
                    <div>Required pipeline: <b>{Number(gapPlan.requiredPipeline || 0).toLocaleString()}</b></div>
                    <div>Required closed deals: <b>{gapPlan.requiredClosedDeals}</b></div>
                    <p className="text-xs text-muted-foreground">{gapPlan.note}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" /> Objection handler</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea value={objectionIn} onChange={(e) => setObjectionIn(e.target.value)} placeholder="e.g. It's too expensive right now" />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const r = await salesForceApi.objection(objectionIn);
                    setObjectionOut(r);
                  }}
                >
                  Classify & respond
                </Button>
                {objectionOut && (
                  <div className="text-sm border rounded-lg p-3 space-y-1">
                    <div><Badge>{objectionOut.classification}</Badge> <Badge variant="outline">{objectionOut.confidence}</Badge></div>
                    <p><b>Concern:</b> {objectionOut.underlyingConcern}</p>
                    <p><b>Response:</b> {objectionOut.recommendedResponse}</p>
                    <p><b>CTA:</b> {objectionOut.suggestedCta}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity timeline</CardTitle>
              <CardDescription>CRM-style log of AI and system actions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {activities.length === 0 && <p className="text-muted-foreground">No activity yet.</p>}
              {activities.map((a) => (
                <div key={a.id} className="flex gap-3 border-b last:border-0 py-2">
                  <div className="text-xs text-muted-foreground w-36 shrink-0">{String(a.createdAt || "").replace("T", " ").slice(0, 19)}</div>
                  <div>
                    <span className="font-medium">{a.actorName || a.actorType}</span>
                    <span className="text-muted-foreground"> — {a.action}</span>
                    {a.summary && <p className="text-xs text-muted-foreground">{a.summary}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bridge" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Business Diagnostic → Sales</CardTitle>
              <CardDescription>
                Map pillar scores to CINTEXA products, create a lead and opportunity. No invented diagnostics.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {([
                ["companyName", "Company *"],
                ["industry", "Industry"],
                ["health", "Health score"],
                ["weakestPillar", "Weakest pillar"],
                ["website", "Website"],
                ["contactEmail", "Contact email"],
              ] as const).map(([k, label]) => (
                <div key={k}>
                  <Label>{label}</Label>
                  <Input value={(diagForm as any)[k]} onChange={(e) => setDiagForm((f) => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
              <div className="flex items-end gap-2">
                <Button
                  disabled={!diagForm.companyName.trim() || busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const scores: Record<string, number> = {};
                      if (diagForm.weakestPillar) scores[diagForm.weakestPillar.toLowerCase()] = 40;
                      const r = await salesForceApi.fromDiagnostic({
                        ...diagForm,
                        health: Number(diagForm.health) || null,
                        pillarScores: scores,
                        createRecords: true,
                      });
                      setDiagResult(r);
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Map & create opportunity
                </Button>
              </div>
              {diagResult && (
                <div className="sm:col-span-2 lg:col-span-3 border rounded-lg p-3 text-sm space-y-2">
                  <div className="font-medium">Recommendations</div>
                  {(diagResult.mapped?.recommendations || []).map((rec: any, i: number) => (
                    <div key={i} className="border-b last:border-0 py-2">
                      <b>{rec.product}</b> — {rec.reason}
                      <p className="text-xs text-muted-foreground mt-1">{rec.pitch}</p>
                      <Badge variant="outline" className="mt-1">{rec.confidence}</Badge>
                    </div>
                  ))}
                  {diagResult.lead && <p className="text-xs">Lead #{diagResult.lead.id} · Opp #{diagResult.opportunity?.id}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sell" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What should we sell?</CardTitle>
              <CardDescription>Ranked from real lead priority scores — product fit still requires discovery.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                onClick={async () => {
                  const r = await salesForceApi.whatToSell();
                  setWhatSell(r.items || []);
                }}
              >
                Refresh recommendations
              </Button>
              {whatSell.length === 0 && <p className="text-sm text-muted-foreground">No ranked opportunities yet. Add and score leads first.</p>}
              {whatSell.map((item, i) => (
                <div key={i} className="border rounded-lg p-3 text-sm">
                  <div className="font-semibold">{i + 1}. {item.audience}</div>
                  <p className="text-muted-foreground text-xs mt-1">{item.reason}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline">{item.recommendedAgentRole}</Badge>
                    <Badge variant="outline">{item.recommendedChannel}</Badge>
                    <Badge>{item.confidence}</Badge>
                  </div>
                  {item.recommendedPitch && <p className="text-xs mt-2">{item.recommendedPitch}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="ops" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={async () => setDailyBrief(await salesForceApi.dailyBrief(Number(target) || undefined))}>
              Daily brief
            </Button>
            <Button variant="outline" onClick={async () => { await salesForceApi.seedDemo(); await refresh(); }}>
              Seed demo data
            </Button>
          </div>
          {dailyBrief && (
            <Card>
              <CardHeader><CardTitle className="text-base">{dailyBrief.title}</CardTitle>
              <CardDescription>{String(dailyBrief.note || "")}</CardDescription></CardHeader>
              <CardContent className="text-sm space-y-2">
                <div>Target: <b>{dailyBrief.revenueTarget ?? "—"}</b> · Closed: <b>{dailyBrief.revenueClosed}</b> · Gap: <b>{dailyBrief.revenueGap ?? "—"}</b></div>
                <div>Uncontacted: {dailyBrief.leadsRequiringContact} · High intent: {dailyBrief.highIntentProspects}</div>
                <ul className="list-disc pl-5">
                  {(dailyBrief.recommendedActions || []).map((a: string, i: number) => <li key={i}>{a}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">BANT qualification</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Button variant="outline" onClick={async () => {
                  setBantResult(await salesForceApi.qualifyBant({
                    budget: "Confirmed annual software budget",
                    authority: "Ops director",
                    need: "Need CRM follow-up discipline",
                    timeline: "This quarter",
                  }));
                }}>Run sample BANT</Button>
                {bantResult && (
                  <div className="border rounded-lg p-3">
                    Score <b>{bantResult.score}</b> · {bantResult.label} · {bantResult.confidence}
                    <p className="text-xs text-muted-foreground mt-1">Missing: {(bantResult.missing || []).join(", ") || "none"}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Negotiation policy check</CardTitle>
              <CardDescription>Escalates when outside approved limits — never invents discounts.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>List price</Label><Input value={listPrice} onChange={e => setListPrice(e.target.value)} /></div>
                  <div><Label>Requested discount %</Label><Input value={reqDiscount} onChange={e => setReqDiscount(e.target.value)} /></div>
                </div>
                <Button variant="outline" onClick={async () => {
                  setNegResult(await salesForceApi.negotiate({
                    listPrice: Number(listPrice) || 0,
                    requestedDiscountPercent: Number(reqDiscount) || 0,
                    packageName: "Growth",
                  }));
                }}>Evaluate</Button>
                {negResult && (
                  <div className="border rounded-lg p-3">
                    <Badge className={negResult.escalate ? "bg-rose-600" : "bg-emerald-600"}>{negResult.decision}</Badge>
                    <p className="mt-2">{negResult.reason}</p>
                    {negResult.finalPrice != null && <p>Final price: <b>{negResult.finalPrice}</b></p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Quotation engine</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Button variant="outline" onClick={async () => {
                  setQuoteResult(await salesForceApi.createQuote({
                    lineItems: [
                      { name: "CINTEXA CRM annual", quantity: 1, unitPrice: 8000 },
                      { name: "Onboarding", quantity: 1, unitPrice: 2000 },
                    ],
                    discountPercent: 5,
                    taxPercent: 0,
                    currency: "GHS",
                  }));
                }}>Build sample quote</Button>
                {quoteResult && (
                  <div className="border rounded-lg p-3">
                    Total: <b>{quoteResult.currency || quoteResult.calculated?.currency} {quoteResult.total || quoteResult.calculated?.total}</b>
                    <p className="text-xs text-muted-foreground mt-1">{quoteResult.note || quoteResult.calculated?.note}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Proposal PDF</CardTitle></CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => {
                  downloadProposalPdf({
                    title: "CINTEXA Proposal",
                    companyName: leadForm.companyName || "Customer",
                    contactName: leadForm.contactName,
                    body: {
                      executiveSummary: "Proposal based on discovery — scope subject to confirmation.",
                      customerProblem: "To be confirmed",
                      proposedSolution: "CINTEXA modules justified by diagnostic/sales evidence",
                      scope: ["Discovery", "Configuration", "Training"],
                      deliverables: ["Implementation plan", "Configured workspace"],
                      timeline: "To be confirmed",
                      pricing: { amount: null, currency: "GHS", note: "Requires authorized quote" },
                      nextSteps: ["Review", "Clarify", "Confirm terms within policy"],
                    },
                  });
                }}>Download proposal PDF</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>


        <TabsContent value="warroom" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Command interface</CardTitle>
              <CardDescription>Keyword commands over live data — not fabricated answers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={commandText} onChange={(e) => setCommandText(e.target.value)} placeholder='e.g. "Show me all deals at risk"' />
              <div className="flex flex-wrap gap-2">
                <Button onClick={async () => setCommandResult(await salesForceApi.command(commandText))}>Run</Button>
                {["Find uncontacted high-value leads", "Show me all deals at risk", "Top revenue opportunities", "Who should I contact today", "Deals likely to close"].map((c) => (
                  <Button key={c} size="sm" variant="outline" onClick={async () => { setCommandText(c); setCommandResult(await salesForceApi.command(c)); }}>{c}</Button>
                ))}
              </div>
              {commandResult && (
                <div className="border rounded-lg p-3 text-sm space-y-2">
                  <div><Badge>{commandResult.intent}</Badge> {commandResult.message}</div>
                  <pre className="text-xs overflow-auto max-h-48 bg-muted/40 p-2 rounded">{JSON.stringify(commandResult.result, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Follow-up sequences</CardTitle>
              <CardDescription>Prepare due steps; execute only with autonomy + SMTP.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={async () => {
                    const r = await salesForceApi.sequencesDue();
                    setSeqPlan(r.planned || []);
                  }}>Load due</Button>
                  <Button variant="outline" onClick={async () => {
                    await salesForceApi.runSequences({ execute: false, autonomyLevel: 1 });
                    const r = await salesForceApi.sequencesDue();
                    setSeqPlan(r.planned || []);
                    await refresh();
                  }}>Prepare run</Button>
                </div>
                {seqPlan.length === 0 && <p className="text-muted-foreground">No due sequence steps.</p>}
                {seqPlan.slice(0, 10).map((s, i) => (
                  <div key={i} className="border rounded p-2">
                    <b>{s.companyName}</b> — {s.label} (day {s.sequenceDay})
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Agent performance</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Button variant="outline" onClick={async () => {
                  const r = await salesForceApi.performance();
                  setPerf(r.items || []);
                }}>Refresh scores</Button>
                {perf.map((p) => (
                  <div key={p.agentId} className="flex justify-between border-b py-1">
                    <span>{p.agentName}</span>
                    <span className="font-semibold tabular-nums">{p.performanceScore}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Reactivation candidates</CardTitle>
              <CardDescription>Grace / reactivation — consent required before contact.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Button variant="outline" onClick={async () => setReactivation(await salesForceApi.reactivation())}>Scan</Button>
                {reactivation && (
                  <div className="grid md:grid-cols-3 gap-3">
                    <div>
                      <div className="font-medium mb-1">Dormant leads</div>
                      {(reactivation.dormantLeads || []).slice(0, 5).map((x: any) => (
                        <div key={x.id} className="text-xs border-b py-1">{x.companyName}</div>
                      ))}
                    </div>
                    <div>
                      <div className="font-medium mb-1">Lost opps</div>
                      {(reactivation.lostOpportunities || []).slice(0, 5).map((x: any) => (
                        <div key={x.id} className="text-xs border-b py-1">{x.name}</div>
                      ))}
                    </div>
                    <div>
                      <div className="font-medium mb-1">Abandoned proposals</div>
                      {(reactivation.abandonedProposals || []).slice(0, 5).map((x: any) => (
                        <div key={x.id} className="text-xs border-b py-1">{x.name}</div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>


      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 text-sm flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <b>Guardrails:</b> No invented prices, discounts, features, customer data, or closed revenue.
            Outreach requires consent + configured channels. Negotiation only within admin limits; escalate otherwise.
            Apply migration <code className="text-xs">20260820090000_sales_force.sql</code> for persistence.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
