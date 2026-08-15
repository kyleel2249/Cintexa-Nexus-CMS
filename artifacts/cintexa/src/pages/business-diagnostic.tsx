import { useMemo, useState, useEffect } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bot, CheckCircle2, ChevronLeft,
  ChevronRight, CircleHelp, Download, Gauge, GitCompare, Goal as GoalIcon, Lightbulb,
  Network, Plus, RefreshCw, ShieldAlert, Sparkles, Target, TrendingUp, Users,
  XCircle, Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  buildAdaptiveQuestions, calculateBusinessHealth, calculateSalesMetrics, initialMetrics,
  pillars, questionBank, scoreSeverity, type Competitor, type DiagnosticMode, type Goal, type Metric,
} from "@/lib/business-diagnostic";
import { diagnosticApi } from "@/lib/diagnostic-api";
import { downloadDiagnosticPdf } from "@/lib/diagnostic-report-pdf";

const modes: { id: DiagnosticMode; label: string; minutes: string; description: string }[] = [
  { id: "quick", label: "Quick Scan", minutes: "10–15 min", description: "Rapid health and priority scan" },
  { id: "standard", label: "Standard", minutes: "30–45 min", description: "Comprehensive business assessment" },
  { id: "deep", label: "Deep Diagnostic", minutes: "60–120+ min", description: "Full evidence-led diagnosis" },
  { id: "executive", label: "Executive", minutes: "15–25 min", description: "CEO decision view" },
  { id: "sales", label: "Sales", minutes: "15–25 min", description: "Revenue engine diagnosis" },
  { id: "marketing", label: "Marketing", minutes: "15–25 min", description: "Acquisition and conversion" },
  { id: "competitive", label: "Competitive", minutes: "20–35 min", description: "Market and competitor position" },
  { id: "digital", label: "Digital", minutes: "20–35 min", description: "Technology, AI and automation" },
];

const starterScores: Record<string, number> = {
  strategy: 68, sales: 48, marketing: 72, customer: 64, operations: 57,
  finance: 81, technology: 43, automation: 39, competitive: 58,
};

const starterProblems = [
  { title: "Sales funnel leakage", impact: "High", evidence: "USER PROVIDED", detail: "Conversion is the first area to validate because lead volume alone cannot explain revenue movement.", action: "Audit qualification, follow-up speed, stage conversion and lost-deal reasons." },
  { title: "Disconnected systems", impact: "High", evidence: "INFERRED", detail: "A low technology score suggests duplicate entry and fragmented management information.", action: "Map CRM, finance, commerce, support and analytics data flows." },
  { title: "Automation opportunity", impact: "High", evidence: "INFERRED", detail: "Manual workflows are a likely source of avoidable time and response delays.", action: "Rank recurring workflows using impact, effort, risk and expected ROI." },
  { title: "Competitive evidence gap", impact: "Medium", evidence: "UNKNOWN", detail: "Competitor conclusions should not be treated as facts until dated public evidence is attached.", action: "Create a competitor scorecard and attach source/date to every external claim." },
];

function EvidenceBadge({ type }: { type: string }) {
  const tone: Record<string, string> = {
    VERIFIED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    "USER PROVIDED": "bg-blue-500/10 text-blue-600 border-blue-500/20",
    CALCULATED: "bg-violet-500/10 text-violet-600 border-violet-500/20",
    BENCHMARKED: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    INFERRED: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    UNKNOWN: "bg-muted text-muted-foreground border-border",
  };
  return <Badge variant="outline" className={cn("text-[10px] font-semibold", tone[type] || tone.UNKNOWN)}>{type}</Badge>;
}

function ScoreRing({ score, label, size = "md" }: { score: number; label: string; size?: "sm" | "md" | "lg" }) {
  const radius = size === "lg" ? 48 : size === "md" ? 39 : 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className={cn("relative shrink-0", size === "lg" ? "w-32 h-32" : size === "md" ? "w-24 h-24" : "w-16 h-16")}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="9" className="text-muted/30" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" className="text-primary" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-bold", size === "lg" ? "text-2xl" : size === "md" ? "text-xl" : "text-sm")}>{score}</span>
        {size !== "sm" && <span className="text-[9px] text-muted-foreground">/ 100</span>}
      </div>
      {size !== "sm" && <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-muted-foreground">{label}</div>}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return <div className="flex items-start gap-3 mb-5"><div className="p-2 rounded-lg bg-primary/10 text-primary"><Icon className="w-5 h-5" /></div><div><h2 className="text-xl font-semibold tracking-tight">{title}</h2><p className="text-sm text-muted-foreground mt-1">{description}</p></div></div>;
}

