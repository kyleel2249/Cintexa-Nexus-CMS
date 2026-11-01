/** Reusable, branded PDF builder (jsPDF + autotable). Every document in Sales uses it so layouts, numbers, page breaks and footers stay consistent. */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const NAVY: [number, number, number] = [16, 42, 84];
export const ACCENTS: Record<string, [number, number, number]> = { blue: [37, 99, 235], green: [22, 163, 74], purple: [126, 34, 206], orange: [234, 88, 12], navy: NAVY };
export const symbol = (code: string) => (code === "GHS" ? "GHC" : code);

/** Exact string formatting of a decimal amount (no floating-point arithmetic): 3000 -> "GHC 3,000.00". */
export function fmt(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === "") return "-";
  const s = String(amount).trim(); const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return `${symbol(currency)} ${s}`;
  const frac = ((m[3] ?? "") + "00").slice(0, 2);
  return `${m[1]}${symbol(currency)} ${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}
export const dmy = (d: string | Date | null | undefined): string => {
  if (!d) return "-"; const x = typeof d === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T12:00:00Z" : d) : d;
  return Number.isNaN(x.getTime()) ? "-" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? "UTC" : undefined }).format(x);
};

export class Pdf {
  doc: jsPDF; y = 32; readonly W: number; readonly H: number; readonly M = 14;
  constructor(public title: string, public reference: string, public accent: [number, number, number] = NAVY, orientation: "p" | "l" = "p", public subtitle = "") {
    this.doc = new jsPDF({ orientation, unit: "mm", format: "a4" }); this.W = this.doc.internal.pageSize.getWidth(); this.H = this.doc.internal.pageSize.getHeight();
    this.doc.setProperties({ title: `${title} ${reference}`.trim(), creator: "CINTEXA Nexus CMS" });
  }
  private space(h: number) { if (this.y + h > this.H - 18) { this.doc.addPage(); this.y = 32; } }
  heading(text: string) { this.space(12); const d = this.doc; d.setFont("helvetica", "bold").setFontSize(11).setTextColor(...this.accent); d.text(text.toUpperCase(), this.M, this.y); d.setDrawColor(...this.accent).setLineWidth(0.4).line(this.M, this.y + 1.8, this.W - this.M, this.y + 1.8); this.y += 7; d.setTextColor(30, 30, 30); }
  text(text: string, o: { bold?: boolean; size?: number; muted?: boolean } = {}) {
    const d = this.doc; d.setFont("helvetica", o.bold ? "bold" : "normal").setFontSize(o.size ?? 9.5).setTextColor(...(o.muted ? ([100, 100, 100] as [number, number, number]) : ([30, 30, 30] as [number, number, number])));
    for (const line of d.splitTextToSize(text, this.W - this.M * 2) as string[]) { this.space(5); d.text(line, this.M, this.y); this.y += (o.size ?? 9.5) * 0.45 + 1.2; } this.y += 1;
  }
  bullets(items: string[]) { const d = this.doc; d.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(30, 30, 30); for (const it of items) for (const [k, line] of (d.splitTextToSize(it, this.W - this.M * 2 - 6) as string[]).entries()) { this.space(5); if (k === 0) d.text("•", this.M + 1, this.y); d.text(line, this.M + 6, this.y); this.y += 5; } this.y += 1; }
  kv(rows: [string, string][], columns = 2) {
    const d = this.doc, colW = (this.W - this.M * 2) / columns; const per = Math.ceil(rows.length / columns); let maxY = this.y;
    for (let c = 0; c < columns; c++) { let yy = this.y; for (const [k, val] of rows.slice(c * per, (c + 1) * per)) {
      const lines = d.setFont("helvetica", "normal").setFontSize(9.5).splitTextToSize(val || "-", colW - 36) as string[];
      if (yy + lines.length * 4.6 > this.H - 18) { d.addPage(); yy = 32; }
      d.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(100, 100, 100).text(k, this.M + c * colW, yy);
      d.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(30, 30, 30).text(lines, this.M + c * colW + 36, yy); yy += Math.max(1, lines.length) * 4.6 + 1.4; } maxY = Math.max(maxY, yy); }
    this.y = maxY + 2;
  }
  table(head: string[], body: string[][], o: { align?: ("left" | "right" | "center")[]; foot?: string[][]; widths?: number[] } = {}) {
    this.space(16);
    autoTable(this.doc, { startY: this.y, head: [head], body, foot: o.foot, margin: { left: this.M, right: this.M, top: 30, bottom: 18 }, theme: "striped", styles: { fontSize: 8.8, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: this.accent, textColor: 255 }, footStyles: { fillColor: [235, 238, 245], textColor: 20, fontStyle: "bold" },
      columnStyles: Object.fromEntries((o.align ?? []).map((a, i) => [i, { halign: a, ...(o.widths?.[i] ? { cellWidth: o.widths[i] } : {}) }])), showHead: "everyPage" });
    this.y = ((this.doc as any).lastAutoTable?.finalY ?? this.y) + 6;
  }
  totals(rows: [string, string, boolean?][]) { const d = this.doc; for (const [k, val, strong] of rows) { this.space(6); d.setFont("helvetica", strong ? "bold" : "normal").setFontSize(strong ? 11 : 9.5).setTextColor(30, 30, 30); d.text(k, this.W - this.M - 78, this.y); d.text(val, this.W - this.M, this.y, { align: "right" }); this.y += strong ? 7 : 5.5; } this.y += 2; }
  signatures(labels: string[]) { this.space(30); this.y += 14; const w = (this.W - this.M * 2) / labels.length; labels.forEach((l, i) => { this.doc.setDrawColor(90).setLineWidth(0.3).line(this.M + i * w, this.y, this.M + i * w + w - 10, this.y); this.doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90, 90, 90).text(l, this.M + i * w, this.y + 4.5); }); this.y += 10; }
  gap(h = 4) { this.y += h; }
  /** draws the header band and footer on every page, then returns the document */
  finish(): jsPDF {
    const d = this.doc, n = d.getNumberOfPages(), stamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
    for (let i = 1; i <= n; i++) {
      d.setPage(i); d.setFillColor(...NAVY).rect(0, 0, this.W, 22, "F"); d.setFillColor(...this.accent).rect(0, 22, this.W, 1.6, "F");
      d.setTextColor(255).setFont("helvetica", "bold").setFontSize(15).text("CINTEXA", this.M, 11); d.setFont("helvetica", "normal").setFontSize(7.5).text("Connected technology systems and digital support for modern businesses", this.M, 16.5);
      d.setFont("helvetica", "bold").setFontSize(11).text(this.title, this.W - this.M, 10, { align: "right" }); d.setFont("helvetica", "normal").setFontSize(8.5).text([this.reference, this.subtitle].filter(Boolean).join("  |  "), this.W - this.M, 16, { align: "right" });
      d.setDrawColor(200).setLineWidth(0.2).line(this.M, this.H - 12, this.W - this.M, this.H - 12);
      d.setTextColor(110).setFont("helvetica", "normal").setFontSize(7.5).text(`Generated ${stamp}  |  ${this.reference}`, this.M, this.H - 7.5); d.text(`Page ${i} of ${n}`, this.W - this.M, this.H - 7.5, { align: "right" });
    }
    return d;
  }
  save(filename: string) { this.finish().save(filename); }
  blob(): Blob { return this.finish().output("blob"); }
}

/** Generic list/report PDF (landscape) for any table of text rows. */
export function reportPdf(o: { title: string; subtitle?: string; filters?: [string, string][]; head: string[]; rows: string[][]; foot?: string[][]; align?: ("left" | "right" | "center")[]; reference?: string }): Pdf {
  const p = new Pdf(o.title, o.reference ?? "REPORT", NAVY, "l", o.subtitle ?? "");
  if (o.filters?.length) { p.heading("Filters & period"); p.kv(o.filters, 3); }
  p.heading(`${o.rows.length} record${o.rows.length === 1 ? "" : "s"}`);
  if (o.rows.length) p.table(o.head, o.rows, { align: o.align, foot: o.foot }); else p.text("No records match the current filters.", { muted: true });
  return p;
}
