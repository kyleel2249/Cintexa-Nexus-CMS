/**
 * CSI management PDF exports — jsPDF + autotable (already in workspace).
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency } from "@/lib/format/currency";

function footer(doc: jsPDF) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`CINTEXA · Corporate Strategy & Intelligence · Confidential · Page ${i} of ${n}`, 14, 287);
  }
}

export function exportCsiOverviewPdf(input: {
  profile?: { legalName?: string; vision?: string };
  dashboard: any;
  budgetVsActual?: any;
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const gen = new Date().toISOString().slice(0, 16).replace("T", " ");
  doc.setFontSize(16);
  doc.text("CINTEXA — Corporate Strategy & Intelligence", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`Generated ${gen} UTC · ${input.profile?.legalName || "CINTEXA"}`, 14, 26);
  doc.setTextColor(0);
  if (input.profile?.vision) {
    doc.setFontSize(9);
    doc.text(`Vision: ${input.profile.vision.slice(0, 120)}`, 14, 34, { maxWidth: 180 });
  }

  const d = input.dashboard || {};
  autoTable(doc, {
    startY: 42,
    head: [["Indicator", "Value"]],
    body: [
      ["Active objectives", String(d.objectivesActive ?? "—")],
      ["Avg progress", d.objectivesAvgProgress != null ? `${d.objectivesAvgProgress}%` : "—"],
      ["Open risks", String(d.openRisks ?? "—")],
      ["Active products", `${d.productsActive ?? 0} / ${d.productsTotal ?? 0}`],
      ["Budget planned", formatCurrency(d.budgetPlannedMinor ?? 0)],
      ["Budget actual", formatCurrency(d.budgetActualMinor ?? 0)],
    ],
    styles: { fontSize: 9 },
  });

  let y = (doc as any).lastAutoTable.finalY + 8;
  if (input.budgetVsActual?.rows?.length) {
    doc.setFontSize(12);
    doc.text("Budget vs actual", 14, y);
    autoTable(doc, {
      startY: y + 4,
      head: [["Category", "Planned", "Actual", "Variance", "Util %", "Source"]],
      body: input.budgetVsActual.rows.map((r: any) => [
        r.category,
        formatCurrency(r.plannedMinor),
        formatCurrency(r.actualMinor),
        formatCurrency(r.varianceMinor),
        r.utilisationPct != null ? `${r.utilisationPct}%` : "—",
        r.source,
      ]),
      styles: { fontSize: 8 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  if ((d.insights || []).length) {
    const iy = (doc as any).lastAutoTable?.finalY + 10 || y + 10;
    doc.setFontSize(12);
    doc.text("Intelligence alerts", 14, iy);
    autoTable(doc, {
      startY: iy + 4,
      head: [["Severity", "Title", "Detail"]],
      body: (d.insights || []).slice(0, 12).map((i: any) => [i.severity, i.title, i.detail]),
      styles: { fontSize: 8 },
    });
  }

  footer(doc);
  doc.save(`cintexa-csi-overview-${new Date().toISOString().slice(0, 10)}.pdf`);
}
