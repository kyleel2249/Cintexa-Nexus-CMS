/**
 * Low-level PDF toolkit for the Website Intelligence report.
 *
 * Wraps jsPDF with a cursor-based layout engine (automatic page breaks, safe text wrapping for long URLs,
 * tables with repeating headers) and vector chart primitives. Everything drawn is also logged so the report
 * can be validated after generation (sections present, no blank pages, nothing clipped).
 */
import { jsPDF } from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";

export type RGB = [number, number, number];

export const PALETTE = {
  ink: [17, 24, 39] as RGB,
  body: [51, 65, 85] as RGB,
  muted: [100, 116, 139] as RGB,
  rule: [226, 232, 240] as RGB,
  panel: [248, 250, 252] as RGB,
  gold: [176, 134, 18] as RGB,
  goldSoft: [250, 243, 220] as RGB,
  white: [255, 255, 255] as RGB,
  good: [21, 128, 61] as RGB,
  warn: [180, 83, 9] as RGB,
  bad: [185, 28, 28] as RGB,
  blue: [29, 78, 216] as RGB,
  critical: [153, 27, 27] as RGB,
  high: [194, 65, 12] as RGB,
  medium: [161, 98, 7] as RGB,
  low: [29, 78, 216] as RGB,
  info: [100, 116, 139] as RGB,
};

export const SEVERITY_RGB: Record<string, RGB> = { critical: PALETTE.critical, high: PALETTE.high, medium: PALETTE.medium, low: PALETTE.low, info: PALETTE.info };

export function scoreRgb(score: number | null): RGB {
  if (score == null) return PALETTE.muted;
  if (score >= 90) return PALETTE.good;
  if (score >= 70) return [77, 124, 15];
  if (score >= 50) return PALETTE.warn;
  return PALETTE.bad;
}

/** jsPDF's built-in Helvetica supports WinAnsi (Windows-1252). Anything else would render as garbage. */
export function clean(input: unknown): string {
  return String(input ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\t/g, "  ")
    .replace(/[‐‑−]/g, "-")
    .replace(/[→]/g, "->")
    .replace(/[✓✔]/g, "OK")
    .replace(/[^\n\x20-\x7E\xA0-\xFF‘’“”–—•…€]/g, "?");
}

export interface Box { x: number; y: number; w: number; h: number }

export const PAGE = { w: 210, h: 297, left: 16, right: 16, top: 25, bottom: 20 };
export const CONTENT_W = PAGE.w - PAGE.left - PAGE.right;

export interface TextLogEntry { page: number; text: string }

export class Pdf {
  readonly doc: jsPDF;
  y = PAGE.top;
  readonly log: TextLogEntry[] = [];
  readonly pageHasContent = new Set<number>();
  readonly pageOwner = new Map<number, string>();
  currentSection = "";

