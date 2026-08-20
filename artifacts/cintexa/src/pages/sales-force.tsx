import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot, Users, Target, TrendingUp, Zap, Phone, FileText, Shield,
  Play, Pause, RefreshCw, Plus, Sparkles, AlertTriangle, ChevronRight,
} from "lucide-react";
import { salesForceApi } from "@/lib/sales-force-api";
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
      </Tabs>

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
