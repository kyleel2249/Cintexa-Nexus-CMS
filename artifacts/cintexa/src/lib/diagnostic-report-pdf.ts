import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type DiagnosticPdfReport = {
  meta: {
    title: string;
    companyName: string;
    industry: string;
    generatedAt: string;
    evidencePolicy: string;
  };
  profile?: {
    website?: string;
    subIndustry?: string;
    model?: string;
    market?: string;
    employees?: string;
    revenue?: string;
    objective?: string;
  };
  executiveSummary: {
    overallScore: number;
    condition: string;
    topProblems: string[];
    topPriority: unknown;
    biggestOpportunity: string;
  };
  findings?: Array<{
    pillar: string;
    problem: string;
    evidence: string;
    confidence?: string;
    impact: string;
    rationale?: string;
    recommendedAction: string;
  }>;
  benchmarks?: {
    industry: string;
    rows: Array<{ metric: string; actual: number | null; benchmark: number; unit: string; gap: number | null; source: string }>;
  };
  smartGoals?: Array<{
    title: string;
    owner?: string;
    deadline?: string;
    kpi?: string;
    goalType?: string;
    level?: string;
    baseline?: number | null;
    target?: number | null;
    unit?: string;
    status?: string;
    smartValidation?: { score: number };
  }>;
  roadmap?: {
    days7?: Array<{ item?: string; action?: string; evidence?: string } | string>;
    days30?: Array<{ item?: string; action?: string; evidence?: string } | string>;
    days90?: Array<{ item?: string; action?: string; evidence?: string } | string>;
    months4to6?: Array<{ item?: string; action?: string; evidence?: string } | string>;
    months7to12?: Array<{ item?: string; action?: string; evidence?: string } | string>;
  };
  strategy?: {
    summary?: string;
    initiatives?: string[];
    portfolioMoves?: string[];
    platformStrategies?: Array<{ platform: string; strategy: string }>;
  };
  execution?: {
    cadence?: string;
    accountability?: Array<{ goal: string; owner: string; deadline: string; status: string }>;
    nextWeek?: string[];
    nextQuarter?: string[];
  };
  kpis?: Array<{ name: string; baseline: number | null; target: string | number; owner: string }>;
  swot?: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  competitors?: Array<{ name: string; website?: string; positioning?: string; strengths?: string; weaknesses?: string }>;
  socialAds?: { platforms: unknown[]; note?: string };
  socialInsights?: Array<{
    label: string;
    healthScore?: number;
    metrics?: { roas?: number; cpl?: number };
    strategy?: string;
    recommendations?: string[];
  }>;
  sales?: Record<string, number | null>;
  pillarScores?: Record<string, number>;
  implementationGuide?: string[];
};

function ensureSpace(doc: jsPDF, y: number, need = 24) {
  if (y > 297 - need) {
    doc.addPage();
    return 16;
  }
  return y;
}

