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
  pillars, questionBank, scoreSeverity, initialSocialPlatforms, analyzeSocialPlatforms,
  autofillDemoProfile, seedCompetitorsForNiche, seedCaseStudies, generateDailyContentPack,
  INDUSTRY_BENCHMARKS, resolveIndustryKey, AI_EMPLOYEES,
  derivePillarScoresFromAnswers, getDatedIndustryBenchmarks, buildDiagnosticSnapshot,
  INDUSTRY_OPTIONS, SUB_INDUSTRY_BY_INDUSTRY, MARKET_OPTIONS, OBJECTIVE_OPTIONS, inferProfileFromIdentity,
  type Competitor, type DiagnosticMode, type Goal, type Metric, type SocialAdPlatform,
  type AiEmployee, type CaseStudySeed, type ContentPackItem,
} from "@/lib/business-diagnostic";
import { diagnosticApi } from "@/lib/diagnostic-api";
import { downloadDiagnosticPdf } from "@/lib/diagnostic-report-pdf";
import {
  downloadIntakeHtmlForm,
  downloadIntakeJsonTemplate,
  downloadIntakeCsvTemplate,
  parseIntakeFormText,
  intakeToCompany,
  intakeMetricPatches,
  intakeCompetitors,
  intakeSocialPatches,
} from "@/lib/diagnostic-intake-form";
import { createId } from "@/lib/id";

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
  const [socialPlatforms, setSocialPlatforms] = useState<SocialAdPlatform[]>(initialSocialPlatforms);
  const [scenarioConversion, setScenarioConversion] = useState(12);
  const [scenarioAov, setScenarioAov] = useState(10);
  const [aiEmployees, setAiEmployees] = useState<AiEmployee[]>(AI_EMPLOYEES.map(e => ({ ...e })));
  const [caseStudies, setCaseStudies] = useState<CaseStudySeed[]>([]);
  const [contentPack, setContentPack] = useState<ContentPackItem[]>([]);
  const [pillarBenchmarks, setPillarBenchmarks] = useState<Record<string, number>>({ ...INDUSTRY_BENCHMARKS.default });
  const [aiBusy, setAiBusy] = useState(false);
  const [webResearch, setWebResearch] = useState<Record<string, unknown> | null>(null);

  const questions = useMemo(() => buildAdaptiveQuestions(answers), [answers]);
  const currentQuestion = questions[questionIndex];
  const health = calculateBusinessHealth(scores);
  const severity = scoreSeverity(health);
  const sales = calculateSalesMetrics(metrics);
  const strongest = [...pillars].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0))[0];
  const weakest = [...pillars].sort((a, b) => (scores[a.id] ?? 0) - (scores[b.id] ?? 0))[0];
  const socialAnalysis = useMemo(() => analyzeSocialPlatforms(socialPlatforms), [socialPlatforms]);
  const monthlyLeads = metrics.find(m => m.id === "monthlyLeads")?.value ?? 0;
  const customers = metrics.find(m => m.id === "customers")?.value ?? 0;
  const aov = metrics.find(m => m.id === "aov")?.value ?? 0;
  const scenarioCustomers = monthlyLeads ? Math.round(monthlyLeads * scenarioConversion / 100) : 0;
  const scenarioRevenue = scenarioCustomers * (aov ? aov * (1 + scenarioAov / 100) : 0);

  function updateSocialPlatform(id: string, patch: Partial<SocialAdPlatform>) {
    setSocialPlatforms(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  function updateMetric(id: string, raw: string) {
    setMetrics(prev => prev.map(m => m.id === id ? { ...m, value: raw === "" ? null : Number(raw) } : m));
  }

  const logTaskLocal = async (taskType: string, title: string, detail?: string, metadata?: Record<string, unknown>) => {
    const entry = { id: createId(), taskType, title, detail, status: "completed", createdAt: new Date().toISOString() };
    setTaskHistory((prev) => [entry, ...prev]);
    try {
      const key = "cintexa-diagnostic-task-history";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([entry, ...existing].slice(0, 200)));
    } catch { /* ignore */ }
    try { await diagnosticApi.logTask({ taskType, title, detail, metadata, actor: "user" }); } catch { /* optional */ }
  };

  function answerQuestion(value: string | number | boolean) {
    if (!currentQuestion) return;
    const next = { ...answers, [currentQuestion.id]: value };
    setAnswers(next);
    // Recompute all pillar scores from the full answer set for consistency
    const derived = derivePillarScoresFromAnswers(next);
    setScores(derived);
    if (questionIndex < questions.length - 1) {
      setQuestionIndex(i => i + 1);
    } else {
      // Persist snapshot when diagnostic completes
      try {
        const snap = buildDiagnosticSnapshot({
          company,
          mode,
          answers: next,
          scores: derived,
          metrics,
          goals,
          competitors,
          socialPlatforms,
          webResearch,
          health: calculateBusinessHealth(derived),
        });
        localStorage.setItem("cintexa-diagnostic-last-snapshot", JSON.stringify(snap));
        const histKey = "cintexa-diagnostic-snapshots";
        const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
        localStorage.setItem(histKey, JSON.stringify([snap, ...(Array.isArray(hist) ? hist : [])].slice(0, 25)));
      } catch { /* ignore */ }
      setStage("results");
      void logTaskLocal(
        "social_platforms",
        `Diagnosed ${socialPlatforms.filter(p => p.enabled).length} paid social platform(s)`,
        socialPlatforms.filter(p => p.enabled).map(p => p.label).join(", "),
      );
      void logTaskLocal("diagnostic_complete", `Completed ${mode} diagnostic for ${company.name || "company"}`, `Health score recalculated from ${Object.keys(next).length} answers`);
    }
  }

  function addCompetitor() {
    const name = newCompetitor.trim();
    if (!name) return;
    const website = newCompetitorWebsite.trim();
    setCompetitors(prev => [...prev, {
      id: createId(),
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
    const entry = { id: createId(), taskType: "competitor_added", title: `Added competitor: ${name}`, detail: website || undefined, status: "completed", createdAt: new Date().toISOString() };
    setTaskHistory(prev => [entry, ...prev]);
    try {
      const key = "cintexa-diagnostic-task-history";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([entry, ...existing].slice(0, 200)));
    } catch { /* ignore */ }
  }

  function addGoal(level: Goal["level"]) {
    const goal: Goal = { id: createId(), title: level === "strategic" ? "Increase qualified revenue" : level === "tactical" ? "Increase qualified opportunities" : "Complete qualified prospect meetings weekly", level, owner: level === "strategic" ? "CEO / Founder" : level === "tactical" ? "Department Lead" : "Sales Team", baseline: level === "strategic" ? 100 : 8, target: level === "strategic" ? 140 : level === "tactical" ? 12 : 20, unit: level === "operational" ? "meetings/week" : "%", deadline: "2026-12-31", status: "Not Started", smart: { specific: true, measurable: true, achievable: false, relevant: true, timeBound: true } };
    setGoals(prev => [...prev, goal]);
  }

    function applyIntakePayload(payload: ReturnType<typeof parseIntakeFormText>) {
    const profile = intakeToCompany(payload);
    setCompany(prev => ({
      ...prev,
      name: profile.name || prev.name,
      website: profile.website || prev.website,
      industry: profile.industry || prev.industry,
      subIndustry: profile.subIndustry || prev.subIndustry,
      model: profile.model || prev.model,
      market: profile.market || prev.market,
      employees: profile.employees || prev.employees,
      revenue: profile.revenue || prev.revenue,
      objective: profile.objective || prev.objective,
    }));
    const patches = intakeMetricPatches(payload);
    setMetrics(prev => prev.map(m => {
      const v = patches[m.id];
      return v !== undefined && v !== null ? { ...m, value: v } : m;
    }));
    if (payload.answers && Object.keys(payload.answers).length) {
      setAnswers(prev => ({ ...prev, ...payload.answers }));
      // Light pillar score nudge from answered questions
      setScores(derivePillarScoresFromAnswers({ ...answers, ...payload.answers }));
    }
    if (payload.social) {
      setSocialPlatforms(prev => intakeSocialPatches(payload, prev));
    }
    const comps = intakeCompetitors(payload);
    if (comps.length) {
      setCompetitors(comps.map(c => ({
        id: createId(),
        name: c.name,
        website: c.website,
        positioning: "From intake form",
        score: 0,
        pricing: "Unknown",
        strengths: [],
        weaknesses: [],
      })));
    }
    void logTaskLocal("intake_upload", "Autofilled profile, metrics, social & assessment from intake form", payload.companyName || "form");
  }


  function printReport() { void downloadDetailedPdf(); }

  useEffect(() => {
    try {
      const existing = JSON.parse(localStorage.getItem("cintexa-diagnostic-task-history") || "[]");
      if (Array.isArray(existing) && existing.length) setTaskHistory(existing);
    } catch { /* ignore */ }
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("history") === "1") {
        setShowHistory(true);
        setStage("results");
      }
    } catch { /* ignore */ }
  }, []);

  const downloadDetailedPdf = async () => {
    setReportBusy(true);
    const companyName = company.name?.trim() || "Company";
    try {
      let report: Record<string, unknown> = {};
      try {
        report = await diagnosticApi.fullReport({
          companyName,
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
          competitors: competitors.map(c => ({
            name: c.name,
            website: c.website,
            positioning: c.positioning,
            strengths: Array.isArray(c.strengths) ? c.strengths.join(", ") : "",
            weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses.join(", ") : "",
          })),
          socialPlatforms,
        }) as Record<string, unknown>;
      } catch {
        report = {};
      }

      const smartGoals = goals.map(g => ({
        title: g.title,
        level: g.level,
        owner: g.owner,
        baseline: g.baseline,
        target: g.target,
        unit: g.unit,
        deadline: g.deadline,
        status: g.status,
        kpi: g.target != null ? `${g.target}${g.unit ? ` ${g.unit}` : ""}` : undefined,
      }));

      const enriched = {
        meta: {
          title: `${companyName} — Business Diagnostic, Strategy & Execution Report`,
          companyName,
          industry: company.industry || "Not specified",
          generatedAt: new Date().toISOString(),
          evidencePolicy:
            (report as any)?.meta?.evidencePolicy ||
            "Facts, calculations, benchmarks and inferences are labeled. Missing external facts remain UNKNOWN.",
        },
        profile: {
          website: company.website,
          subIndustry: company.subIndustry,
          model: company.model,
          market: company.market,
          employees: company.employees,
          revenue: company.revenue,
          objective: company.objective,
        },
        executiveSummary: (report as any)?.executiveSummary || {
          overallScore: health,
          condition: severity,
          topProblems: starterProblems.map(p => p.title),
          topPriority: weakest.label,
          biggestOpportunity: `Close gaps on ${weakest.label} while protecting ${strongest.label}`,
        },
        findings: (report as any)?.findings,
        benchmarks: (report as any)?.benchmarks,
        smartGoals: (report as any)?.smartGoals?.length ? (report as any).smartGoals : smartGoals,
        roadmap: (report as any)?.roadmap || {
          days7: [
            { item: "Confirm evidence and owners", action: "Assign executive sponsor", evidence: "USER PROVIDED" },
            { item: "Baseline KPIs", action: "Conversion, cycle time, CAC", evidence: "CALCULATED" },
          ],
          days30: [
            { item: "Quick wins on priority pillar", action: `Focus: ${weakest.label}`, evidence: "INFERRED" },
            { item: "Publish SMART goals", action: "Owner + deadline for each", evidence: "USER PROVIDED" },
          ],
          days90: [
            { item: "Core process improvements", action: "Re-measure health score", evidence: "CALCULATED" },
            { item: "Reallocate budget", action: "Toward highest-ROI channels", evidence: "INFERRED" },
          ],
          months4to6: [{ item: "Scale proven initiatives", action: "Institutionalize reviews", evidence: "INFERRED" }],
          months7to12: [{ item: "Quarterly re-diagnostic", action: "Update competitor scorecard with sources", evidence: "INFERRED" }],
        },
        strategy: {
          summary: `For ${companyName} in ${company.industry || "its market"}, prioritize ${weakest.label} while protecting ${strongest.label}. Objective: ${company.objective || "improve measurable business outcomes"}.${webResearch?.metaDescription ? ` Public positioning: ${String(webResearch.metaDescription)}` : ""}${webResearch?.pageTitle ? ` Site title: ${String(webResearch.pageTitle)}.` : ""}`,
          initiatives: [
            `Strengthen ${weakest.label} with owned KPIs and weekly review`,
            `Defend advantage in ${strongest.label}`,
            company.objective ? `Align all projects to: ${company.objective}` : "Limit work-in-progress to three company priorities",
          ],
          portfolioMoves: socialAnalysis.portfolioRecommendations,
          platformStrategies: socialAnalysis.insights.map(s => ({ platform: s.label, strategy: s.strategy })),
        },
        execution: {
          cadence: "Weekly operational review · Monthly strategy check · Quarterly re-diagnostic",
          accountability: smartGoals.map(g => ({
            goal: g.title,
            owner: g.owner || "Unassigned",
            deadline: g.deadline || "TBD",
            status: g.status || "Not Started",
          })),
          nextWeek: [
            "Validate top findings with internal data",
            "Assign owners to each SMART goal",
            "Ship one experiment on the priority pillar",
          ],
          nextQuarter: [
            "Complete 90-day roadmap items",
            "Publish before/after KPI dashboard",
            "Refresh competitor websites and sources",
          ],
        },
        kpis: (report as any)?.kpis,
        swot: (report as any)?.swot,
        competitors: competitors.map(c => ({
          name: c.name,
          website: c.website,
          positioning: c.positioning,
          strengths: Array.isArray(c.strengths) ? c.strengths.join(", ") : "",
          weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses.join(", ") : "",
        })),
        socialInsights: socialAnalysis.insights,
        sales: (report as any)?.sales || sales,
        pillarScores: scores,
        liveWebResearch: webResearch
          ? {
              pageTitle: webResearch.pageTitle as string | null,
              metaDescription: webResearch.metaDescription as string | null,
              aboutSnippet: webResearch.aboutSnippet as string | null,
              keywords: webResearch.keywords as string[] | undefined,
              strategyHints: webResearch.strategyHints as string[] | undefined,
              companyInsights: webResearch.companyInsights as any,
              companyWebsite: (webResearch.companyWebsite || company.website) as string | null,
              researchedAt: webResearch.researchedAt as string | undefined,
            }
          : null,
        implementationGuide: [
          "Confirm evidence — UNKNOWN and USER PROVIDED stay hypotheses until sourced.",
          `Protect ${strongest.label}; fund ${weakest.label}.`,
          "Every initiative needs owner + metric + review date.",
          "Execute 7 / 30 / 90 day roadmap; scale over 4–12 months.",
          "Instrument KPIs weekly; re-run diagnostic quarterly.",
        ],
      };

      downloadDiagnosticPdf(enriched as any);
      await logTaskLocal("pdf_export", `Downloaded strategy & execution PDF for ${companyName}`, companyName);
    } catch (err) {
      console.error(err);
      // Never fall back to printing the app chrome; surface failure instead
      alert("PDF generation failed. Check the console for details.");
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

  async function handleIntakeFormUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    setDocBusy(true);
    try {
      const file = fileList[0];
      const raw = await file.text();
      const payload = parseIntakeFormText(raw, file.name);
      const hasAny = Object.values(payload).some(v => v !== "" && v != null);
      if (!hasAny) {
        alert("Could not read fields from this file. Use the CINTEXA intake JSON, CSV, or HTML export.");
        return;
      }
      applyIntakePayload(payload);
      setUploadedDocs(prev => [...prev, { name: file.name, size: file.size, mimeType: file.type || "text/plain", text: raw.slice(0, 2000) }]);
      alert("Intake form applied — profile, metrics, paid social platforms and assessment answers autofilled.");
    } catch (err) {
      console.error(err);
      alert("Failed to parse intake form.");
    } finally {
      setDocBusy(false);
    }
  }

  function applyAutofill() {
    const inferred = inferProfileFromIdentity(company.name || "", company.website || "");
    const demo = autofillDemoProfile(inferred.industry || company.industry || "SaaS B2B");
    setCompany({
      ...company,
      ...demo.company,
      name: company.name || demo.company.name,
      website: company.website || demo.company.website,
      industry: company.industry || inferred.industry || demo.company.industry,
      subIndustry: company.subIndustry || inferred.subIndustry || demo.company.subIndustry,
      market: company.market || inferred.market || demo.company.market,
      objective: company.objective || inferred.objective || demo.company.objective,
    });
    setMetrics(prev => prev.map(m => ({ ...m, value: demo.metrics[m.id] ?? m.value })));
    void logTaskLocal("autofill", "Autofilled profile fields from identity / demo defaults");
  }

  /** When name/website change, suggest industry, market and objective if still empty. */
  function suggestFromIdentity() {
    const inferred = inferProfileFromIdentity(company.name || "", company.website || "");
    setCompany(prev => ({
      ...prev,
      industry: prev.industry || inferred.industry || prev.industry,
      subIndustry: prev.subIndustry || inferred.subIndustry || prev.subIndustry,
      market: prev.market || inferred.market || prev.market,
      objective: prev.objective || inferred.objective || prev.objective,
    }));
  }

  async function runAiEmployees() {
    const companyName = (company.name || "").trim();
    const companyWebsite = (company.website || "").trim();
    if (!companyName && !companyWebsite) {
      alert("Enter company name and/or website in the Company intelligence profile so AI employees can research the right entity.");
      return;
    }
    const inferred = inferProfileFromIdentity(companyName, companyWebsite);
    const nextCompany = {
      ...company,
      industry: company.industry || inferred.industry || company.industry,
      subIndustry: company.subIndustry || inferred.subIndustry || company.subIndustry,
      market: company.market || inferred.market || company.market,
      objective: company.objective || inferred.objective || company.objective,
    };
    setCompany(nextCompany);
    setAiBusy(true);
    const niche = nextCompany.industry || inferred.industry || "general";
    setAiEmployees(prev => prev.map(e => ({ ...e, status: "working" as const, lastAction: "Working…" })));

    // Live internet research from name + website
    let research: Record<string, unknown> | null = null;
    try {
      research = await diagnosticApi.research({
        companyName: companyName || "Company",
        companyWebsite: companyWebsite || undefined,
        industry: niche,
        competitors: competitors.map(c => ({ name: c.name, website: c.website || "" })),
      }) as Record<string, unknown>;
      setWebResearch(research);
      setResearchNotes(JSON.stringify(research, null, 2));
      const keywords = Array.isArray(research.keywords) ? (research.keywords as string[]) : [];
      if (keywords.length && !nextCompany.industry) {
        // soft-fill industry from keyword signals when empty
        const joined = keywords.join(" ");
        const again = inferProfileFromIdentity(companyName, `${companyWebsite} ${joined}`);
        if (again.industry) {
          setCompany(prev => ({
            ...prev,
            industry: prev.industry || again.industry || prev.industry,
            subIndustry: prev.subIndustry || again.subIndustry || prev.subIndustry,
          }));
        }
      }
      setAiEmployees(prev => prev.map(e => e.id === "scout" ? {
        ...e,
        status: "done" as const,
        lastAction: research?.fetchError
          ? `Fetch issue: ${String(research.fetchError)}`
          : `Live research: ${companyName || "company"}${companyWebsite ? ` · ${companyWebsite}` : ""} · ${String(research.pageTitle || niche)}`,
      } : e));
    } catch (err: any) {
      setAiEmployees(prev => prev.map(e => e.id === "scout" ? {
        ...e,
        status: "done" as const,
        lastAction: `Research API unavailable — ${err?.message || "using profile only"}`,
      } : e));
    }

    await new Promise(r => setTimeout(r, 300));
    const seeds = seedCompetitorsForNiche(niche, companyName || "Company");
    // Prefer competitor websites returned from research when present
    const researchedComps = Array.isArray(research?.competitorInsights)
      ? (research!.competitorInsights as any[]).map((c) => ({
          name: String(c.name || "Competitor"),
          website: String(c.website || ""),
          positioning: String(c.metaDescription || c.pageTitle || "Public research"),
        }))
      : [];
    const merged = (researchedComps.length ? researchedComps : seeds).map((s: any) => ({
      id: createId(),
      name: s.name,
      website: s.website || "",
      positioning: s.positioning || "Research-backed competitor",
      score: 0,
      pricing: "Research required",
      strengths: s.strengths || [],
      weaknesses: s.weaknesses || [],
    }));
    setCompetitors(merged);
    setAiEmployees(prev => prev.map(e => e.id === "rival" ? {
      ...e,
      status: "done" as const,
      lastAction: `Competitors updated (${merged.length}) with public site signals where available`,
    } : e));

    await new Promise(r => setTimeout(r, 250));
    const dated = getDatedIndustryBenchmarks(niche);
    setPillarBenchmarks({ ...dated.pillars });
    setAiEmployees(prev => prev.map(e => e.id === "benchmark" ? { ...e, status: "done" as const, lastAction: `Loaded ${dated.industryKey} band (as of ${dated.asOf}, ${dated.evidence})` } : e));

    const cases = seedCaseStudies(niche, weakest.label);
    setCaseStudies(cases);
    setAiEmployees(prev => prev.map(e => e.id === "case" ? { ...e, status: "done" as const, lastAction: `Matched ${cases.length} case sources` } : e));

    const about = String(research?.aboutSnippet || research?.metaDescription || "");
    const pack = generateDailyContentPack({
      companyName: companyName || "Company",
      industry: niche,
      website: companyWebsite || nextCompany.website,
      weakestPillar: weakest.label,
      strongestPillar: strongest.label,
      objective: nextCompany.objective || about.slice(0, 80),
      goals: goals.map(g => g.title),
    });
    setContentPack(pack);
    setAiEmployees(prev => prev.map(e => e.id === "copy" ? {
      ...e,
      status: "done" as const,
      lastAction: `Generated ${pack.length} SEO/ad assets using live research`,
    } : e));

    void logTaskLocal(
      "ai_employees",
      "AI employees completed live web research, benchmarks, cases and content pack",
      `${companyName} ${companyWebsite}`.trim(),
      { pageTitle: research?.pageTitle, keywords: research?.keywords },
    );
    setAiBusy(false);
  }


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
      <div className="flex flex-wrap gap-2 justify-end print:hidden">
        <Button type="button" variant="secondary" onClick={applyAutofill}>Autofill demo profile</Button>
        <Button type="button" disabled={aiBusy} onClick={() => void runAiEmployees()}>{aiBusy ? "Searching…" : "Run Search"}</Button>
      </div>
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">Fillable intake form</CardTitle>
          <CardDescription>
            Download a fillable form covering company profile, core metrics, paid social platforms and adaptive assessment. Upload the filled file to autofill everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={downloadIntakeHtmlForm}>Download HTML form</Button>
          <Button type="button" variant="outline" onClick={downloadIntakeJsonTemplate}>Download JSON template</Button>
          <Button type="button" variant="outline" onClick={downloadIntakeCsvTemplate}>Download CSV template</Button>
          <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 h-10 cursor-pointer hover:bg-muted bg-background">
            <input
              type="file"
              accept=".json,.csv,.txt,.html,.htm,application/json,text/csv,text/html,text/plain"
              className="hidden"
              onChange={e => void handleIntakeFormUpload(e.target.files)}
            />
            {docBusy ? "Reading form…" : "Upload filled form (autofill)"}
          </label>
        </CardContent>
      </Card>
      <SectionTitle icon={Network} title="Company intelligence profile" description="Start with the operating context. Missing data stays missing instead of becoming an invented assumption." />
      <Card><CardContent className="p-6"><div className="grid md:grid-cols-2 gap-5">
        <div>
          <Label>Company name</Label>
          <Input className="mt-2" value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} onBlur={suggestFromIdentity} placeholder="Legal or trading name" />
        </div>
        <div>
          <Label>Company website</Label>
          <Input className="mt-2" value={company.website} onChange={e => setCompany({ ...company, website: e.target.value })} onBlur={suggestFromIdentity} placeholder="https://example.com" />
          <p className="text-[11px] text-muted-foreground mt-1">AI employees use name + website for research. Blur suggests industry and market.</p>
        </div>
        <div>
          <Label>Industry type</Label>
          <select className="mt-2 w-full h-10 rounded-md border bg-background px-3 text-sm" value={company.industry} onChange={e => setCompany({ ...company, industry: e.target.value, subIndustry: "" })}>
            <option value="">Select industry…</option>
            {INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <Label>Sub-industry</Label>
          <select className="mt-2 w-full h-10 rounded-md border bg-background px-3 text-sm" value={company.subIndustry} onChange={e => setCompany({ ...company, subIndustry: e.target.value })}>
            <option value="">Select sub-industry…</option>
            {(SUB_INDUSTRY_BY_INDUSTRY[company.industry] || SUB_INDUSTRY_BY_INDUSTRY["Other / General"]).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <Label>Geographic markets</Label>
          <select className="mt-2 w-full h-10 rounded-md border bg-background px-3 text-sm" value={company.market} onChange={e => setCompany({ ...company, market: e.target.value })}>
            <option value="">Select market…</option>
            {MARKET_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <Label>Employees</Label>
          <Input className="mt-2" value={company.employees} onChange={e => setCompany({ ...company, employees: e.target.value })} placeholder="e.g. 25–50" />
        </div>
        <div>
          <Label>Revenue range</Label>
          <Input className="mt-2" value={company.revenue} onChange={e => setCompany({ ...company, revenue: e.target.value })} placeholder="e.g. GHS 50k–150k / mo" />
        </div>
        <div>
          <Label>Business model</Label>
          <select className="mt-2 w-full h-10 rounded-md border bg-background px-3 text-sm" value={company.model} onChange={e => setCompany({ ...company, model: e.target.value })}>
            <option>B2B</option><option>B2C</option><option>B2B2C</option><option>Marketplace</option><option>Subscription</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <Label>Primary strategic objective</Label>
          <select className="mt-2 w-full h-10 rounded-md border bg-background px-3 text-sm" value={OBJECTIVE_OPTIONS.includes(company.objective as any) ? company.objective : (company.objective ? "__custom__" : "")} onChange={e => {
            if (e.target.value === "__custom__") return;
            setCompany({ ...company, objective: e.target.value });
          }}>
            <option value="">Select or suggest an objective…</option>
            {OBJECTIVE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            {company.objective && !OBJECTIVE_OPTIONS.includes(company.objective as any) ? <option value="__custom__">{company.objective}</option> : null}
          </select>
          <Input className="mt-2" value={company.objective} onChange={e => setCompany({ ...company, objective: e.target.value })} placeholder="Or type a custom strategic objective" />
        </div>
      </div></CardContent></Card>
      <Card><CardHeader><CardTitle>Core business metrics</CardTitle><CardDescription>Numbers drive the calculations. Leave unavailable fields blank.</CardDescription></CardHeader><CardContent><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{metrics.map(m => <div key={m.id}><Label>{m.label} <span className="text-muted-foreground">({m.unit})</span></Label><Input className="mt-2" type="number" min="0" value={m.value ?? ""} onChange={e => updateMetric(m.id, e.target.value)} /></div>)}</div></CardContent></Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Paid social & ad boost platforms</CardTitle>
          <CardDescription>Enable each platform you use for paid boosts separately. Enter spend and outcomes so diagnosis, recommendations and strategy stay platform-specific.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {socialPlatforms.map((p) => (
            <div key={p.id} className={cn("border rounded-xl p-4 transition-colors", p.enabled ? "border-primary/40 bg-primary/5" : "border-border/60")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 font-medium text-sm cursor-pointer">
                  <input type="checkbox" checked={p.enabled} onChange={(e) => updateSocialPlatform(p.id, { enabled: e.target.checked })} className="rounded border" />
                  {p.label}
                  <span className="text-xs text-muted-foreground font-normal">({p.channel})</span>
                </label>
              </div>
              {p.enabled && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                  {[
                    ["monthlySpend", "Monthly spend"],
                    ["impressions", "Impressions"],
                    ["clicks", "Clicks"],
                    ["leads", "Leads"],
                    ["conversions", "Conversions"],
                    ["roas", "ROAS (x)"],
                    ["cpc", "CPC"],
                    ["cpl", "CPL"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <Input className="mt-1 h-9" type="number" min="0" step="any"
                        value={(p as any)[key] ?? ""}
                        onChange={(e) => updateSocialPlatform(p.id, { [key]: e.target.value === "" ? null : Number(e.target.value) } as any)}
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Label className="text-xs">Notes</Label>
                    <Input className="mt-1 h-9" value={p.notes} onChange={(e) => updateSocialPlatform(p.id, { notes: e.target.value })} placeholder="Campaign focus, audience, creative type…" />
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

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

  
  


  if (stage === "results") return (
    <div className="space-y-7 pb-12 print:pb-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div><div className="text-primary text-sm font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4"/> YOUR BUSINESS DIAGNOSIS</div><h1 className="text-3xl font-bold mt-1">{company.name || "Business"} intelligence report</h1><p className="text-muted-foreground mt-1">Evidence-led diagnosis with explicit uncertainty and actionable priorities.</p></div><div className="flex gap-2 print:hidden"><Button variant="outline" onClick={() => setStage("questions")}><RefreshCw className="w-4 h-4 mr-2"/> Reassess</Button><Button onClick={downloadDetailedPdf} disabled={reportBusy}><Download className="w-4 h-4 mr-2"/> {reportBusy ? "Building PDF…" : "Download strategy & execution PDF"}</Button><Button variant="outline" onClick={printReport}>Print</Button></div></div>
      <div className="grid lg:grid-cols-[auto_1fr] gap-5"><Card><CardContent className="p-8 flex flex-col items-center justify-center min-w-[180px]"><ScoreRing score={health} label="Business Health" size="lg"/><Badge className="mt-8">{severity}</Badge></CardContent></Card><Card><CardHeader><CardTitle>Executive readout</CardTitle><CardDescription>What CINTEXA would put in front of leadership first.</CardDescription></CardHeader><CardContent className="grid sm:grid-cols-2 gap-4"><Readout title="Strongest pillar" value={`${strongest.label} — ${scores[strongest.id]}/100`} icon={TrendingUp} tone="good" /><Readout title="Priority pillar" value={`${weakest.label} — ${scores[weakest.id]}/100`} icon={AlertTriangle} tone="risk" /><Readout title="Biggest revenue leak" value="Sales funnel conversion requires validation" icon={BarChart3} tone="risk" /><Readout title="Evidence gap" value="Competitor benchmarks need dated sources" icon={ShieldAlert} tone="neutral" /></CardContent></Card></div>
      <Card className="overflow-hidden"><CardHeader><CardTitle>Diagnostic pillar scorecard</CardTitle><CardDescription>Colour and motion encode health vs industry benchmark band.</CardDescription></CardHeader><CardContent>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pillars.map((p, i) => {
            const score = scores[p.id] ?? 0;
            const bench = pillarBenchmarks[p.id] ?? 70;
            const gap = score - bench;
            const color = score >= 75 ? "from-emerald-500 to-teal-400" : score >= 55 ? "from-amber-500 to-orange-400" : "from-rose-500 to-pink-500";
            const bar = score >= 75 ? "bg-emerald-500" : score >= 55 ? "bg-amber-500" : "bg-rose-500";
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.02 }} className="rounded-xl border p-4 bg-card/60 relative overflow-hidden">
                <div className={"absolute inset-x-0 top-0 h-1 bg-gradient-to-r " + color} />
                <div className="flex justify-between items-start gap-2">
                  <div className="text-sm font-semibold">{p.label}</div>
                  <motion.span className="text-xl font-bold tabular-nums" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ delay: 0.15 + i * 0.04 }}>{score}</motion.span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div className={"h-full rounded-full " + bar} initial={{ width: 0 }} animate={{ width: score + "%" }} transition={{ duration: 0.8, delay: 0.1 + i * 0.05 }} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                  <span>Benchmark {bench}</span>
                  <span className={gap >= 0 ? "text-emerald-500" : "text-rose-500"}>{gap >= 0 ? "+" : ""}{gap} vs bench</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent></Card>
      
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Paid social diagnosis <span className="text-xs font-normal text-muted-foreground">(each platform separate)</span></CardTitle>
          <CardDescription>Visual health, platform metrics and strategies derived from the platforms you enabled for ad boosts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {socialAnalysis.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paid social platforms enabled. Return to the profile and enable platforms used for ad boosts.</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {socialAnalysis.insights.map((insight, i) => (
                  <motion.div
                    key={insight.platformId}
                    initial={{ opacity: 0, y: 16, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.08 * i, type: "spring", stiffness: 320, damping: 24 }}
                    whileHover={{ y: -4 }}
                    className="border rounded-xl p-4 bg-card/50 relative overflow-hidden"
                  >
                    <motion.div
                      className="absolute inset-x-0 bottom-0 h-1 bg-primary/80 origin-left"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: insight.healthScore / 100 }}
                      transition={{ delay: 0.2 + i * 0.08, duration: 0.8 }}
                    />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">{insight.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{insight.severity}</div>
                      </div>
                      <motion.div
                        className="text-2xl font-bold tabular-nums"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 + i * 0.05 }}
                      >
                        {insight.healthScore}
                      </motion.div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-muted/50 p-2">ROAS<br/><span className="font-semibold text-sm">{insight.metrics.roas ?? "—"}</span></div>
                      <div className="rounded-lg bg-muted/50 p-2">CPL<br/><span className="font-semibold text-sm">{insight.metrics.cpl != null ? insight.metrics.cpl.toFixed(1) : "—"}</span></div>
                      <div className="rounded-lg bg-muted/50 p-2">CTR<br/><span className="font-semibold text-sm">{insight.metrics.ctr != null ? `${insight.metrics.ctr.toFixed(2)}%` : "—"}</span></div>
                      <div className="rounded-lg bg-muted/50 p-2">Spend<br/><span className="font-semibold text-sm">{insight.metrics.spend ?? "—"}</span></div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 leading-relaxed"><span className="font-medium text-foreground">Strategy:</span> {insight.strategy}</p>
                    <ul className="mt-2 space-y-1">
                      {insight.recommendations.slice(0, 2).map((r, ri) => (
                        <li key={ri} className="text-xs flex gap-1.5"><span className="text-primary">→</span><span>{r}</span></li>
                      ))}
                    </ul>
                  </motion.div>
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
                className="rounded-xl border border-primary/20 bg-primary/5 p-4"
              >
                <div className="text-sm font-semibold mb-2">Portfolio recommendations</div>
                <ul className="space-y-1.5">
                  {socialAnalysis.portfolioRecommendations.map((r, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex gap-2"><span className="text-primary font-bold">{i + 1}.</span>{r}</li>
                  ))}
                </ul>
                {socialAnalysis.topPerformer && (
                  <p className="text-xs mt-3 text-muted-foreground">
                    Leading platform: <span className="text-foreground font-medium">{socialAnalysis.topPerformer.label}</span>
                    {socialAnalysis.weakest && socialAnalysis.weakest.platformId !== socialAnalysis.topPerformer.platformId && (
                      <> · Needs attention: <span className="text-foreground font-medium">{socialAnalysis.weakest.label}</span></>
                    )}
                  </p>
                )}
              </motion.div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid xl:grid-cols-2 gap-5"><Card><CardHeader><CardTitle>Top problems</CardTitle></CardHeader><CardContent className="space-y-3">{starterProblems.map((p, i) => <div key={p.title} className="border rounded-xl p-4"><div className="flex justify-between gap-3"><div><div className="flex items-center gap-2"><span className="text-xs font-bold text-muted-foreground">0{i+1}</span><h3 className="font-semibold">{p.title}</h3></div><p className="text-sm text-muted-foreground mt-2">{p.detail}</p></div><EvidenceBadge type={p.evidence}/></div><div className="mt-3 p-3 rounded-lg bg-muted/60 text-sm"><b>Action:</b> {p.action}</div></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Sales intelligence</CardTitle><CardDescription>Calculated only where source metrics exist.</CardDescription></CardHeader><CardContent className="space-y-4">{[["Lead → customer conversion", sales.conversion, "%"],["Qualified lead rate", sales.qualification, "%"],["Projected revenue from customer count", sales.revenue, "GHS"],["CAC", sales.cac, "GHS"]].map(([label,value,unit]) => <div key={String(label)} className="flex justify-between items-center border-b last:border-0 pb-3 last:pb-0"><span className="text-sm">{String(label)}</span><span className="font-semibold">{value === null ? "Unknown" : `${Number(value).toFixed(1)} ${unit}`} {value !== null && <EvidenceBadge type="CALCULATED"/>}</span></div>)}</CardContent></Card></div>
      <Card><CardHeader><CardTitle>Root-cause chain</CardTitle><CardDescription>Symptoms are kept separate from hypotheses.</CardDescription></CardHeader><CardContent><div className="grid md:grid-cols-5 gap-2 items-center">{["Observed Problem", "Evidence", "Possible Causes", "Root Cause", "Intervention"].map((x,i)=><div key={x} className="flex items-center gap-2"><div className="flex-1 border rounded-xl p-4 text-center"><div className="text-xs text-muted-foreground">STEP {i+1}</div><div className="font-semibold mt-1">{x}</div><div className="text-xs text-muted-foreground mt-2">{i === 0 ? "Sales performance signal" : i === 1 ? "User data + calculations" : i === 2 ? "Qualification / follow-up / offer" : i === 3 ? "Validate with funnel evidence" : "Target the confirmed constraint"}</div></div>{i < 4 && <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0"/>}</div>)}</div></CardContent></Card>
      <Tabs defaultValue="competitive"><TabsList className="grid grid-cols-4 w-full"><TabsTrigger value="competitive">Competition</TabsTrigger><TabsTrigger value="benchmarks">Benchmarks</TabsTrigger><TabsTrigger value="scenarios">What If?</TabsTrigger><TabsTrigger value="cases">Case Intelligence</TabsTrigger></TabsList><TabsContent value="competitive" className="mt-4"><Competitive competitors={competitors} newCompetitor={newCompetitor} setNewCompetitor={setNewCompetitor} addCompetitor={addCompetitor} newCompetitorWebsite={newCompetitorWebsite} setNewCompetitorWebsite={setNewCompetitorWebsite}/></TabsContent><TabsContent value="benchmarks" className="mt-4"><Benchmark scores={scores} benchmarks={pillarBenchmarks}/></TabsContent><TabsContent value="scenarios" className="mt-4"><Scenario monthlyLeads={Number(monthlyLeads)} customers={Number(customers)} aov={Number(aov)} conversion={scenarioConversion} setConversion={setScenarioConversion} aovLift={scenarioAov} setAovLift={setScenarioAov} projectedCustomers={scenarioCustomers} projectedRevenue={scenarioRevenue}/></TabsContent><TabsContent value="cases" className="mt-4"><CaseIntelligence weakest={weakest.label}/></TabsContent></Tabs>
      
      
      {webResearch && (
        <Card>
          <CardHeader>
            <CardTitle>Live web research</CardTitle>
            <CardDescription>Public information pulled from the company website and used in assessment, strategy and the PDF report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {webResearch.pageTitle ? <p><span className="font-medium">Page title:</span> {String(webResearch.pageTitle)}</p> : null}
            {webResearch.metaDescription ? <p><span className="font-medium">Positioning:</span> {String(webResearch.metaDescription)}</p> : null}
            {webResearch.aboutSnippet ? <p className="text-muted-foreground">{String(webResearch.aboutSnippet)}</p> : null}
            {Array.isArray(webResearch.keywords) && (webResearch.keywords as string[]).length > 0 && (
              <p><span className="font-medium">Signals:</span> {(webResearch.keywords as string[]).join(", ")}</p>
            )}
            {Array.isArray(webResearch.strategyHints) && (
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                {(webResearch.strategyHints as string[]).slice(0, 6).map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
            {webResearch.fetchError ? <p className="text-rose-500 text-xs">Fetch note: {String(webResearch.fetchError)}</p> : null}
            <p className="text-[11px] text-muted-foreground">Evidence: public page content labeled VERIFIED with source URL and date when retrieved successfully.</p>
          </CardContent>
        </Card>
      )}

<Card>
        <CardHeader>
          <CardTitle>Intelligence report — how to implement successfully</CardTitle>
          <CardDescription>Diagnosis only creates value when it becomes sequenced execution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            <li><span className="text-foreground font-medium">Confirm evidence.</span> Treat USER PROVIDED and UNKNOWN items as hypotheses until you attach sources or internal data.</li>
            <li><span className="text-foreground font-medium">Protect the strongest pillar</span> ({strongest.label}) while funding the priority pillar ({weakest.label}).</li>
            <li><span className="text-foreground font-medium">Translate findings into SMART goals</span> with owner, baseline, target and deadline on the Strategy step.</li>
            <li><span className="text-foreground font-medium">Run a 30 / 90 / 365 day roadmap</span> — quick wins first, then systems, then scale.</li>
            <li><span className="text-foreground font-medium">Instrument KPIs weekly</span> and adapt; the diagnostic is continuous, not a one-time PDF.</li>
            <li><span className="text-foreground font-medium">Use AI employees</span> to refresh competitor sites, benchmarks and daily SEO/ad content aligned to goals.</li>
          </ol>
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
            Success rule: no initiative without owner + metric + review date. No external claim without source + date.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>AI employees</CardTitle>
            <CardDescription>Automated research agents for niche, competitors, benchmarks, cases and growth content.</CardDescription>
          </div>
          <Button size="sm" disabled={aiBusy} onClick={() => void runAiEmployees()}>{aiBusy ? "Searching…" : "Run Search"}</Button>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {aiEmployees.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="border rounded-xl p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-sm">{e.name}</div>
                <Badge variant={e.status === "done" ? "default" : e.status === "working" ? "secondary" : "outline"}>{e.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{e.role}</p>
              <p className="text-xs mt-3">{e.lastAction}</p>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      {caseStudies.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Case studies & sources</CardTitle><CardDescription>Reliable starting sources matched to niche and priority pillar. Verify before executive use.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {caseStudies.map(c => (
              <div key={c.title} className="border rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm">{c.title}</h3>
                  <EvidenceBadge type={c.evidence} />
                </div>
                <p className="text-sm text-muted-foreground mt-2">{c.lesson}</p>
                <a className="text-xs text-primary mt-2 inline-block" href={c.sourceUrl} target="_blank" rel="noreferrer">{c.source} →</a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {contentPack.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily growth content studio</CardTitle>
            <CardDescription>SEO-optimized posts, ads and copy generated from this diagnostic to advance your goals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[480px] overflow-y-auto">
            {contentPack.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.4) }} className="border rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <Badge variant="outline">{item.channel}</Badge>
                  <span className="text-[11px] text-muted-foreground">Day {item.day}</span>
                </div>
                <h4 className="font-semibold text-sm mt-2">{item.title}</h4>
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{item.body}</p>
                <p className="text-xs mt-2"><span className="font-medium">CTA:</span> {item.cta}</p>
                <p className="text-[11px] text-muted-foreground mt-1">SEO: {item.seoKeywords.slice(0, 4).join(" · ")}</p>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      )}

<Card className="print:hidden"><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Task history</CardTitle><CardDescription>Every diagnostic action is recorded and accessible here.</CardDescription></div><Button variant="outline" size="sm" onClick={() => setShowHistory(v => !v)}>{showHistory ? "Hide" : "Show"} history ({taskHistory.length})</Button></CardHeader>{showHistory && <CardContent><div className="space-y-2 max-h-72 overflow-y-auto">{taskHistory.length === 0 ? <p className="text-sm text-muted-foreground">No tasks recorded yet.</p> : taskHistory.map(t => <div key={t.id} className="border rounded-lg p-3 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="font-medium">{t.title}</div><div className="text-xs text-muted-foreground mt-0.5">{t.detail || t.taskType}</div></div><div className="text-xs text-muted-foreground shrink-0">{new Date(t.createdAt).toLocaleString()} · {t.status}</div></div>)}</div></CardContent>}</Card>
      <Card className="print:hidden"><CardHeader><CardTitle>Supporting documents & market research</CardTitle><CardDescription>Upload plans, financials or CRM exports. Research never fabricates competitor facts.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-3 items-center"><label className="inline-flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer hover:bg-muted"><input type="file" multiple className="hidden" onChange={e => handleDocumentUpload(e.target.files)} />{docBusy ? "Uploading…" : "Upload documents"}</label><Button variant="outline" onClick={runResearch}>Research company & competitors</Button></div>{uploadedDocs.length > 0 && <ul className="text-sm space-y-1">{uploadedDocs.map((d,i)=><li key={i} className="flex justify-between border-b py-1"><span>{d.name}</span><span className="text-muted-foreground">{Math.round(d.size/1024)} KB · USER PROVIDED</span></li>)}</ul>}{researchNotes && <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap">{researchNotes}</pre>}</CardContent></Card>
      <div className="flex justify-end gap-2 print:hidden"><Button variant="outline" onClick={() => setStage("profile")}>Edit inputs</Button><Button onClick={() => setStage("strategy")}>Build strategy <ArrowRight className="w-4 h-4 ml-2"/></Button></div>
    </div>
  );

  if (stage === "strategy") return <Strategy goals={goals} addGoal={addGoal} onBack={() => setStage("results")} onNext={() => setStage("execution")} socialInsights={socialAnalysis.insights} portfolio={socialAnalysis.portfolioRecommendations} />;
  return <Execution goals={goals} onBack={() => setStage("strategy")} health={health} />;
}

function TextAnswer({ number, onSubmit }: { number?: boolean; onSubmit: (v: string | number) => void }) { const [value,setValue]=useState(""); return <div className="flex gap-2"><Input type={number ? "number" : "text"} value={value} onChange={e=>setValue(e.target.value)} placeholder={number ? "Enter a number" : "Type your evidence-based answer"} /><Button disabled={!value} onClick={()=>onSubmit(number ? Number(value) : value)}>Continue <ArrowRight className="w-4 h-4 ml-2"/></Button></div>; }
function Readout({ title, value, icon: Icon, tone }: { title:string; value:string; icon:React.ElementType; tone:string }) { return <div className="border rounded-xl p-4"><div className={cn("flex items-center gap-2 text-sm font-medium", tone === "risk" ? "text-orange-600" : tone === "good" ? "text-emerald-600" : "text-primary")}><Icon className="w-4 h-4"/>{title}</div><div className="font-semibold mt-2">{value}</div></div>; }
function Competitive({ competitors,newCompetitor,setNewCompetitor,addCompetitor,newCompetitorWebsite,setNewCompetitorWebsite }: any) { return <Card><CardHeader><CardTitle>Competitive intelligence center</CardTitle><CardDescription>Optionally add each competitor website to ground strategy and improvement recommendations.</CardDescription></CardHeader><CardContent><div className="flex flex-col sm:flex-row gap-2 mb-5"><Input value={newCompetitor} onChange={e=>setNewCompetitor(e.target.value)} placeholder="Competitor name"/><Input value={newCompetitorWebsite||""} onChange={e=>setNewCompetitorWebsite?.(e.target.value)} placeholder="Website (optional)"/><Button onClick={addCompetitor}><Plus className="w-4 h-4 mr-2"/> Add</Button></div>{competitors.length===0 ? <div className="border border-dashed rounded-xl p-8 text-center text-muted-foreground">No competitors entered yet. Add direct competitors to activate the scorecard.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left p-3">Company</th><th className="text-left p-3">Website</th><th className="text-left p-3">Positioning</th><th className="text-left p-3">Score</th><th className="text-left p-3">Evidence</th></tr></thead><tbody>{competitors.map((c:Competitor)=><tr key={c.id} className="border-b last:border-0"><td className="p-3 font-medium">{c.name}</td><td className="p-3 text-muted-foreground text-xs">{(c as any).website || "—"}</td><td className="p-3 text-muted-foreground">{c.positioning}</td><td className="p-3">{c.score || "Unknown"}</td><td className="p-3"><EvidenceBadge type="UNKNOWN"/></td></tr>)}</tbody></table></div>}</CardContent></Card>; }
function Benchmark({ scores, benchmarks }: { scores:Record<string,number>; benchmarks?: Record<string,number> }) { return <Card><CardHeader><CardTitle>Benchmarking engine</CardTitle><CardDescription>AI Benchmark Curator loads industry bands; attach primary sources before treating as VERIFIED.</CardDescription></CardHeader><CardContent className="space-y-3">{pillars.map(p=><div key={p.id} className="grid grid-cols-[1fr_70px_70px_100px] gap-3 items-center"><span className="text-sm">{p.label}</span><span className="font-semibold">{scores[p.id]}</span><span className="text-muted-foreground text-sm">{benchmarks?.[p.id] ?? "—"}</span><span><EvidenceBadge type={benchmarks?.[p.id] != null ? "BENCHMARKED" : "UNKNOWN"}/></span></div>)}</CardContent></Card>; }
function Scenario({monthlyLeads,customers,aov,conversion,setConversion,aovLift,setAovLift,projectedCustomers,projectedRevenue}:any) { return <Card><CardHeader><CardTitle>What-if strategy simulator</CardTitle><CardDescription>Scenarios are projections, not guarantees. Blank source data produces no invented financial result.</CardDescription></CardHeader><CardContent className="grid lg:grid-cols-2 gap-7"><div className="space-y-5"><div><Label>Lead-to-customer conversion: {conversion}%</Label><input className="w-full mt-3" type="range" min="1" max="30" value={conversion} onChange={e=>setConversion(Number(e.target.value))}/></div><div><Label>Average transaction value lift: +{aovLift}%</Label><input className="w-full mt-3" type="range" min="0" max="50" value={aovLift} onChange={e=>setAovLift(Number(e.target.value))}/></div><div className="text-xs text-muted-foreground">Inputs: {monthlyLeads || "Unknown"} leads/month, {customers || "Unknown"} customers/month, {aov || "Unknown"} GHS AOV.</div></div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-muted p-5"><div className="text-xs text-muted-foreground">Projected customers</div><div className="text-2xl font-bold mt-2">{projectedCustomers || "Unknown"}</div></div><div className="rounded-xl bg-muted p-5"><div className="text-xs text-muted-foreground">Projected monthly revenue</div><div className="text-2xl font-bold mt-2">{projectedRevenue ? `${Math.round(projectedRevenue).toLocaleString()} GHS` : "Unknown"}</div></div></div></CardContent></Card>; }
function CaseIntelligence({ weakest }: { weakest:string }) { const cases:any = { Sales:"Sales funnel redesign and disciplined follow-up", Marketing:"Channel attribution and conversion optimization", Technology:"Integrated data and management information", Operations:"Process standardization and automation", Finance:"Unit economics and margin management" }; const lesson=cases[weakest] || "Evidence-led management and focused execution"; return <Card><CardHeader><CardTitle>Case study matching</CardTitle><CardDescription>Cases are lessons to adapt, not templates to copy.</CardDescription></CardHeader><CardContent><div className="border rounded-xl p-5"><div className="flex items-center gap-2 text-primary text-sm font-semibold"><Lightbulb className="w-4 h-4"/> MATCHED LESSON</div><h3 className="text-lg font-semibold mt-2">{lesson}</h3><p className="text-sm text-muted-foreground mt-2">CINTEXA will require a credible source before treating a company case as verified. The immediate client application is to validate the same operating constraint with internal evidence.</p><div className="mt-4"><EvidenceBadge type="UNKNOWN"/></div></div></CardContent></Card>; }
function Strategy({goals,addGoal,onBack,onNext,socialInsights,portfolio}:{goals:Goal[];addGoal:(l:Goal["level"])=>void;onBack:()=>void;onNext:()=>void;socialInsights?: any[];portfolio?: string[]}) { return <div className="space-y-7 pb-12"><SectionTitle icon={Target} title="Strategy-to-execution planner" description="Turn diagnosis into a visible hierarchy of strategy, tactics, operations and KPIs."/>{(socialInsights && socialInsights.length > 0) && <Card className="mb-5"><CardHeader><CardTitle>Platform-based strategies</CardTitle><CardDescription>Strategies derived from each paid social platform in the diagnosis.</CardDescription></CardHeader><CardContent className="space-y-3">{socialInsights.map((s:any)=><motion.div key={s.platformId} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} className="border rounded-xl p-4"><div className="flex justify-between gap-2"><span className="font-semibold text-sm">{s.label}</span><Badge variant="outline">{s.healthScore}/100</Badge></div><p className="text-sm mt-2">{s.strategy}</p><ul className="mt-2 space-y-1">{(s.recommendations||[]).map((r:string,i:number)=><li key={i} className="text-xs text-muted-foreground">→ {r}</li>)}</ul></motion.div>)}{(portfolio||[]).length>0 && <div className="rounded-lg bg-muted/50 p-3 text-sm"><div className="font-medium mb-1">Portfolio moves</div><ul className="space-y-1">{portfolio!.map((r,i)=><li key={i}>{i+1}. {r}</li>)}</ul></div>}</CardContent></Card>}<Card><CardHeader><CardTitle>Goal cascade</CardTitle><CardDescription>Every level must connect to the level above it.</CardDescription></CardHeader><CardContent><div className="space-y-4">{goals.length===0 && <div className="border border-dashed rounded-xl p-8 text-center text-muted-foreground">No goals yet. Create one at each level.</div>}{goals.map(g=><div key={g.id} className="border rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4"><Badge variant={g.level === "strategic" ? "default" : "secondary"}>{g.level}</Badge><div className="flex-1"><div className="font-semibold">{g.title}</div><div className="text-xs text-muted-foreground mt-1">Owner: {g.owner} · Deadline: {g.deadline} · Target: {g.target} {g.unit}</div></div><div className="flex gap-1">{Object.entries(g.smart).map(([k,v])=><Badge key={k} variant="outline" className={v ? "text-emerald-600" : "text-orange-600"}>{k}: {v ? "✓" : "validate"}</Badge>)}</div></div>)}</div><div className="flex flex-wrap gap-2 mt-5"><Button variant="outline" onClick={()=>addGoal("strategic")}><Plus className="w-4 h-4 mr-1"/> Strategic goal</Button><Button variant="outline" onClick={()=>addGoal("tactical")}><Plus className="w-4 h-4 mr-1"/> Tactical goal</Button><Button variant="outline" onClick={()=>addGoal("operational")}><Plus className="w-4 h-4 mr-1"/> Operational goal</Button></div></CardContent></Card><div className="grid md:grid-cols-4 gap-3">{["VISION", "STRATEGIC GOALS", "TACTICAL INITIATIVES", "OPERATIONAL TASKS"].map((x,i)=><div key={x} className="border rounded-xl p-4 text-center"><div className="text-xs text-muted-foreground">LEVEL {i+1}</div><div className="font-semibold mt-2">{x}</div>{i<3&&<ArrowRight className="w-4 h-4 mx-auto mt-3 text-muted-foreground"/>}</div>)}</div><div className="flex justify-between"><Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1"/> Diagnosis</Button><Button onClick={onNext}>Open execution roadmap <ArrowRight className="w-4 h-4 ml-2"/></Button></div></div>; }
function Execution({goals,onBack,health}:{goals:Goal[];onBack:()=>void;health:number}) { const phases=["First 7 Days","First 30 Days","Days 31–90","Months 4–6","Months 7–12"]; return <div className="space-y-7 pb-12"><SectionTitle icon={Zap} title="Execution roadmap" description="The diagnostic becomes useful when ownership, deadlines and measurement are visible."/><div className="grid md:grid-cols-5 gap-3">{phases.map((p,i)=><Card key={p}><CardContent className="p-4"><div className="text-xs text-primary font-semibold">PHASE {i+1}</div><h3 className="font-semibold mt-2">{p}</h3><p className="text-xs text-muted-foreground mt-2">{i===0?"Validate evidence and assign owners.":i===1?"Execute quick wins.":i===2?"Implement core improvements.":i===3?"Scale strategic initiatives.":"Optimize and institutionalize."}</p></CardContent></Card>)}</div><Card><CardHeader><CardTitle>Accountability board</CardTitle><CardDescription>Each initiative needs owner, baseline, target, deadline, KPI and status.</CardDescription></CardHeader><CardContent>{goals.length===0?<div className="p-8 text-center text-muted-foreground">Create goals in the strategy planner first.</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left p-3">Goal</th><th className="text-left p-3">Owner</th><th className="text-left p-3">Baseline</th><th className="text-left p-3">Target</th><th className="text-left p-3">Deadline</th><th className="text-left p-3">Status</th></tr></thead><tbody>{goals.map(g=><tr key={g.id} className="border-b last:border-0"><td className="p-3 font-medium">{g.title}</td><td className="p-3">{g.owner}</td><td className="p-3">{g.baseline} {g.unit}</td><td className="p-3">{g.target} {g.unit}</td><td className="p-3">{g.deadline}</td><td className="p-3"><Badge variant="outline">{g.status}</Badge></td></tr>)}</tbody></table></div>}</CardContent></Card><div className="grid md:grid-cols-3 gap-4"><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Execution health</div><div className="text-3xl font-bold mt-1">{goals.length ? Math.min(100, health + 5) : 0}/100</div><Progress className="mt-3" value={goals.length ? Math.min(100, health + 5) : 0}/></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Goal coverage</div><div className="text-3xl font-bold mt-1">{goals.length}/3+</div><p className="text-xs text-muted-foreground mt-1">Strategic, tactical and operational levels</p></CardContent></Card><Card><CardContent className="p-5"><div className="text-sm text-muted-foreground">Review cadence</div><div className="text-3xl font-bold mt-1">Weekly</div><p className="text-xs text-muted-foreground mt-1">Monthly, quarterly and annual reviews should update the plan.</p></CardContent></Card></div><div className="flex justify-between"><Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1"/> Strategy</Button><Link href="/"><Button>Return to Nexus dashboard</Button></Link></div></div>; }
