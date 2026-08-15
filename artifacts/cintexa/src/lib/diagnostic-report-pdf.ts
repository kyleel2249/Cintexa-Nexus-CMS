import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Report = {
  meta: { title: string; companyName: string; industry: string; generatedAt: string; evidencePolicy: string };
  executiveSummary: { overallScore: number; condition: string; topProblems: string[]; topPriority: any; biggestOpportunity: string };
  findings: Array<{ pillar: string; problem: string; evidence: string; confidence: string; impact: string; rationale: string; recommendedAction: string }>;
  benchmarks?: { industry: string; rows: Array<{ metric: string; actual: number | null; benchmark: number; unit: string; gap: number | null; source: string }> };
  smartGoals?: Array<{ title: string; owner?: string; deadline?: string; kpi?: string; goalType?: string; smartValidation?: { score: number } }>;
  roadmap?: { days7: any[]; days30: any[]; days90: any[]; months4to6: any[]; months7to12: any[] };
  kpis?: Array<{ name: string; baseline: number | null; target: string | number; owner: string }>;
  swot?: { strengths: any[]; weaknesses: any[]; opportunities: any[]; threats: any[] };
  competitors?: Array<{ name: string; positioning?: string; strengths?: string; weaknesses?: string }>;
  sales?: Record<string, number | null>;
};

function line(doc: jsPDF, text: string, x: number, y: number, maxWidth = 180) {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * 5 + 2;
}

export function downloadDiagnosticPdf(report: Report) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(report.meta.title, margin, y);
  y += 8;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  y = line(doc, `Company: ${report.meta.companyName}`, margin, y);
  y = line(doc, `Industry: ${report.meta.industry}`, margin, y);
  y = line(doc, `Generated: ${new Date(report.meta.generatedAt).toLocaleString()}`, margin, y);
  y = line(doc, report.meta.evidencePolicy, margin, y, 180);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("1. Executive Summary", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = line(doc, `Overall Health: ${report.executiveSummary.overallScore}/100 — ${report.executiveSummary.condition}`, margin, y);
  y = line(doc, `Biggest opportunity: ${report.executiveSummary.biggestOpportunity}`, margin, y);
  y = line(doc, `Top problems: ${report.executiveSummary.topProblems.join("; ") || "None listed"}`, margin, y);
  y += 3;

  if (report.sales) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("2. Sales Metrics (Calculated)", margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: Object.entries(report.sales).map(([k, v]) => [k, v == null ? "—" : String(typeof v === "number" ? v.toFixed(2) : v)]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  if (y > 250) { doc.addPage(); y = 16; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("3. Prioritized Findings", margin, y);
  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Pillar", "Problem", "Impact", "Evidence", "Action"]],
    body: (report.findings ?? []).slice(0, 12).map((f) => [f.pillar, f.problem, f.impact, f.evidence, f.recommendedAction]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellWidth: "wrap" },
    columnStyles: { 1: { cellWidth: 40 }, 4: { cellWidth: 55 } },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;

  if (report.benchmarks?.rows?.length) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`4. Benchmarking (${report.benchmarks.industry})`, margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Actual", "Benchmark", "Gap", "Source"]],
      body: report.benchmarks.rows.map((r) => [
        r.metric,
        r.actual == null ? "—" : String(r.actual.toFixed?.(2) ?? r.actual),
        `${r.benchmark} ${r.unit}`,
        r.gap == null ? "—" : r.gap.toFixed(2),
        r.source,
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  if (report.smartGoals?.length) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("5. SMART Goals", margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Level", "Goal", "Owner", "Deadline", "KPI", "SMART"]],
      body: report.smartGoals.map((g) => [
        g.goalType ?? "",
        g.title,
        g.owner ?? "",
        g.deadline ?? "",
        g.kpi ?? "",
        g.smartValidation ? `${g.smartValidation.score}/100` : "—",
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  if (report.kpis?.length) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("6. KPI Framework", margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["KPI", "Baseline", "Target", "Owner"]],
      body: report.kpis.map((k) => [k.name, k.baseline == null ? "—" : String(k.baseline), String(k.target), k.owner]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8;
  }

  if (report.roadmap) {
    doc.addPage();
    y = 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("7. Execution Roadmap", margin, y);
    y += 6;
    const sections: Array<[string, any[]]> = [
      ["First 7 days", report.roadmap.days7],
      ["First 30 days", report.roadmap.days30],
      ["Days 31–90", report.roadmap.days90],
      ["Months 4–6", report.roadmap.months4to6],
      ["Months 7–12", report.roadmap.months7to12],
    ];
    for (const [label, items] of sections) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(label, margin, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const item of items ?? []) {
        y = line(doc, `• ${item.action} | Owner: ${item.owner ?? "TBD"} | KPI: ${item.kpi ?? "TBD"}`, margin, y);
        if (y > 275) { doc.addPage(); y = 16; }
      }
      y += 3;
    }
  }

  if (report.swot) {
    doc.addPage();
    y = 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("8. SWOT (Evidence-linked)", margin, y);
    y += 6;
    for (const [label, items] of [
      ["Strengths", report.swot.strengths],
      ["Weaknesses", report.swot.weaknesses],
      ["Opportunities", report.swot.opportunities],
      ["Threats", report.swot.threats],
    ] as const) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(label, margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const item of items ?? []) {
        y = line(doc, `• ${item.item} [${item.evidence}] → ${item.action}`, margin, y);
        if (y > 275) { doc.addPage(); y = 16; }
      }
      y += 3;
    }
  }

  if (report.competitors?.length) {
    if (y > 240) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("9. Competitors", margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Name", "Positioning", "Strengths", "Weaknesses"]],
      body: report.competitors.map((c) => [c.name, c.positioning ?? "—", c.strengths ?? "—", c.weaknesses ?? "—"]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
    });
  }

  doc.addPage();
  y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("10. Evidence Policy & Next Steps", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = line(doc, report.meta.evidencePolicy, margin, y);
  y = line(doc, "Next: assign owners to SMART goals, establish KPI baselines this week, and schedule a 30-day review.", margin, y);
  y = line(doc, "CINTEXA Nexus treats this as a living plan: diagnose → prioritize → execute → measure → adapt.", margin, y);

  const filename = `CINTEXA-Diagnostic-${report.meta.companyName.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
