import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * §67 PDF Reporting for the Sales Force module. Every function takes data the
 * caller has already fetched from real endpoints (sales-force-api.ts) — no
 * function here fetches or invents data itself. Every number in the output
 * traces back to something in the database.
 */

const COMPANY_NAME = "CINTEXA Nexus";
const HEADER_COLOR: [number, number, number] = [7, 13, 26];
const ACCENT_COLOR: [number, number, number] = [30, 107, 255];

function ensureSpace(doc: jsPDF, y: number, need = 24) {
  if (y + need > 285) {
    doc.addPage();
    return 18;
  }
  return y;
}

function line(doc: jsPDF, text: string, x: number, y: number, maxWidth = 182) {
  y = ensureSpace(doc, y);
  const wrapped = doc.splitTextToSize(text, maxWidth);
  doc.text(wrapped, x, y);
  return y + wrapped.length * 5 + 1;
}

function coverPage(doc: jsPDF, title: string, subtitle: string) {
  doc.setFillColor(...HEADER_COLOR);
  doc.rect(0, 0, 210, 42, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(COMPANY_NAME, 14, 16);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(title, 14, 24);
  doc.setFontSize(9);
  doc.setTextColor(160, 190, 220);
  doc.text(subtitle, 14, 32);
  doc.setTextColor(20, 30, 50);
  return 52;
}

function sectionTitle(doc: jsPDF, title: string, y: number, margin: number) {
  y = ensureSpace(doc, y, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...ACCENT_COLOR);
  y = line(doc, title, margin, y);
  doc.setDrawColor(...ACCENT_COLOR);
  doc.setLineWidth(0.4);
  doc.line(margin, y - 3, 210 - margin, y - 3);
  doc.setTextColor(20, 30, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  return y + 2;
}

function footer(doc: jsPDF, y: number, margin: number, generatedAt: Date) {
  y = ensureSpace(doc, y, 30);
  y += 6;
  doc.setDrawColor(...ACCENT_COLOR);
  doc.setLineWidth(0.3);
  doc.line(margin, y, 210 - margin, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  y = line(doc, `Generated: ${generatedAt.toLocaleString()}`, margin, y);
  doc.setFont("helvetica", "bold");
  y = line(doc, `© ${generatedAt.getFullYear()} Cintexa Technologies. All rights reserved.`, margin, y);
  doc.setFont("helvetica", "normal");
  y = line(doc, "CINTEXA Nexus — AI Sales Force", margin, y);
  return y;
}

function currency(v: number | string | null | undefined, code = "GHS") {
  const n = Number(v || 0);
  return `${code} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pct(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n)}%`;
}

// ————————————————————————————————————————————————————————————
// §39 Sales Performance Report (includes agent performance)
// ————————————————————————————————————————————————————————————
export type SalesPerformanceReportData = {
  leads: Array<{ stage: string; lastContactAt?: string | null; priorityScore?: number | null; qualityLabel?: string | null }>;
  opportunities: Array<{ stage: string; amount?: string | number | null }>;
  agents: Array<{ name: string; role: string; performance?: Record<string, any> | null; status?: string }>;
  attribution: { totalAttributedRevenue: number; byAgent: Record<string, number> };
};

export function downloadSalesPerformanceReport(data: SalesPerformanceReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "Sales Performance & Agent Performance Report", "Confidential — internal use");

  const generated = new Date();
  const totalLeads = data.leads.length;
  const contacted = data.leads.filter((l) => l.lastContactAt).length;
  const qualified = data.leads.filter((l) => ["sql", "high_intent", "opportunity_ready", "enterprise"].includes(l.qualityLabel || "")).length;
  const won = data.opportunities.filter((o) => o.stage === "closed_won").length;
  const totalOpps = data.opportunities.filter((o) => o.stage !== "closed_lost").length;
  const avgDeal = data.opportunities.filter((o) => o.stage === "closed_won").reduce((s, o) => s + Number(o.amount || 0), 0) / (won || 1);

  y = sectionTitle(doc, "1. Summary Metrics", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Leads generated", String(totalLeads)],
      ["Leads contacted", String(contacted)],
      ["Response rate", pct(totalLeads ? (contacted / totalLeads) * 100 : 0)],
      ["Qualification rate", pct(totalLeads ? (qualified / totalLeads) * 100 : 0)],
      ["Opportunities open", String(totalOpps)],
      ["Deals won", String(won)],
      ["Win rate", pct(totalOpps ? (won / (totalOpps + won)) * 100 : 0)],
      ["Average deal size", currency(avgDeal)],
      ["Total attributed revenue", currency(data.attribution.totalAttributedRevenue)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  y = sectionTitle(doc, "2. Agent Performance", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Agent", "Role", "Status", "Revenue Attributed"]],
    body: data.agents.map((a) => [
      a.name,
      a.role,
      a.status || "—",
      currency(data.attribution.byAgent[String((a as any).id)] ?? 0),
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-Sales-Performance-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}

// ————————————————————————————————————————————————————————————
// Pipeline Report
// ————————————————————————————————————————————————————————————
export type PipelineReportData = {
  opportunities: Array<{ name: string; companyName: string; stage: string; amount?: string | number | null; probability: number; riskScore?: number | null; updatedAt?: string | null }>;
  stages: Array<{ id: string; label: string }>;
};

export function downloadPipelineReport(data: PipelineReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "Pipeline Report", "Confidential — internal use");
  const generated = new Date();

  const open = data.opportunities.filter((o) => !["closed_won", "closed_lost"].includes(o.stage));
  const totalValue = open.reduce((s, o) => s + Number(o.amount || 0), 0);
  const weighted = open.reduce((s, o) => s + Number(o.amount || 0) * (o.probability / 100), 0);
  const atRisk = open.filter((o) => (o.riskScore ?? 0) >= 50);

  y = sectionTitle(doc, "1. Pipeline Summary", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Open opportunities", String(open.length)],
      ["Total pipeline value", currency(totalValue)],
      ["Weighted pipeline", currency(weighted)],
      ["At-risk opportunities", String(atRisk.length)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  y = sectionTitle(doc, "2. By Stage", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Stage", "Count", "Value"]],
    body: data.stages.map((s) => {
      const inStage = open.filter((o) => o.stage === s.id);
      return [s.label, String(inStage.length), currency(inStage.reduce((sum, o) => sum + Number(o.amount || 0), 0))];
    }),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  y = sectionTitle(doc, "3. Deals At Risk (risk score ≥ 50)", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Opportunity", "Company", "Stage", "Value", "Risk Score"]],
    body: atRisk.map((o) => [o.name, o.companyName, o.stage, currency(o.amount), String(o.riskScore)]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: [200, 60, 60] },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-Pipeline-Report-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}

// ————————————————————————————————————————————————————————————
// §32 Revenue Forecast Report
// ————————————————————————————————————————————————————————————
export type ForecastReportData = {
  current: { pipelineTotal: number; weightedPipeline: number; bestCase: number; expectedCase: number; worstCase: number; note?: string };
  history: Array<{ period: string; periodType: string; pipelineTotal: string | number; expectedCase: string | number; actualClosed?: string | number | null; createdAt: string }>;
};

export function downloadForecastReport(data: ForecastReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "Revenue Forecast Report", "Estimates only — not guaranteed outcomes");
  const generated = new Date();

  y = sectionTitle(doc, "1. Current Forecast", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Case", "Amount"]],
    body: [
      ["Pipeline total", currency(data.current.pipelineTotal)],
      ["Weighted pipeline", currency(data.current.weightedPipeline)],
      ["Best case", currency(data.current.bestCase)],
      ["Expected case", currency(data.current.expectedCase)],
      ["Worst case", currency(data.current.worstCase)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;
  if (data.current.note) y = line(doc, data.current.note, margin, y);
  y += 6;

  if (data.history.length) {
    y = sectionTitle(doc, "2. Forecast History (forecast vs. actual)", y, margin);
    autoTable(doc, {
      startY: y,
      head: [["Period", "Pipeline", "Expected", "Actual Closed", "Snapshot Date"]],
      body: data.history.map((h) => [
        h.period,
        currency(h.pipelineTotal),
        currency(h.expectedCase),
        h.actualClosed != null ? currency(h.actualClosed) : "Pending",
        new Date(h.createdAt).toLocaleDateString(),
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      headStyles: { fillColor: ACCENT_COLOR },
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;
  }

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-Forecast-Report-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}

// ————————————————————————————————————————————————————————————
// Campaign Report
// ————————————————————————————————————————————————————————————
export type CampaignReportData = {
  campaigns: Array<{ name: string; objective?: string | null; status: string; budget?: string | number | null; startDate?: string | null; endDate?: string | null }>;
};

export function downloadCampaignReport(data: CampaignReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "Campaign Report", "Confidential — internal use");
  const generated = new Date();

  y = sectionTitle(doc, "Campaigns", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Campaign", "Objective", "Status", "Budget", "Start", "End"]],
    body: data.campaigns.map((c) => [
      c.name,
      c.objective || "—",
      c.status,
      c.budget != null ? currency(c.budget) : "—",
      c.startDate ? new Date(c.startDate).toLocaleDateString() : "—",
      c.endDate ? new Date(c.endDate).toLocaleDateString() : "—",
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-Campaign-Report-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}

// ————————————————————————————————————————————————————————————
// §34 Lost Deal Report
// ————————————————————————————————————————————————————————————
export type LostDealReportData = {
  lostOpportunities: Array<{ name: string; companyName: string; amount?: string | number | null; lostReason?: string | null; lostAt?: string | null }>;
};

export function downloadLostDealReport(data: LostDealReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "Lost Deal Report", "Confidential — internal use");
  const generated = new Date();

  const byReason: Record<string, number> = {};
  let totalLost = 0;
  for (const o of data.lostOpportunities) {
    const reason = o.lostReason || "Not recorded";
    byReason[reason] = (byReason[reason] || 0) + 1;
    totalLost += Number(o.amount || 0);
  }

  y = sectionTitle(doc, "1. Summary", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Deals lost", String(data.lostOpportunities.length)],
      ["Total lost value", currency(totalLost)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  y = sectionTitle(doc, "2. Loss Reasons", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Reason", "Count"]],
    body: Object.entries(byReason).map(([reason, count]) => [reason, String(count)]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  y = sectionTitle(doc, "3. Lost Deals", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Opportunity", "Company", "Value", "Reason", "Lost Date"]],
    body: data.lostOpportunities.map((o) => [
      o.name, o.companyName, currency(o.amount), o.lostReason || "Not recorded",
      o.lostAt ? new Date(o.lostAt).toLocaleDateString() : "—",
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-Lost-Deal-Report-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}

// ————————————————————————————————————————————————————————————
// §51 Sales Audit Report
// ————————————————————————————————————————————————————————————
export type AuditReportData = {
  auditLog: Array<{ actorName: string; action: string; entityType?: string | null; entityId?: number | null; result?: string | null; createdAt: string }>;
};

export function downloadAuditReport(data: AuditReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "Sales AI Audit Log", "Confidential — internal use");
  const generated = new Date();

  y = sectionTitle(doc, `Audit Trail (${data.auditLog.length} entries)`, y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Timestamp", "Actor", "Action", "Entity", "Result"]],
    body: data.auditLog.map((a) => [
      new Date(a.createdAt).toLocaleString(),
      a.actorName,
      a.action,
      a.entityType && a.entityId ? `${a.entityType} #${a.entityId}` : "—",
      a.result || "—",
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-Sales-Audit-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}

// ————————————————————————————————————————————————————————————
// §25/§63 AI Workforce Report
// ————————————————————————————————————————————————————————————
export type WorkforceReportData = {
  agents: Array<{ name: string; role: string; status?: string; autonomyLevel?: number; performance?: Record<string, any> | null }>;
  attribution: { totalAttributedRevenue: number; byAgent: Record<string, number> };
  activityCounts: Record<string, number>; // agentId (as string) -> completed task count
};

export function downloadWorkforceReport(data: WorkforceReportData) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = coverPage(doc, "AI Sales Workforce Report", "Confidential — internal use");
  const generated = new Date();

  const active = data.agents.filter((a) => a.status === "active").length;

  y = sectionTitle(doc, "1. Workforce Summary", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Active agents", String(active)],
      ["Total agents", String(data.agents.length)],
      ["Total revenue attributed", currency(data.attribution.totalAttributedRevenue)],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  y = sectionTitle(doc, "2. Per-Agent Breakdown", y, margin);
  autoTable(doc, {
    startY: y,
    head: [["Agent", "Role", "Status", "Autonomy Level", "Tasks Completed", "Revenue Attributed"]],
    body: data.agents.map((a) => [
      a.name, a.role, a.status || "—", String(a.autonomyLevel ?? 1),
      String(data.activityCounts[String((a as any).id)] ?? 0),
      currency(data.attribution.byAgent[String((a as any).id)] ?? 0),
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9 },
    headStyles: { fillColor: ACCENT_COLOR },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 10;

  footer(doc, y, margin, generated);
  const filename = `CINTEXA-AI-Workforce-Report-${generated.toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