export default function BusinessDiagnostic() {
  const [mode, setMode] = useState<DiagnosticMode>("standard");
  const [stage, setStage] = useState<"overview" | "profile" | "questions" | "results" | "strategy" | "execution">("overview");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});
  const [company, setCompany] = useState({ name: "", website: "", industry: "", subIndustry: "", model: "B2B", market: "", employees: "", revenue: "", objective: "" });
  const [metrics, setMetrics] = useState<Metric[]>(initialMetrics);
  const [scores, setScores] = useState(starterScores);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [newCompetitor, setNewCompetitor] = useState("");
  const [newCompetitorWebsite, setNewCompetitorWebsite] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [taskHistory, setTaskHistory] = useState<Array<{ id: string; taskType: string; title: string; detail?: string; createdAt: string; status: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<Array<{ name: string; size: number; mimeType: string; text?: string }>>([]);
  const [researchNotes, setResearchNotes] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [scenarioConversion, setScenarioConversion] = useState(12);
  const [scenarioAov, setScenarioAov] = useState(10);

  const questions = useMemo(() => buildAdaptiveQuestions(answers), [answers]);
  const currentQuestion = questions[questionIndex];
  const health = calculateBusinessHealth(scores);
  const severity = scoreSeverity(health);
  const sales = calculateSalesMetrics(metrics);
  const strongest = [...pillars].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))[0];
  const weakest = [...pillars].sort((a, b) => (scores[a.id] ?? 0) - (scores[b.id] ?? 0))[0];
  const monthlyLeads = metrics.find(m => m.id === "monthlyLeads")?.value ?? 0;
  const customers = metrics.find(m => m.id === "customers")?.value ?? 0;
  const aov = metrics.find(m => m.id === "aov")?.value ?? 0;
  const scenarioCustomers = monthlyLeads ? Math.round(monthlyLeads * scenarioConversion / 100) : 0;
  const scenarioRevenue = scenarioCustomers * (aov ? aov * (1 + scenarioAov / 100) : 0);

  function updateMetric(id: string, raw: string) {
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, value: raw === "" ? null : Number(raw) } : m));
  }

  function answerQuestion(value: string | number | boolean) {
    if (!currentQuestion) return;
    const next = { ...answers, [currentQuestion.id]: value };
    setAnswers(next);
    const pillar = currentQuestion.pillar;
    const positive = value === true || value === 5 || value === "Closing" || value === "Lead volume" ? 10 : 0;
    setScores(prev => ({ ...prev, [pillar]: Math.min(100, Math.max(0, (prev[pillar] ?? 50) + positive - (value === false ? 7 : 0))) }));
    if (questionIndex < questions.length - 1) setQuestionIndex(i => i + 1);
    else setStage("results");
  }

  function addCompetitor() {
    const name = newCompetitor.trim();
    if (!name) return;
    const website = newCompetitorWebsite.trim();
    setCompetitors(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      website,
      positioning: "User-provided competitor",
      score: 0,
      pricing: "",
      strengths: [],
      weaknesses: [],
    } as any]);
    setNewCompetitor("");
    setNewCompetitorWebsite("");
    const entry = { id: crypto.randomUUID(), taskType: "competitor_added", title: `Added competitor: ${name}`, detail: website || undefined, status: "completed", createdAt: new Date().toISOString() };
    setTaskHistory(prev => [entry, ...prev]);
    try {
      const key = "cintexa-diagnostic-task-history";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([entry, ...existing].slice(0, 200)));
    } catch { /* ignore */ }
  }

  function addGoal(level: Goal["level"]) {
    const goal: Goal = { id: crypto.randomUUID(), title: level === "strategic" ? "Increase qualified revenue" : level === "tactical" ? "Increase qualified opportunities" : "Complete qualified prospect meetings weekly", level, owner: level === "strategic" ? "CEO / Founder" : level === "tactical" ? "Department Lead" : "Sales Team", baseline: level === "strategic" ? 100 : 8, target: level === "strategic" ? 140 : level === "tactical" ? 12 : 20, unit: level === "operational" ? "meetings/week" : "%", deadline: "2026-12-31", status: "Not Started", smart: { specific: true, measurable: true, achievable: false, relevant: true, timeBound: true } };
    setGoals(prev => [...prev, goal]);
  }

  function printReport() { window.print(); }

  if (stage === "overview") return (
    <div className="space-y-7 pb-12">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div><div className="flex items-center gap-2 text-primary text-sm font-semibold mb-2"><Sparkles className="w-4 h-4" /> NEXUS INTELLIGENCE ENGINE</div><h1 className="text-3xl font-bold tracking-tight">Business Diagnostic</h1><p className="text-muted-foreground mt-2 max-w-2xl">Turn business information into diagnosis, evidence, priorities, SMART goals and an execution system. The engine separates facts, calculations, benchmarks and inference.</p></div>
        <Button size="lg" onClick={() => setStage("profile")}><Activity className="w-4 h-4 mr-2" /> Start diagnostic <ArrowRight className="w-4 h-4 ml-2" /></Button>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[[Gauge, "Adaptive diagnosis", "Questions change as weak signals appear"], [GitCompare, "Benchmarking", "Company, industry and competitor gaps"], [GoalIcon, "Goal cascade", "Strategy → tactics → operations → KPI"], [Bot, "Evidence-aware AI", "Facts and inference remain visibly separate"]].map(([Icon, title, text]) => <Card key={String(title)}><CardContent className="p-5"><div className="p-2 rounded-lg bg-primary/10 w-fit mb-4"><Icon className="w-5 h-5 text-primary" /></div><h3 className="font-semibold">{String(title)}</h3><p className="text-sm text-muted-foreground mt-1">{String(text)}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle>Choose diagnostic depth</CardTitle><CardDescription>Start small or run the full strategic assessment.</CardDescription></CardHeader><CardContent><div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">{modes.map(m => <button key={m.id} onClick={() => setMode(m.id)} className={cn("text-left rounded-xl border p-4 transition-all hover:border-primary/50", mode === m.id && "border-primary bg-primary/5 ring-1 ring-primary/20")}><div className="flex justify-between gap-2"><span className="font-medium">{m.label}</span><Badge variant="secondary">{m.minutes}</Badge></div><p className="text-xs text-muted-foreground mt-2">{m.description}</p></button>)}</div></CardContent></Card>
      <div className="grid lg:grid-cols-3 gap-4"><Card className="lg:col-span-2"><CardHeader><CardTitle>Diagnostic architecture</CardTitle></CardHeader><CardContent><div className="flex flex-wrap items-center gap-2 text-sm">{["Current State", "Evidence", "Root Cause", "Priority", "Strategy", "SMART Goal", "Tactics", "Operations", "KPI", "Review"].map((x, i) => <div key={x} className="flex items-center gap-2"><span className="px-3 py-2 rounded-lg bg-muted font-medium">{x}</span>{i < 9 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}</div>)}</div></CardContent></Card><Card><CardHeader><CardTitle>Evidence standard</CardTitle></CardHeader><CardContent className="space-y-2">{["VERIFIED", "USER PROVIDED", "CALCULATED", "BENCHMARKED", "INFERRED", "UNKNOWN"].map(x => <div key={x} className="flex justify-between items-center"><EvidenceBadge type={x} /><span className="text-xs text-muted-foreground">{x === "UNKNOWN" ? "Insufficient evidence" : "Traceable conclusion"}</span></div>)}</CardContent></Card></div>
    </div>
  );

  if (stage === "profile") return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <SectionTitle icon={Network} title="Company intelligence profile" description="Start with the operating context. Missing data stays missing instead of becoming an invented assumption." />
      <Card><CardContent className="p-6"><div className="grid md:grid-cols-2 gap-5">{[["name","Company name"],["website","Company website (optional)"],["industry","Industry"],["subIndustry","Sub-industry"],["market","Geographic markets"],["employees","Employees"],["revenue","Revenue range"],["objective","Primary strategic objective"]].map(([key,label]) => <div key={key} className={key === "objective" ? "md:col-span-2" : ""}><Label>{label}</Label><Input className="mt-2" value={company[key as keyof typeof company]} onChange={e => setCompany({...company, [key]: e.target.value})} placeholder={`Enter ${label.toLowerCase()}`} /></div>)}<div><Label>Business model</Label><select className="mt-2 w-full h-10 rounded-md border bg-background px-3 text-sm" value={company.model} onChange={e => setCompany({...company, model:e.target.value})}><option>B2B</option><option>B2C</option><option>B2B2C</option><option>Marketplace</option><option>Subscription</option></select></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Core business metrics</CardTitle><CardDescription>Numbers drive the calculations. Leave unavailable fields blank.</CardDescription></CardHeader><CardContent><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{metrics.map(m => <div key={m.id}><Label>{m.label} <span className="text-muted-foreground">({m.unit})</span></Label><Input className="mt-2" type="number" min="0" value={m.value ?? ""} onChange={e => updateMetric(m.id, e.target.value)} /></div>)}</div></CardContent></Card>
      <div className="flex justify-between"><Button variant="outline" onClick={() => setStage("overview")}><ChevronLeft className="w-4 h-4 mr-1"/> Back</Button><Button onClick={() => setStage("questions")}>Continue to adaptive diagnostic <ChevronRight className="w-4 h-4 ml-1"/></Button></div>
    </div>
  );

  if (stage === "questions") return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between"><div><Badge variant="outline">{mode.toUpperCase()} DIAGNOSTIC</Badge><h1 className="text-2xl font-bold mt-2">Adaptive assessment</h1></div><span className="text-sm text-muted-foreground">{questionIndex + 1} / {questions.length}</span></div>
      <Progress value={((questionIndex + 1) / questions.length) * 100} />
      <Card className="min-h-[360px]"><CardHeader><div className="flex items-center justify-between"><Badge>{questions[questionIndex]?.pillar}</Badge><CircleHelp className="w-5 h-5 text-muted-foreground" /></div><CardTitle className="text-2xl leading-relaxed mt-4">{currentQuestion?.text}</CardTitle><CardDescription>Answer from the evidence you have. CINTEXA will use the response to determine the next useful question.</CardDescription></CardHeader><CardContent className="space-y-3">
        {currentQuestion?.type === "boolean" && <div className="grid grid-cols-2 gap-3"><Button variant="outline" className="h-16" onClick={() => answerQuestion(true)}><CheckCircle2 className="w-5 h-5 mr-2 text-emerald-500"/> Yes</Button><Button variant="outline" className="h-16" onClick={() => answerQuestion(false)}><XCircle className="w-5 h-5 mr-2 text-rose-500"/> No</Button></div>}
        {currentQuestion?.type === "scale" && <div className="grid grid-cols-5 gap-2">{[1,2,3,4,5].map(n => <Button key={n} variant="outline" className="h-14" onClick={() => answerQuestion(n)}>{n}</Button>)}</div>}
        {currentQuestion?.type === "select" && <div className="grid sm:grid-cols-2 gap-3">{currentQuestion.options?.map(x => <Button key={x} variant="outline" className="justify-start h-12" onClick={() => answerQuestion(x)}>{x}</Button>)}</div>}
        {currentQuestion?.type === "text" && <TextAnswer onSubmit={answerQuestion} />}
        {currentQuestion?.type === "number" && <TextAnswer number onSubmit={answerQuestion} />}
      </CardContent></Card>
      <div className="flex justify-between"><Button variant="ghost" onClick={() => setStage("profile")}><ChevronLeft className="w-4 h-4 mr-1"/> Profile</Button><span className="text-xs text-muted-foreground self-center">Weak signals trigger follow-up questions automatically.</span></div>
    </div>
  );

  
  
  const logTaskLocal = async (taskType: string, title: string, detail?: string, metadata?: Record<string, unknown>) => {
    const entry = { id: crypto.randomUUID(), taskType, title, detail, status: "completed", createdAt: new Date().toISOString() };
    setTaskHistory((prev) => [entry, ...prev]);
    try {
      const key = "cintexa-diagnostic-task-history";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([entry, ...existing].slice(0, 200)));
    } catch { /* ignore */ }
    try { await diagnosticApi.logTask({ taskType, title, detail, metadata, actor: "user" }); } catch { /* optional */ }
  };

  useEffect(() => {
    try {
      const existing = JSON.parse(localStorage.getItem("cintexa-diagnostic-task-history") || "[]");
      if (Array.isArray(existing) && existing.length) setTaskHistory(existing);
    } catch { /* ignore */ }
  }, []);

  const downloadDetailedPdf = async () => {
    setReportBusy(true);
    try {
      const report = await diagnosticApi.fullReport({
        companyName: company.name || "Company",
        industry: company.industry,
        metrics: {
          monthlyLeads: metrics.find(m => m.id === "monthlyLeads")?.value,
          monthlyQualifiedLeads: metrics.find(m => m.id === "qualifiedLeads")?.value,
          monthlyCustomers: metrics.find(m => m.id === "customers")?.value,
          avgTransactionValue: metrics.find(m => m.id === "aov")?.value,
          customerAcquisitionCost: metrics.find(m => m.id === "cac")?.value,
          salesCycleDays: metrics.find(m => m.id === "salesCycle")?.value,
        },
        pillarScores: scores,
        competitors: competitors.map(c => ({ name: c.name, positioning: c.positioning, strengths: Array.isArray(c.strengths) ? c.strengths.join(", ") : "", weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses.join(", ") : "" })),
      });
      downloadDiagnosticPdf(report as any);
      await logTaskLocal("pdf_export", "Downloaded detailed diagnostic PDF", company.name || "Company");
    } catch (err) {
      console.error(err);
      window.print();
    } finally {
      setReportBusy(false);
    }
  };

  const handleDocumentUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setDocBusy(true);
    try {
      const files = await Promise.all(Array.from(fileList).map(async (file) => {
        let text: string | undefined;
        if (file.type.startsWith("text/") || /\.(md|csv|json|txt)$/i.test(file.name)) text = await file.text();
        return { name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", text };
      }));
      setUploadedDocs(prev => [...prev, ...files]);
      await diagnosticApi.uploadDocuments(files);
      await logTaskLocal("document_upload", `Uploaded ${files.length} document(s)`, files.map(f => f.name).join(", "));
    } catch (err) { console.error(err); }
    finally { setDocBusy(false); }
  };

  const runResearch = async () => {
    try {
      const result = await diagnosticApi.research({
        companyName: company.name,
        companyWebsite: (company as any).website,
        industry: company.industry,
        competitors: competitors.map(c => ({ name: c.name, website: (c as any).website || "" })),
      });
      setResearchNotes(JSON.stringify(result, null, 2));
      await logTaskLocal("research", "Company & competitor research", `Researched ${company.name || "company"} with ${competitors.length} competitor(s)`, { website: (company as any).website });
    } catch {
      setResearchNotes("Research endpoint unavailable. Competitor claims remain USER PROVIDED until sources are attached.");
    }
  };