function line(doc: jsPDF, text: string, x: number, y: number, maxWidth = 182) {
  const lines = doc.splitTextToSize(String(text ?? ""), maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * 5 + 1;
}

function sectionTitle(doc: jsPDF, title: string, y: number, margin: number) {
  y = ensureSpace(doc, y, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 30, 50);
  doc.text(title, margin, y);
  doc.setDrawColor(30, 107, 255);
  doc.setLineWidth(0.4);
  doc.line(margin, y + 1.5, margin + 60, y + 1.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  return y + 8;
}

function roadmapItems(
  items?: Array<{ item?: string; action?: string; evidence?: string } | string>,
): string[] {
  if (!items?.length) return [];
  return items.map((it) => {
    if (typeof it === "string") return it;
    const head = it.item || it.action || "Action";
    const tail = it.action && it.item ? ` → ${it.action}` : "";
    const ev = it.evidence ? ` [${it.evidence}]` : "";
    return `${head}${tail}${ev}`;
  });
}

/**
 * Generates a clean company diagnostic PDF (no app navigation/chrome).
 * Filename and cover use the assessed company profile.
 */
export function downloadDiagnosticPdf(report: DiagnosticPdfReport) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = 18;

  const company = report.meta.companyName || "Company";
  const industry = report.meta.industry || "Not specified";
  const generated = new Date(report.meta.generatedAt || Date.now()).toLocaleString();

  // —— Cover / company identity (no UI chrome) ——
  doc.setFillColor(7, 13, 26);
  doc.rect(0, 0, 210, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("CINTEXA Nexus", margin, 16);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("Business Diagnostic & Strategic Execution Report", margin, 24);
  doc.setFontSize(9);
  doc.setTextColor(160, 190, 220);
  doc.text("Confidential — prepared for internal strategic use", margin, 32);

  y = 52;
  doc.setTextColor(20, 30, 50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  y = line(doc, company, margin, y, 182);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y = line(doc, report.meta.title || "Business Diagnostic Report", margin, y);
  y += 2;
  doc.setFontSize(10);
  y = line(doc, `Industry: ${industry}`, margin, y);
  if (report.profile?.subIndustry) y = line(doc, `Sub-industry: ${report.profile.subIndustry}`, margin, y);
  if (report.profile?.website) y = line(doc, `Website: ${report.profile.website}`, margin, y);
  if (report.profile?.model) y = line(doc, `Business model: ${report.profile.model}`, margin, y);
  if (report.profile?.market) y = line(doc, `Markets: ${report.profile.market}`, margin, y);
  if (report.profile?.employees) y = line(doc, `Company size: ${report.profile.employees}`, margin, y);
  if (report.profile?.revenue) y = line(doc, `Revenue range: ${report.profile.revenue}`, margin, y);
  if (report.profile?.objective) y = line(doc, `Strategic objective: ${report.profile.objective}`, margin, y);
  const genDate = new Date(report.meta.generatedAt || Date.now());
  y = line(doc, `Report date: ${genDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`, margin, y);
  y = line(doc, `Report time: ${genDate.toLocaleTimeString()}`, margin, y);
  y += 3;
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  y = line(doc, report.meta.evidencePolicy || "Evidence is labeled. Unknown items are not invented.", margin, y);
  doc.setTextColor(40, 40, 40);
  y += 4;

  // —— Executive summary ——
  y = sectionTitle(doc, "1. Executive Summary", y, margin);
  y = line(doc, `Overall business health: ${report.executiveSummary.overallScore}/100 — ${report.executiveSummary.condition}`, margin, y);
  y = line(doc, `Biggest opportunity: ${report.executiveSummary.biggestOpportunity}`, margin, y);
  if (report.executiveSummary.topPriority) {
    y = line(doc, `Top priority: ${typeof report.executiveSummary.topPriority === "string" ? report.executiveSummary.topPriority : JSON.stringify(report.executiveSummary.topPriority)}`, margin, y);
  }
  if (report.executiveSummary.topProblems?.length) {
    y = line(doc, "Top problems:", margin, y);
    for (const p of report.executiveSummary.topProblems.slice(0, 6)) {
      y = ensureSpace(doc, y);
      y = line(doc, `• ${p}`, margin + 2, y);
    }
  }
  y += 2;

  // —— Pillar scores ——
  if (report.pillarScores && Object.keys(report.pillarScores).length) {
    y = sectionTitle(doc, "2. Diagnostic Pillar Scores", y, margin);
    autoTable(doc, {
      startY: y,
      head: [["Pillar", "Score / 100"]],
      body: Object.entries(report.pillarScores).map(([k, v]) => [k, String(v)]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  // —— Findings ——
  if (report.findings?.length) {
    y = sectionTitle(doc, "3. Findings & Recommended Actions", y, margin);
    autoTable(doc, {
      startY: y,
      head: [["Pillar", "Problem", "Impact", "Evidence", "Action"]],
      body: report.findings.map((f) => [
        f.pillar,
        f.problem,
        f.impact,
        f.evidence,
        f.recommendedAction,
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  // —— Strategy ——
  y = sectionTitle(doc, "4. Strategy", y, margin);
  if (report.strategy?.summary) {
    y = line(doc, report.strategy.summary, margin, y);
  } else {
    y = line(
      doc,
      `Prioritize closing gaps on the weakest pillars while protecting strengths. Convert each priority into SMART goals with owners and deadlines. Align spend and capacity to the company objective${report.profile?.objective ? `: “${report.profile.objective}”` : ""}.`,
      margin,
      y,
    );
  }
  if (report.strategy?.initiatives?.length) {
    y = line(doc, "Strategic initiatives:", margin, y);
    for (const s of report.strategy.initiatives) {
      y = ensureSpace(doc, y);
      y = line(doc, `• ${s}`, margin + 2, y);
    }
  }
  if (report.strategy?.portfolioMoves?.length) {
    y = line(doc, "Portfolio moves:", margin, y);
    for (const s of report.strategy.portfolioMoves) {
      y = ensureSpace(doc, y);
      y = line(doc, `• ${s}`, margin + 2, y);
    }
  }
  if (report.strategy?.platformStrategies?.length) {
    y = ensureSpace(doc, y, 30);
    autoTable(doc, {
      startY: y,
      head: [["Platform", "Strategy"]],
      body: report.strategy.platformStrategies.map((p) => [p.platform, p.strategy]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }
  y += 2;

  // —— SMART goals ——
  y = sectionTitle(doc, "5. SMART Goals", y, margin);
  if (report.smartGoals?.length) {
    autoTable(doc, {
      startY: y,
      head: [["Goal", "Level", "Owner", "Baseline", "Target", "Deadline", "Status"]],
      body: report.smartGoals.map((g) => [
        g.title,
        g.level || g.goalType || "—",
        g.owner || "—",
        g.baseline != null ? `${g.baseline}${g.unit ? ` ${g.unit}` : ""}` : "—",
        g.target != null ? `${g.target}${g.unit ? ` ${g.unit}` : ""}` : g.kpi || "—",
        g.deadline || "—",
        g.status || "—",
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  } else {
    y = line(doc, "No SMART goals captured in this session. Create strategic, tactical and operational goals in the Strategy planner.", margin, y);
    y += 2;
  }

  // —— Execution roadmap ——
  y = sectionTitle(doc, "6. Execution Roadmap", y, margin);
  const phases: Array<[string, string[]]> = [
    ["Next 7 days", roadmapItems(report.roadmap?.days7)],
    ["30 days", roadmapItems(report.roadmap?.days30)],
    ["90 days", roadmapItems(report.roadmap?.days90)],
    ["4–6 months", roadmapItems(report.roadmap?.months4to6)],
    ["7–12 months", roadmapItems(report.roadmap?.months7to12)],
  ];
  const hasRoadmap = phases.some(([, items]) => items.length > 0);
  if (hasRoadmap) {
    for (const [label, items] of phases) {
      if (!items.length) continue;
      y = ensureSpace(doc, y, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      y = line(doc, label, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const item of items) {
        y = ensureSpace(doc, y);
        y = line(doc, `• ${item}`, margin + 2, y);
      }
      y += 2;
    }
  } else {
    // Default execution roadmap derived from profile when engine did not return phases
    const defaults: Array<[string, string[]]> = [
      [
        "Next 7 days",
        [
          "Confirm diagnostic evidence and assign an executive sponsor",
          "Baseline KPIs for conversion, cycle time and acquisition cost",
          "Schedule a 30-day strategy review",
        ],
      ],
      [
        "30 days",
        [
          "Launch quick wins on the priority pillar",
          "Publish SMART goals with owners and deadlines",
          "Stand up weekly execution standup (30 minutes)",
        ],
      ],
      [
        "90 days",
        [
          "Complete core process or funnel improvements",
          "Re-measure pillar scores and health",
          "Reallocate budget toward highest-ROI channels",
        ],
      ],
      [
        "4–12 months",
        [
          "Scale proven initiatives",
          "Institutionalize review cadence (monthly / quarterly)",
          "Update competitive scorecard with dated sources",
        ],
      ],
    ];
    for (const [label, items] of defaults) {
      y = ensureSpace(doc, y, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      y = line(doc, label, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const item of items) {
        y = ensureSpace(doc, y);
        y = line(doc, `• ${item}`, margin + 2, y);
      }
      y += 2;
    }
  }

  // —— Execution accountability ——
  y = sectionTitle(doc, "7. Execution & Accountability", y, margin);
  y = line(doc, `Review cadence: ${report.execution?.cadence || "Weekly operational review; monthly strategy check; quarterly re-diagnostic."}`, margin, y);
  if (report.execution?.accountability?.length) {
    autoTable(doc, {
      startY: y + 2,
      head: [["Goal", "Owner", "Deadline", "Status"]],
      body: report.execution.accountability.map((a) => [a.goal, a.owner, a.deadline, a.status]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  } else if (report.smartGoals?.length) {
    autoTable(doc, {
      startY: y + 2,
      head: [["Goal", "Owner", "Deadline", "Status"]],
      body: report.smartGoals.map((g) => [g.title, g.owner || "—", g.deadline || "—", g.status || "Not Started"]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  if (report.execution?.nextWeek?.length) {
    y = line(doc, "This week:", margin, y);
    for (const x of report.execution.nextWeek) {
      y = ensureSpace(doc, y);
      y = line(doc, `• ${x}`, margin + 2, y);
    }
  }
  if (report.execution?.nextQuarter?.length) {
    y = line(doc, "This quarter:", margin, y);
    for (const x of report.execution.nextQuarter) {
      y = ensureSpace(doc, y);
      y = line(doc, `• ${x}`, margin + 2, y);
    }
  }

  // —— KPIs ——
  if (report.kpis?.length) {
    y = sectionTitle(doc, "8. KPIs", y, margin);
    autoTable(doc, {
      startY: y,
      head: [["KPI", "Baseline", "Target", "Owner"]],
      body: report.kpis.map((k) => [k.name, k.baseline == null ? "—" : String(k.baseline), String(k.target), k.owner]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  // —— Competitors ——
  if (report.competitors?.length) {
    y = sectionTitle(doc, "9. Competitors", y, margin);
    autoTable(doc, {
      startY: y,
      head: [["Name", "Website", "Positioning", "Strengths", "Weaknesses"]],
      body: report.competitors.map((c) => [
        c.name,
        c.website || "—",
        c.positioning || "—",
        c.strengths || "—",
        c.weaknesses || "—",
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  // —— Social ——
  if (report.socialInsights?.length) {
    y = sectionTitle(doc, "10. Paid Social Platforms", y, margin);
    autoTable(doc, {
      startY: y,
      head: [["Platform", "Health", "ROAS", "CPL", "Strategy"]],
      body: report.socialInsights.map((s) => [
        s.label,
        s.healthScore != null ? String(s.healthScore) : "—",
        s.metrics?.roas != null ? String(s.metrics.roas) : "—",
        s.metrics?.cpl != null ? String(s.metrics.cpl) : "—",
        (s.strategy || s.recommendations?.[0] || "—").slice(0, 80),
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 107, 255] },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  // —— Implementation ——
  y = sectionTitle(doc, "11. Implementation Guide", y, margin);
  const guide =
    report.implementationGuide?.length
      ? report.implementationGuide
      : [
          "Confirm evidence — treat UNKNOWN and USER PROVIDED items as hypotheses until sourced.",
          "Protect the strongest pillar while funding the priority pillar.",
          "Translate findings into SMART goals with owners, baselines, targets and deadlines.",
          "Execute the 7 / 30 / 90 day roadmap; scale what works over 4–12 months.",
          "Instrument KPIs weekly; re-run the diagnostic quarterly.",
          "Success rule: no initiative without owner + metric + review date; no external claim without source + date.",
        ];
  for (const step of guide) {
    y = ensureSpace(doc, y);
    y = line(doc, `• ${step}`, margin, y);
  }
  y += 4;
  y = ensureSpace(doc, y, 20);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  y = line(doc, "This PDF is a standalone strategic document. It does not include application navigation or interface chrome.", margin, y);
  y = line(doc, "CINTEXA Nexus — diagnose → prioritize → execute → measure → adapt.", margin, y);

  // —— Footer: date/time, copyright, powered by ——
  y = ensureSpace(doc, y, 36);
  y += 6;
  doc.setDrawColor(30, 107, 255);
  doc.setLineWidth(0.3);
  doc.line(margin, y, 210 - margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  const reportWhen = new Date(report.meta.generatedAt || Date.now());
  const dateStr = reportWhen.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = reportWhen.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  y = line(doc, `Report date: ${dateStr}`, margin, y);
  y = line(doc, `Report time: ${timeStr}`, margin, y);
  y += 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  y = line(doc, "© " + reportWhen.getFullYear() + " Cintexa Technologies. All rights reserved.", margin, y);
  doc.setFont("helvetica", "normal");
  y = line(doc, "Powered by Cintexa Technologies · https://cintexa.com", margin, y);
  y = line(doc, "CINTEXA Nexus Business Diagnostic & Strategic Execution Engine", margin, y);

  const safeName = company.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Company";
  const filename = `CINTEXA-${safeName}-Diagnostic-Strategy-Execution-${reportWhen.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