  constructor(title: string) {
    this.doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true, putOnlyUsedFonts: true });
    this.doc.setProperties({ title: clean(title), creator: "CINTEXA NEXUS Website Intelligence", producer: "CINTEXA NEXUS", subject: "Website audit report" });
  }

  get page(): number { return this.doc.getCurrentPageInfo().pageNumber; }
  get pages(): number { return this.doc.getNumberOfPages(); }
  get bottom(): number { return PAGE.h - PAGE.bottom; }

  private mark(text?: string): void {
    this.pageHasContent.add(this.page);
    if (text) this.log.push({ page: this.page, text });
    if (!this.pageOwner.has(this.page)) this.pageOwner.set(this.page, this.currentSection);
  }

  addPage(): void {
    this.doc.addPage("a4", "portrait");
    this.y = PAGE.top;
  }

  ensure(h: number): void {
    if (this.y + h > this.bottom) this.addPage();
  }

  /** Move the cursor down, never past the page body. */
  gap(h: number): void { this.y += h; }

  setText(rgb: RGB, size: number, style: "normal" | "bold" | "italic" | "bolditalic" = "normal", font: "helvetica" | "courier" = "helvetica"): void {
    this.doc.setFont(font, style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  }

  /** Wrap text to a width, breaking over-long unbreakable tokens (URLs, hashes, code) so nothing overflows. */
  wrap(text: string, width: number): string[] {
    const out: string[] = [];
    for (const paragraph of clean(text).split("\n")) {
      if (!paragraph.trim()) { out.push(""); continue; }
      let line = "";
      for (const rawWord of paragraph.split(/ +/)) {
        let word = rawWord;
        while (this.doc.getTextWidth(word) > width) {
          let cut = word.length - 1;
          while (cut > 1 && this.doc.getTextWidth(word.slice(0, cut)) > width) cut--;
          const head = word.slice(0, cut);
          if (line) { out.push(line); line = ""; }
          out.push(head);
          word = word.slice(cut);
        }
        const candidate = line ? `${line} ${word}` : word;
        if (this.doc.getTextWidth(candidate) <= width) line = candidate;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  /** Draw wrapped text with automatic page breaks. Returns nothing; advances the cursor. */
  paragraph(text: string, o: { size?: number; color?: RGB; style?: "normal" | "bold" | "italic" | "bolditalic"; font?: "helvetica" | "courier"; x?: number; width?: number; lead?: number; after?: number } = {}): void {
    const size = o.size ?? 9.5;
    const x = o.x ?? PAGE.left;
    const width = o.width ?? CONTENT_W - (x - PAGE.left);
    const lead = o.lead ?? size * 0.5;
    this.setText(o.color ?? PALETTE.body, size, o.style ?? "normal", o.font ?? "helvetica");
    const lines = this.wrap(text, width);
    lines.forEach((l, i) => {
      // widow/orphan control: keep at least three lines together at the start and two at the end
      if (i === 0) this.ensure(Math.min(lines.length, 3) * lead);
      else if (lines.length - i === 2) this.ensure(2 * lead);
      else this.ensure(lead);
      this.doc.text(l, x, this.y + size * 0.3);
      this.mark(l);
      this.y += lead;
    });
    this.y += o.after ?? 2;
  }

  bullets(items: string[], o: { size?: number; x?: number; color?: RGB; max?: number } = {}): void {
    const size = o.size ?? 9.5;
    const x = o.x ?? PAGE.left;
    for (const item of items.slice(0, o.max ?? items.length)) {
      this.setText(o.color ?? PALETTE.body, size);
      const lines = this.wrap(item, CONTENT_W - (x - PAGE.left) - 5);
      lines.forEach((l, i) => {
        this.ensure(size * 0.5);
        if (i === 0) { this.doc.setFillColor(...PALETTE.gold); this.doc.circle(x + 1.2, this.y + size * 0.2, 0.55, "F"); }
        this.doc.text(l, x + 4.5, this.y + size * 0.3);
        this.mark(l);
        this.y += size * 0.5;
      });
      this.y += 0.8;
    }
    this.y += 1.5;
  }

  heading(level: 1 | 2 | 3, text: string, o: { numbered?: string; section?: string } = {}): void {
    const sizes = { 1: 17, 2: 12.5, 3: 10.5 } as const;
    const size = sizes[level];
    const label = o.numbered ? `${o.numbered}  ${text}` : text;
    this.ensure(level === 1 ? 30 : 22);
    if (level === 1) {
      this.y += 2;
      this.doc.setFillColor(...PALETTE.gold);
      this.doc.rect(PAGE.left, this.y, 14, 1.1, "F");
      this.y += 4;
    }
    this.setText(PALETTE.ink, size, "bold");
    const lines = this.wrap(label, CONTENT_W);
    for (const l of lines) {
      this.doc.text(l, PAGE.left, this.y + size * 0.32);
      this.mark(l);
      this.y += size * 0.5;
    }
    if (o.section && level === 1) {
      try { (this.doc as unknown as { outline: { add: (p: unknown, t: string, o: { pageNumber: number }) => unknown } }).outline.add(null, clean(label), { pageNumber: this.page }); } catch { /* outline is optional */ }
    }
    this.y += level === 1 ? 3 : 1.8;
  }

  rule(): void { this.doc.setDrawColor(...PALETTE.rule); this.doc.setLineWidth(0.2); this.doc.line(PAGE.left, this.y, PAGE.w - PAGE.right, this.y); this.y += 2.5; }

  /** Callout box with a coloured left bar. */
  callout(title: string, body: string, color: RGB = PALETTE.gold, fill: RGB = PALETTE.goldSoft): void {
    this.setText(PALETTE.body, 9);
    const lines = this.wrap(body, CONTENT_W - 10);
    const h = 8 + lines.length * 4.4 + (title ? 5 : 0);
    this.ensure(Math.min(h, 60));
    const top = this.y;
    this.doc.setFillColor(...fill);
    this.doc.rect(PAGE.left, top, CONTENT_W, h, "F");
    this.doc.setFillColor(...color);
    this.doc.rect(PAGE.left, top, 1.4, h, "F");
    let cy = top + 5;
    if (title) { this.setText(PALETTE.ink, 9.5, "bold"); this.doc.text(clean(title), PAGE.left + 5, cy); this.mark(clean(title)); cy += 5; }
    this.setText(PALETTE.body, 9);
    for (const l of lines) {
      if (cy > this.bottom - 2) { this.y = top + h; this.addPage(); return this.callout("", body.split("\n").slice(-2).join(" "), color, fill); }
      this.doc.text(l, PAGE.left + 5, cy);
      this.mark(l);
      cy += 4.4;
    }
    this.y = top + h + 3;
  }

  link(text: string, url: string, x: number, y: number, size = 8, color: RGB = PALETTE.blue): void {
    this.setText(color, size);
    this.doc.textWithLink(text, x, y, { url });
    this.mark(text);
  }

  /** A clickable URL list that wraps long addresses. */
  urlList(urls: string[], max = 6, x = PAGE.left + 4): void {
    for (const u of urls.slice(0, max)) {
      const shown = clean(u);
      this.setText(PALETTE.blue, 8, "normal", "courier");
      const lines = this.wrap(shown, CONTENT_W - (x - PAGE.left));
      lines.forEach((l, i) => {
        this.ensure(4);
        if (i === 0 && /^https?:\/\//i.test(u)) this.doc.textWithLink(l, x, this.y + 2.2, { url: u });
        else this.doc.text(l, x, this.y + 2.2);
        this.mark(l);
        this.y += 3.7;
      });
    }
    if (urls.length > max) this.paragraph(`+ ${urls.length - max} more affected URL(s) in the dashboard export.`, { size: 8, color: PALETTE.muted, x });
  }

  table(opts: { head: string[]; body: (string | number)[][]; widths?: number[]; fontSize?: number; headFill?: RGB; rowFill?: (row: (string | number)[], i: number) => RGB | null; cellColor?: (col: number, row: (string | number)[]) => RGB | null }): void {
    if (!opts.body.length) return;
    this.ensure(18);
    const columnStyles: Record<number, { cellWidth: number }> = {};
    opts.widths?.forEach((w, i) => { columnStyles[i] = { cellWidth: w }; });
    const options: UserOptions = {
      startY: this.y,
      margin: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right },
      head: [opts.head.map(clean)],
      body: opts.body.map((r) => r.map((c) => clean(c))),
      theme: "grid",
      showHead: "everyPage",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: opts.fontSize ?? 8, cellPadding: 1.8, textColor: PALETTE.body, lineColor: PALETTE.rule, lineWidth: 0.15, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: opts.headFill ?? PALETTE.ink, textColor: PALETTE.white, fontStyle: "bold" },
      alternateRowStyles: { fillColor: PALETTE.panel },
      columnStyles,
      didParseCell: (d) => {
        if (d.section !== "body") return;
        const row = opts.body[d.row.index];
        const c = opts.cellColor?.(d.column.index, row);
        if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = "bold"; }
        const f = opts.rowFill?.(row, d.row.index);
        if (f) d.cell.styles.fillColor = f;
      },
      didDrawPage: () => { this.pageHasContent.add(this.page); if (!this.pageOwner.has(this.page)) this.pageOwner.set(this.page, this.currentSection); },
      didDrawCell: (d) => { if (d.section === "body" || d.section === "head") this.log.push({ page: this.page, text: (d.cell.text ?? []).join(" ") }); },
    };
    autoTable(this.doc, options);
    const last = (this.doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    this.y = (last?.finalY ?? this.y) + 5;
  }

  // ------------------------------------------------------------------ vector charts

  /** Semicircular gauge. */
  gauge(cx: number, cy: number, r: number, score: number | null, caption: string): void {
    const d = this.doc;
    const seg = 48;
    const arc = (from: number, to: number, rgb: RGB, lw: number) => {
      d.setDrawColor(...rgb); d.setLineWidth(lw);
      const n = Math.max(2, Math.ceil(seg * (to - from)));
      let px = cx - r * Math.cos(Math.PI * from), py = cy - r * Math.sin(Math.PI * from);
      for (let i = 1; i <= n; i++) {
        const t = from + ((to - from) * i) / n;
        const x = cx - r * Math.cos(Math.PI * t), y = cy - r * Math.sin(Math.PI * t);
        d.line(px, py, x, y);
        px = x; py = y;
      }
    };
    arc(0, 1, PALETTE.rule, 4.2);
    if (score != null) arc(0, Math.max(0.005, Math.min(1, score / 100)), scoreRgb(score), 4.2);
    this.setText(score == null ? PALETTE.muted : scoreRgb(score), r * 1.15, "bold");
    const big = score == null ? "n/a" : String(Math.round(score));
    d.text(big, cx, cy - r * 0.12, { align: "center" });
    this.setText(PALETTE.muted, 7.5);
    d.text(clean(caption), cx, cy + 5, { align: "center" });
    this.log.push({ page: this.page, text: `${caption} ${big}` });
    this.mark();
  }

  /** Category radar. Categories with no score are not plotted and are labelled n/a. */
  radar(cx: number, cy: number, r: number, axes: { label: string; value: number | null }[]): void {
    const d = this.doc;
    const n = axes.length;
    const pt = (i: number, rad: number): [number, number] => [cx + rad * Math.sin((2 * Math.PI * i) / n), cy - rad * Math.cos((2 * Math.PI * i) / n)];
    d.setDrawColor(...PALETTE.rule); d.setLineWidth(0.2);
    for (const ring of [0.25, 0.5, 0.75, 1]) {
      for (let i = 0; i < n; i++) { const a = pt(i, r * ring), b = pt((i + 1) % n, r * ring); d.line(a[0], a[1], b[0], b[1]); }
    }
    for (let i = 0; i < n; i++) { const p = pt(i, r); d.line(cx, cy, p[0], p[1]); }
    this.setText(PALETTE.muted, 6); 
    for (const ring of [50, 100]) d.text(String(ring), cx + 1, cy - (r * ring) / 100 + 2);
    const pts = axes.map((a, i) => pt(i, r * ((a.value ?? 0) / 100)));
    d.setFillColor(...PALETTE.gold); d.setDrawColor(...PALETTE.gold); d.setLineWidth(0.7);
    const gs = (d as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
    try { d.setGState(new gs({ opacity: 0.22 }) as never); } catch { /* opacity optional */ }
    const rel: [number, number][] = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    rel.push([pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]]);
    d.lines(rel, pts[0][0], pts[0][1], [1, 1], "F", true);
    try { d.setGState(new gs({ opacity: 1 }) as never); } catch { /* ignore */ }
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; if (axes[i].value != null && axes[(i + 1) % n].value != null) d.line(a[0], a[1], b[0], b[1]); }
    axes.forEach((a, i) => {
      if (a.value != null) { d.setFillColor(...PALETTE.gold); d.circle(pts[i][0], pts[i][1], 0.9, "F"); }
      const [lx, ly] = pt(i, r + 5.5);
      this.setText(PALETTE.ink, 7, "bold");
      const text = `${clean(a.label)} ${a.value == null ? "n/a" : Math.round(a.value)}`;
      const align = Math.abs(lx - cx) < 2 ? "center" : lx > cx ? "left" : "right";
      d.text(text, lx, ly + 1, { align });
      this.log.push({ page: this.page, text });
    });
    this.mark();
  }

  /** Horizontal bars. `max` defaults to 100. Null values are labelled n/a and drawn as empty tracks. */
  bars(box: Box, rows: { label: string; value: number | null; color?: RGB; suffix?: string; note?: string }[], o: { max?: number; labelW?: number; rowH?: number } = {}): void {
    const d = this.doc;
    const max = o.max ?? 100;
    const labelW = o.labelW ?? 52;
    const rowH = o.rowH ?? Math.min(8, box.h / Math.max(1, rows.length));
    const trackW = box.w - labelW - 22;
    rows.forEach((r, i) => {
      const y = box.y + i * rowH;
      this.setText(PALETTE.ink, 7.5);
      const label = this.wrap(r.label, labelW - 2)[0] ?? "";
      d.text(label, box.x, y + rowH * 0.62);
      d.setFillColor(...PALETTE.rule); d.rect(box.x + labelW, y + rowH * 0.18, trackW, rowH * 0.5, "F");
      if (r.value != null) {
        const w = Math.max(0.6, Math.min(1, r.value / max) * trackW);
        d.setFillColor(...(r.color ?? scoreRgb(max === 100 ? r.value : null))); d.rect(box.x + labelW, y + rowH * 0.18, w, rowH * 0.5, "F");
      }
      this.setText(r.value == null ? PALETTE.muted : PALETTE.ink, 7.5, "bold");
      const txt = r.value == null ? "n/a" : `${Math.round(r.value * 10) / 10}${r.suffix ?? ""}`;
      d.text(txt, box.x + labelW + trackW + 2, y + rowH * 0.62);
      this.log.push({ page: this.page, text: `${r.label} ${txt}` });
    });
    this.mark();
  }

  /** Single stacked bar with a legend; zero segments are omitted. */
  stacked(x: number, y: number, w: number, h: number, parts: { label: string; value: number; color: RGB }[]): void {
    const d = this.doc;
    const total = parts.reduce((s, p) => s + p.value, 0);
    if (total <= 0) { this.setText(PALETTE.muted, 8); d.text("No data", x, y + h * 0.7); this.mark("No data"); return; }
    let cx = x;
    for (const p of parts) {
      if (p.value <= 0) continue;
      const pw = (p.value / total) * w;
      d.setFillColor(...p.color); d.rect(cx, y, pw, h, "F");
      cx += pw;
    }
    let lx = x; let ly = y + h + 5;
    this.setText(PALETTE.body, 7.5);
    for (const p of parts) {
      const t = `${p.label}: ${p.value}`;
      const tw = d.getTextWidth(t) + 8;
      if (lx + tw > x + w) { lx = x; ly += 4.5; }
      d.setFillColor(...p.color); d.rect(lx, ly - 2.4, 2.8, 2.8, "F");
      d.text(clean(t), lx + 4, ly);
      this.log.push({ page: this.page, text: t });
      lx += tw + 2;
    }
    this.mark();
    this.y = Math.max(this.y, ly + 4);
  }
}

export type { jsPDF };