if (stage === "results") return (
    <div className="space-y-7 pb-12 print:pb-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div><div className="text-primary text-sm font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4"/> YOUR BUSINESS DIAGNOSIS</div><h1 className="text-3xl font-bold mt-1">{company.name || "Business"} intelligence report</h1><p className="text-muted-foreground mt-1">Evidence-led diagnosis with explicit uncertainty and actionable priorities.</p></div><div className="flex gap-2 print:hidden"><Button variant="outline" onClick={() => setStage("questions")}><RefreshCw className="w-4 h-4 mr-2"/> Reassess</Button><Button onClick={downloadDetailedPdf} disabled={reportBusy}><Download className="w-4 h-4 mr-2"/> {reportBusy ? "Building PDF…" : "Download detailed PDF"}</Button><Button variant="outline" onClick={printReport}>Print</Button></div></div>
      <div className="grid lg:grid-cols-[auto_1fr] gap-5"><Card><CardContent className="p-8 flex flex-col items-center justify-center min-w-[180px]"><ScoreRing score={health} label="Business Health" size="lg"/><Badge className="mt-8">{severity}</Badge></CardContent></Card><Card><CardHeader><CardTitle>Executive readout</CardTitle><CardDescription>What CINTEXA would put in front of leadership first.</CardDescription></CardHeader><CardContent className="grid sm:grid-cols-2 gap-4"><Readout title="Strongest pillar" value={`${strongest.label} — ${scores[strongest.id]}/100`} icon={TrendingUp} tone="good" /><Readout title="Priority pillar" value={`${weakest.label} — ${scores[weakest.id]}/100`} icon={AlertTriangle} tone="risk" /><Readout title="Biggest revenue leak" value="Sales funnel conversion requires validation" icon={BarChart3} tone="risk" /><Readout title="Evidence gap" value="Competitor benchmarks need dated sources" icon={ShieldAlert} tone="neutral" /></CardContent></Card></div>
      <Card><CardHeader><CardTitle>Diagnostic pillar scorecard</CardTitle><CardDescription>Scores are a working diagnostic model. They should strengthen as evidence is supplied.</CardDescription></CardHeader><CardContent><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{pillars.map(p => <div key={p.id} className="border rounded-xl p-4"><div className="flex justify-between mb-2"><span className="font-medium">{p.label}</span><span className="font-bold">{scores[p.id]}/100</span></div><Progress value={scores[p.id]} /><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{scoreSeverity(scores[p.id])}</span><span>{p.weight}% weight</span></div></div>)}</div></CardContent></Card>
      <div className="grid xl:grid-cols-2 gap-5"><Card><CardHeader><CardTitle>Top problems</CardTitle></CardHeader><CardContent className="space-y-3">{starterProblems.map((p, i) => <div key={p.title} className="border rounded-xl p-4"><div className="flex justify-between gap-3"><div><div className="flex items-center gap-2"><span className="text-xs font-bold text-muted-foreground">0{i+1}</span><h3 className="font-semibold">{p.title}</h3></div><p className="text-sm text-muted-foreground mt-2">{p.detail}</p></div><EvidenceBadge type={p.evidence}/></div><div className="mt-3 p-3 rounded-lg bg-muted/60 text-sm"><b>Action:</b> {p.action}</div></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Sales intelligence</CardTitle><CardDescription>Calculated only where source metrics exist.</CardDescription></CardHeader><CardContent className="space-y-4">{[["Lead → customer conversion", sales.conversion, "%"],["Qualified lead rate", sales.qualification, "%"],["Projected revenue from customer count", sales.revenue, "GHS"],["CAC", sales.cac, "GHS"]].map(([label,value,unit]) => <div key={String(label)} className="flex justify-between items-center border-b last:border-0 pb-3 last:pb-0"><span className="text-sm">{String(label)}</span><span className="font-semibold">{value === null ? "Unknown" : `${Number(value).toFixed(1)} ${unit}`} {value !== null && <EvidenceBadge type="CALCULATED"/>}</span></div>)}</CardContent></Card></div>
      <Card><CardHeader><CardTitle>Root-cause chain</CardTitle><CardDescription>Symptoms are kept separate from hypotheses.</CardDescription></CardHeader><CardContent><div className="grid md:grid-cols-5 gap-2 items-center">{["Observed Problem", "Evidence", "Possible Causes", "Root Cause", "Intervention"].map((x,i)=><div key={x} className="flex items-center gap-2"><div className="flex-1 border rounded-xl p-4 text-center"><div className="text-xs text-muted-foreground">STEP {i+1}</div><div className="font-semibold mt-1">{x}</div><div className="text-xs text-muted-foreground mt-2">{i === 0 ? "Sales performance signal" : i === 1 ? "User data + calculations" : i === 2 ? "Qualification / follow-up / offer" : i === 3 ? "Validate with funnel evidence" : "Target the confirmed constraint"}</div></div>{i < 4 && <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0"/>}</div>)}</div></CardContent></Card>
      <Tabs defaultValue="competitive"><TabsList className="grid grid-cols-4 w-full"><TabsTrigger value="competitive">Competition</TabsTrigger><TabsTrigger value="benchmarks">Benchmarks</TabsTrigger><TabsTrigger value="scenarios">What If?</TabsTrigger><TabsTrigger value="cases">Case Intelligence</TabsTrigger></TabsList><TabsContent value="competitive" className="mt-4"><Competitive competitors={competitors} newCompetitor={newCompetitor} setNewCompetitor={setNewCompetitor} addCompetitor={addCompetitor} newCompetitorWebsite={newCompetitorWebsite} setNewCompetitorWebsite={setNewCompetitorWebsite}/></TabsContent><TabsContent value="benchmarks" className="mt-4"><Benchmark scores={scores}/></TabsContent><TabsContent value="scenarios" className="mt-4"><Scenario monthlyLeads={Number(monthlyLeads)} customers={Number(customers)} aov={Number(aov)} conversion={scenarioConversion} setConversion={setScenarioConversion} aovLift={scenarioAov} setAovLift={setScenarioAov} projectedCustomers={scenarioCustomers} projectedRevenue={scenarioRevenue}/></TabsContent><TabsContent value="cases" className="mt-4"><CaseIntelligence weakest={weakest.label}/></TabsContent></Tabs>
      <Card className="print:hidden"><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Task history</CardTitle><CardDescription>Every diagnostic action is recorded and accessible here.</CardDescription></div><Button variant="outline" size="sm" onClick={() => setShowHistory(v => !v)}>{showHistory ? "Hide" : "Show"} history ({taskHistory.length})</Button></CardHeader>{showHistory && <CardContent><div className="space-y-2 max-h-72 overflow-y-auto">{taskHistory.length === 0 ? <p className="text-sm text-muted-foreground">No tasks recorded yet.</p> : taskHistory.map(t => <div key={t.id} className="border rounded-lg p-3 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="font-medium">{t.title}</div><div className="text-xs text-muted-foreground mt-0.5">{t.detail || t.taskType}</div></div><div className="text-xs text-muted-foreground shrink-0">{new Date(t.createdAt).toLocaleString()} · {t.status}</div></div>)}</div></CardContent>}</Card>
      <Card className="print:hidden"><CardHeader><CardTitle>Supporting documents & market research</CardTitle><CardDescription>Upload plans, financials or CRM exports. Research never fabricates competitor facts.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-3 items-center"><label className="inline-flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer hover:bg-muted"><input type="file" multiple className="hidden" onChange={e => handleDocumentUpload(e.target.files)} />{docBusy ? "Uploading…" : "Upload documents"}</label><Button variant="outline" onClick={runResearch}>Research company & competitors</Button></div>{uploadedDocs.length > 0 && <ul className="text-sm space-y-1">{uploadedDocs.map((d,i)=><li key={i} className="flex justify-between border-b py-1"><span>{d.name}</span><span className="text-muted-foreground">{Math.round(d.size/1024)} KB · USER PROVIDED</span></li>)}</ul>}{researchNotes && <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap">{researchNotes}</pre>}</CardContent></Card>
      <div className="flex justify-end gap-2 print:hidden"><Button variant="outline" onClick={() => setStage("profile")}>Edit inputs</Button><Button onClick={() => setStage("strategy")}>Build strategy <ArrowRight className="w-4 h-4 ml-2"/></Button></div>
    </div>
  );

  if (stage === "strategy") return <Strategy goals={goals} addGoal={addGoal} onBack={() => setStage("results")} onNext={() => setStage("execution")} />;
  return <Execution goals={goals} onBack={() => setStage("strategy")} health={health} />;
}

function TextAnswer({ number, onSubmit }: { number?: boolean; onSubmit: (v: string | number) => void }) { const [value,setValue]=useState(""); return <div className="flex gap-2"><Input type={number ? "number" : "text"} value={value} onChange={e=>setValue(e.target.value)} placeholder={number ? "Enter a number" : "Type your evidence-based answer"} /><Button disabled={!value} onClick={()=>onSubmit(number ? Number(value) : value)}>Continue <ArrowRight className="w-4 h-4 ml-2"/></Button></div>; }
function Readout({ title, value, icon: Icon, tone }: { title:string; value:string; icon:React.ElementType; tone:string }) { return <div className="border rounded-xl p-4"><div className={cn("flex items-center gap-2 text-sm font-medium", tone === "risk" ? "text-orange-600" : tone === "good" ? "text-emerald-600" : "text-primary")}><Icon className="w-4 h-4"/>{title}</div><div className="font-semibold mt-2">{value}</div></div>; }
function Competitive({ competitors,newCompetitor,setNewCompetitor,addCompetitor,newCompetitorWebsite,setNewCompetitorWebsite }: any) { return <Card><CardHeader><CardTitle>Competitive intelligence center</CardTitle><CardDescription>Optionally add each competitor website to ground strategy and improvement recommendations.</CardDescription></CardHeader><CardContent><div className="flex flex-col sm:flex-row gap-2 mb-5"><Input value={newCompetitor} onChange={e=>setNewCompetitor(e.target.value)} placeholder="Competitor name"/><Input value={newCompetitorWebsite||""} onChange={e=>setNewCompetitorWebsite?.(e.target.value)} placeholder="Website (optional)"/><Button onClick={addCompetitor}><Plus className="w-4 h-4 mr-2"/> Add</Button></div>{competitors.length===0 ? <div className="border border-dashed rounded-xl p-8 text-center text-muted-foreground">No competitors entered yet. Add direct competitors to activate the scorecard.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left p-3">Company</th><th className="text-left p-3">Website</th><th className="text-left p-3">Positioning</th><th className="text-left p-3">Score</th><th className="text-left p-3">Evidence</th></tr></thead><tbody>{competitors.map((c:Competitor)=><tr key={c.id} className="border-b last:border-0"><td className="p-3 font-medium">{c.name}</td><td className="p-3 text-muted-foreground text-xs">{(c as any).website || "—"}</td><td className="p-3 text-muted-foreground">{c.positioning}</td><td className="p-3">{c.score || "Unknown"}</td><td className="p-3"><EvidenceBadge type="UNKNOWN"/></td></tr>)}</tbody></table></div>}</CardContent></Card>; }
function Benchmark({ scores }: { scores:Record<string,number> }) { return <Card><CardHeader><CardTitle>Benchmarking engine</CardTitle><CardDescription>Benchmark values are intentionally unavailable until a reliable source or administrator-entered benchmark exists.</CardDescription></CardHeader><CardContent className="space-y-3">{pillars.map(p=><div key={p.id} className="grid grid-cols-[1fr_80px_120px] gap-3 items-center"><span className="text-sm">{p.label}</span><span className="font-semibold">{scores[p.id]}</span><span><EvidenceBadge type="UNKNOWN"/></span></div>)}</CardContent></Card>; }
function Scenario({monthlyLeads,customers,aov,conversion,setConversion,aovLift,setAovLift,projectedCustomers,projectedRevenue}:any) { return <Card><CardHeader><CardTitle>What-if strategy simulator</CardTitle><CardDescription>Scenarios are projections, not guarantees. Blank source data produces no invented financial result.</CardDescription></CardHeader><CardContent className="grid lg:grid-cols-2 gap-7"><div className="space-y-5"><div><Label>Lead-to-customer conversion: {conversion}%</Label><input className="w-full mt-3" type="range" min="1" max="30" value={conversion} onChange={e=>setConversion(Number(e.target.value))}/></div><div><Label>Average transaction value lift: +{aovLift}%</Label><input className="w-full mt-3" type="range" min="0" max="50" value={aovLift} onChange={e=>setAovLift(Number(e.target.value))}/></div><div className="text-xs text-muted-foreground">Inputs: {monthlyLeads || "Unknown"} leads/month, {customers || "Unknown"} customers/month, {aov || "Unknown"} GHS AOV.</div></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-muted p-5"><div className="text-xs text-muted-foreground">Projected customers</div><div className="text-2xl font-bold mt-2">{projectedCustomers || "Unknown"}</div></div><div className="rounded-xl bg-muted p-5"><div className="text-xs text-muted-foreground">Projected monthly revenue</div><div className="text-2xl font-bold mt-2">{projectedRevenue ? `${Math.round(projectedRevenue).toLocaleString()} GHS` : "Unknown"}</div></div></div></CardContent></Card>; }
function CaseIntelligence({ weakest }: { weakest:string }) { const cases:any = { Sales:"Sales funnel redesign and disciplined follow-up", Marketing:"Channel attribution and conversion optimization", Technology:"Integrated data and management information", Operations:"Process standardization and automation", Finance:"Unit economics and margin management" }; const lesson=cases[weakest] || "Evidence-led management and focused execution"; return <Card><CardHeader><CardTitle>Case study matching</CardTitle><CardDescription>Cases are lessons to adapt, not templates to copy.</CardDescription></CardHeader><CardContent><div className="border rounded-xl p-5"><div className="flex items-center gap-2 text-primary text-sm font-semibold"><Lightbulb className="w-4 h-4"/> MATCHED LESSON</div><h3 className="text-lg font-semibold mt-2">{lesson}</h3><p className="text-sm text-muted-foreground mt-2">CINTEXA will require a credible source before treating a company case as verified. The immediate client application is to validate the same operating constraint with internal evidence.</p><div className="mt-4"><EvidenceBadge type="UNKNOWN"/></div></div></CardContent></Card>; }
function Strategy({goals,addGoal,onBack,onNext}:{goals:Goal[];addGoal:(l:Goal["level"])=>void;onBack:()=>void;onNext:()=>void}) { return <div className="space-y-7 pb-12"><SectionTitle icon={Target} title="Strategy-to-execution planner" description="Turn diagnosis into a visible hierarchy of strategy, tactics, operations and KPIs."/><Card><CardHeader><CardTitle>Goal cascade</CardTitle><CardDescription>Every level must connect to the level above it.</CardDescription></CardHeader><CardContent><div className="space-y-4">{goals.length===0 && <div className="border border-dashed rounded-xl p-8 text-center text-muted-foreground">No goals yet. Create one at each level.</div>}{goals.map(g=><div key={g.id} className="border rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4"><Badge variant={g.level === "strategic" ? "default" : "secondary"}>{g.level}</Badge><div className="flex-1"><div className="font-semibold">{g.title}</div><div className="text-xs text-muted-foreground mt-1">Owner: {g.owner} · Deadline: {g.deadline} · Target: {g.target} {g.unit}</div></div><div className="flex gap-1">{Object.entries(g.smart).map(([k,v])=><Badge key={k} variant="outline" className={v ? "text-emerald-600" : "text-orange-600"}>{k}: {v ? "✓" : "validate"}</Badge>)}</div></div>)}</div><div className="flex flex-wrap gap-2 mt-5"><Button variant="outline" onClick={()=>addGoal("strategic")}><Plus className="w-4 h-4 mr-1"/> Strategic goal</Button><Button variant="outline" onClick={()=>addGoal("tactical")}><Plus className="w-4 h-4 mr-1"/> Tactical goal</Button><Button variant="outline" onClick={()=>addGoal("operational")}><Plus className="w-4 h-4 mr-1"/> Operational goal</Button></div></CardContent></Card><div className="grid md:grid-cols-4 gap-3">{["VISION", "STRATEGIC GOALS", "TACTICAL INITIATIVES", "OPERATIONAL TASKS"].map((x,i)=><div key={x} className="border rounded-xl p-4 text-center"><div className="text-xs text-muted-foreground">LEVEL {i+1}</div><div className="font-semibold mt-2">{x}</div>{i<3&&<ArrowRight className="w-4 h-4 mx-auto mt-3 text-muted-foreground"/>}</div>)}</div><div className="flex justify-between"><Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1"/> Diagnosis</Button><Button onClick={onNext}>Open execution roadmap <ArrowRight className="w-4 h-4 ml-2"/></Button></div></div>; }
function Execution({goals,onBack,health}:{goals:Goal[];onBack:()=>void;health:number}) { const phases=["First 7 Days","First 30 Days","Days 31–90","Months 4–6","Months 7–12"]; return <div className="space-y-7 pb-12"><SectionTitle icon={Zap} title="Execution roadmap" description="The diagnostic becomes useful when ownership, deadlines and measurement are visible."/><div className="grid md:grid-cols-5 gap-3">{phases.map((p,i)=><Card key={p}><CardContent className="p-4"><div className="text-xs text-primary font-semibold">PHASE {i+1}</div><h3 className="font-semibold mt-2">{p}</h3><p className="text-xs text-muted-foreground mt-2">{i===0?"Validate evidence and assign owners.":i===1?"Execute quick wins.":i===2?"Implement core improvements.":i===3?"Scale strategic initiatives.":"Optimize and institutionalize."}</p></CardContent></Card>)}</div><Card><CardHeader><CardTitle>Accountability board</CardTitle><CardDescription>Each initiative needs owner, baseline, target, deadline, KPI and status.</CardDescription></CardHeader><CardContent>{goals.length===0?<div className="p-8 text-center text-muted-foreground">Create goals in the strategy planner first.</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left p-3">Goal</th><th className="text-left p-3">Owner</th><th className="text-left p-3">Baseline</th><th className="text-left p-3">Target</th><th className="text-left p-3">Deadline</th><th className="text-left p-3">Status</th></tr></thead><tbody>{goals.map(g=><tr key={g.id} className="border-b last:border-0"><td className="p-3 font-medium">{g.title}</td><td className="p-3">{g.owner}</td><td className="p-3">{g.baseline} {g.unit}</td><td className="p-3">{g.target} {g.unit}</td><td className="p-3">{g.deadline}</td><td className="p-3"><Badge variant="outline">{g.status}</Badge></td></tr>)}</tbody></table></div>}</CardContent></Card><div className="grid md:grid-cols-3 gap-4"><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Execution health</div><div className="text-3xl font-bold mt-1">{goals.length ? Math.min(100, health + 5) : 0}/100</div><Progress className="mt-3" value={goals.length ? Math.min(100, health + 5) : 0}/></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Goal coverage</div><div className="text-3xl font-bold mt-1">{goals.length}/3+</div><p className="text-xs text-muted-foreground mt-1">Strategic, tactical and operational levels</p></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Review cadence</div><div className="text-3xl font-bold mt-1">Weekly</div><p className="text-xs text-muted-foreground mt-1">Monthly, quarterly and annual reviews should update the plan.</p></CardContent></Card></div><div className="flex justify-between"><Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1"/> Strategy</Button><Link href="/"><Button>Return to Nexus dashboard</Button></Link></div></div>; }
