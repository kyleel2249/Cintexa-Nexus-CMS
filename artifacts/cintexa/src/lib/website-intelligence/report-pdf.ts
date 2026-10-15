/**
 * Website Intelligence PDF report generator.
 *
 * Builds the selected report entirely in the browser from an AuditBundle (the same data the dashboard shows),
 * validates the result, and returns the bytes + metadata. Nothing is fabricated: any value the audit did not
 * produce is printed as "n/a" / "not tested" with the reason.
 */
import {
  CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_SHORT_LABELS, FINDING_STATUS_LABELS, HORIZON_LABELS, PRIORITY_FORMULA, REPORT_TYPE_LABELS, SCORE_FORMULA, STAGE_LABELS, WEBSITE_TYPE_LABELS,
  reportFileName,
  type AuditBundle, type FindingView, type ReportType, type Severity,
} from "@workspace/wi-core";
import { CONTENT_W, PAGE, PALETTE, Pdf, SEVERITY_RGB, clean, scoreRgb, type RGB } from "./pdf-kit";

export const REPORT_VERSION = "1.0";

type SectionKey =
  | "exec" | "method" | "scope" | "overall" | "categories" | "techseo" | "onpage" | "crawl" | "schema" | "perf" | "a11y" | "security" | "func" | "content"
  | "conversion" | "infra" | "pages" | "evidence" | "plan" | "sequence" | "retest" | "glossary" | "refs" | "limits" | "final" | "comparison";

interface SectionDef { key: SectionKey; title: string }

/** The 27-part structure: cover + contents are structural pages; the rest are numbered sections. */
export const SECTION_TITLES: Record<SectionKey, string> = {
  exec: "Executive summary",
  method: "Assessment methodology",
  scope: "Scope and limitations",
  overall: "Overall score and readiness",
  categories: "Category score analysis",
  techseo: "Technical SEO findings",
  onpage: "On-page SEO findings",
  crawl: "Crawl and indexability analysis",
  schema: "Structured data findings",
  perf: "Performance and Core Web Vitals",
  a11y: "Accessibility findings",
  security: "Security and privacy review",
  func: "Functionality and user experience",
  content: "Content quality assessment",
  conversion: "Business conversion assessment",
  infra: "Infrastructure and reliability",
  pages: "Page-by-page findings",
  evidence: "Evidence and screenshots",
  plan: "Prioritized remediation plan",
  sequence: "Recommended implementation sequence",
  retest: "Retesting criteria",
  glossary: "Glossary",
  refs: "References and official documentation",
  limits: "Assessment limitations",
  final: "Final readiness statement",
  comparison: "Before-and-after comparison",
};

const ALL_SECTIONS: SectionKey[] = ["exec", "method", "scope", "overall", "categories", "techseo", "onpage", "crawl", "schema", "perf", "a11y", "security", "func", "content", "conversion", "infra", "pages", "evidence", "plan", "sequence", "retest", "glossary", "refs", "limits", "final"];

export const REPORT_SECTIONS: Record<ReportType, SectionKey[]> = {
  full: ALL_SECTIONS,
  technical: ALL_SECTIONS.filter((s) => s !== "conversion" && s !== "content"),
  executive: ["exec", "method", "scope", "overall", "categories", "plan", "limits", "final"],
  seo: ["exec", "method", "scope", "overall", "categories", "techseo", "onpage", "crawl", "schema", "plan", "sequence", "retest", "refs", "limits", "final"],
  performance: ["exec", "method", "scope", "overall", "perf", "plan", "retest", "refs", "limits", "final"],
  accessibility: ["exec", "method", "scope", "overall", "a11y", "plan", "retest", "glossary", "refs", "limits", "final"],
  security: ["exec", "method", "scope", "overall", "security", "plan", "retest", "refs", "limits", "final"],
  conversion: ["exec", "method", "scope", "overall", "conversion", "content", "func", "plan", "retest", "limits", "final"],
  roadmap: ["exec", "overall", "plan", "sequence", "retest", "limits", "final"],
  comparison: ["exec", "overall", "categories", "comparison", "limits", "final"],
};

/** Restricts which findings a single-topic report includes. */
function findingScope(type: ReportType): ((f: FindingView) => boolean) {
  switch (type) {
    case "seo": return (f) => f.category === "seo";
    case "performance": return (f) => f.category === "performance";
    case "accessibility": return (f) => f.category === "accessibility";
    case "security": return (f) => f.category === "security";
    case "conversion": return (f) => f.tags.includes("conversion") || f.category === "content" || f.category === "functionality" || f.category === "ux";
    default: return () => true;
  }
}

export interface ReportOptions {
  type: ReportType;
  brandName?: string;
  confidentiality?: string;
  now?: Date;
}

export interface ValidationCheck { name: string; ok: boolean; detail: string }

export interface GeneratedReport {
  bytes: Uint8Array;
  blob: Blob;
  fileName: string;
  pages: number;
  sizeBytes: number;
  sha256: string;
  reportId: string;
  type: ReportType;
  sections: string[];
  validation: { ok: boolean; checks: ValidationCheck[] };
}

export class ReportValidationError extends Error {
  checks: ValidationCheck[];
  constructor(checks: ValidationCheck[]) {
    super(`Report validation failed: ${checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join("; ")}`);
    this.name = "ReportValidationError";
    this.checks = checks;
  }
}

const sevOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const bySeverity = (a: FindingView, b: FindingView) => sevOrder[a.severity] - sevOrder[b.severity] || b.priorityScore - a.priorityScore;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "n/a");
const fmtMs = (v?: number) => (v == null ? "n/a" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const defects = (list: FindingView[]) => list.filter((f) => f.kind === "defect");
const hostLabel = (b: AuditBundle) => b.audit.config.name || b.audit.hostname;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) return "";
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const digest = await subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function plannedSections(type: ReportType): SectionDef[] {
  return REPORT_SECTIONS[type].map((key) => ({ key, title: SECTION_TITLES[key] }));
}

// ---------------------------------------------------------------------------------------------------------------------

export async function generateReport(bundle: AuditBundle, options: ReportOptions): Promise<GeneratedReport> {
  const { audit } = bundle;
  const scores = audit.scores;
  if (!scores) throw new Error("This audit has no scores yet. A report can only be generated once scoring has finished.");
  const now = options.now ?? new Date();
  const type = options.type;
  const sections = plannedSections(type).filter((s) => s.key !== "comparison" || bundle.comparison);
  const scope = findingScope(type);
  const findings = bundle.findings.filter(scope).sort(bySeverity);
  const brand = options.brandName || audit.config.report.brandName || "CINTEXA NEXUS";
  const confidentiality = options.confidentiality ?? audit.config.report.confidentiality ?? "Confidential - prepared for the website owner";
  const reportId = `WI-${audit.id.slice(0, 8).toUpperCase()}-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${type.slice(0, 3).toUpperCase()}`;
  const title = `${REPORT_TYPE_LABELS[type]} - ${hostLabel(bundle)}`;

  const p = new Pdf(title);
  const doc = p.doc;
  const sectionPages = new Map<string, number>();
  const ctx: Ctx = { p, bundle, scope, findings, now, reportId, brand, confidentiality, type };

  // 1. cover, 2. contents (filled in last, once page numbers are known)
  drawCover(ctx);
  p.addPage();
  p.currentSection = "Table of contents";
  const tocPage = p.page;
  p.heading(1, "Table of contents");
  p.setText(PALETTE.muted, 8); doc.text("Entries are clickable.", PAGE.left, p.y + 2); p.gap(6);
  p.pageHasContent.add(tocPage);

  const builders: Record<SectionKey, (c: Ctx) => void> = {
    exec: secExec, method: secMethod, scope: secScope, overall: secOverall, categories: secCategories,
    techseo: (c) => findingSection(c, "techseo", (f) => f.tags.includes("technical_seo") && f.category === "seo" && !["indexability", "crawlability", "sitemap", "links", "rendering"].includes(f.subcategory) && !f.testId.startsWith("schema.")),
    onpage: (c) => findingSection(c, "onpage", (f) => f.tags.includes("on_page_seo") || f.testId.startsWith("onpage.")),
    crawl: (c) => { findingSection(c, "crawl", (f) => ["indexability", "crawlability", "sitemap", "links", "rendering"].includes(f.subcategory) && f.category === "seo"); coverageBlock(c); },
    schema: (c) => findingSection(c, "schema", (f) => f.testId.startsWith("schema.")),
    perf: secPerf,
    a11y: (c) => findingSection(c, "a11y", (f) => f.category === "accessibility", "Automated checks detect a subset of WCAG 2.2 AA issues. This report never claims WCAG conformance; manual testing with assistive technology is still required."),
    security: (c) => findingSection(c, "security", (f) => f.category === "security", "Checks are passive and non-destructive. This is a configuration review, not a penetration test."),
    func: (c) => findingSection(c, "func", (f) => f.category === "functionality" || f.category === "ux"),
    content: (c) => findingSection(c, "content", (f) => f.category === "content" || f.category === "seo" && f.subcategory === "content"),
    conversion: (c) => findingSection(c, "conversion", (f) => f.tags.includes("conversion") || f.testId.startsWith("biz.") || f.testId.startsWith("local.") || f.testId.startsWith("ecom.")),
    infra: (c) => findingSection(c, "infra", (f) => f.category === "infrastructure"),
    pages: secPages, evidence: secEvidence, plan: secPlan, sequence: secSequence, retest: secRetest, glossary: secGlossary, refs: secRefs, limits: secLimits, final: secFinal, comparison: secComparison,
  };

  sections.forEach((s, i) => {
    if (i === 0 || p.y > p.bottom - 75) p.addPage(); else p.gap(8);
    p.currentSection = s.title;
    sectionPages.set(s.title, p.page);
    p.heading(1, s.title, { numbered: `${i + 1}.`, section: s.title });
    builders[s.key](ctx);
  });

  // contents page
  doc.setPage(tocPage);
  let ty = PAGE.top + 24;
  sections.forEach((s, i) => {
    const pg = sectionPages.get(s.title) ?? 0;
    p.setText(PALETTE.ink, 10.5, "normal");
    const label = `${i + 1}.  ${s.title}`;
    doc.text(clean(label), PAGE.left + 2, ty);
    p.log.push({ page: tocPage, text: label });
    const dots = Math.max(0, Math.floor((CONTENT_W - 14 - doc.getTextWidth(label)) / doc.getTextWidth(".")));
    p.setText(PALETTE.rule, 10.5); doc.text(".".repeat(dots), PAGE.left + 4 + doc.getTextWidth(label), ty);
    p.setText(PALETTE.ink, 10.5, "bold"); doc.text(String(pg), PAGE.w - PAGE.right - 2, ty, { align: "right" });
    doc.link(PAGE.left, ty - 4.5, CONTENT_W, 6.5, { pageNumber: pg });
    ty += 8.2;
  });

  // running header/footer on every page except the cover
  const total = p.pages;
  for (let n = 2; n <= total; n++) {
    doc.setPage(n);
    doc.setDrawColor(...PALETTE.rule); doc.setLineWidth(0.2);
    doc.line(PAGE.left, 14, PAGE.w - PAGE.right, 14);
    p.setText(PALETTE.gold, 7.5, "bold"); doc.text(clean(brand.toUpperCase()), PAGE.left, 11);
    p.setText(PALETTE.muted, 7.5); doc.text(clean(`${REPORT_TYPE_LABELS[type]}  |  ${audit.hostname}`), PAGE.w - PAGE.right, 11, { align: "right" });
    doc.line(PAGE.left, PAGE.h - 14, PAGE.w - PAGE.right, PAGE.h - 14);
    p.setText(PALETTE.muted, 7);
    doc.text(clean(`${reportId}  |  v${REPORT_VERSION}  |  Scoring ${scores.version}  |  Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`), PAGE.left, PAGE.h - 9.5);
    doc.text(`Page ${n} of ${total}`, PAGE.w - PAGE.right, PAGE.h - 9.5, { align: "right" });
    p.setText(PALETTE.muted, 6.5); doc.text(clean(confidentiality), PAGE.left, PAGE.h - 6);
    p.pageHasContent.add(n);
  }
  doc.setPage(1);

  const raw = doc.output("arraybuffer");
  const bytes = new Uint8Array(raw);
  const fileName = type === "full" ? reportFileName(audit.hostname, now) : reportFileName(audit.hostname, now).replace(/\.pdf$/, `-${type}.pdf`);
  const checks = validate(bytes, p, sections, sectionPages, total, reportId, audit.id);
  if (!checks.every((c) => c.ok)) throw new ReportValidationError(checks);
  const sha256 = await sha256Hex(bytes);
  return { bytes, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName, pages: total, sizeBytes: bytes.byteLength, sha256, reportId, type, sections: sections.map((s) => s.title), validation: { ok: true, checks } };
}

// ---------------------------------------------------------------------------------------------------------------------

interface Ctx {
  p: Pdf; bundle: AuditBundle; scope: (f: FindingView) => boolean; findings: FindingView[]; now: Date; reportId: string; brand: string; confidentiality: string; type: ReportType;
}

function validate(bytes: Uint8Array, p: Pdf, sections: SectionDef[], sectionPages: Map<string, number>, total: number, reportId: string, auditId: string): ValidationCheck[] {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  const tail = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, bytes.length - 32)));
  const out: ValidationCheck[] = [];
  out.push({ name: "PDF generated", ok: head === "%PDF-" && tail.includes("%%EOF"), detail: `header ${JSON.stringify(head)}, trailer ${tail.includes("%%EOF") ? "present" : "missing"}` });
  out.push({ name: "File not empty", ok: bytes.byteLength >= 4000, detail: `${bytes.byteLength} bytes` });
  out.push({ name: "Page count", ok: total >= 3 + Math.min(2, sections.length), detail: `${total} pages` });
  const missing = sections.filter((s) => !(p.log.some((l) => l.text.includes(s.title) && l.page === sectionPages.get(s.title))));
  out.push({ name: "Expected sections present", ok: missing.length === 0, detail: missing.length ? `missing: ${missing.map((m) => m.title).join(", ")}` : `${sections.length} sections` });
  const toc = p.log.filter((l) => l.page === 2 && /^\d+\.\s{2}/.test(l.text)).length;
  out.push({ name: "Table of contents complete", ok: toc === sections.length, detail: `${toc}/${sections.length} entries` });
  const blank: number[] = [];
  for (let n = 1; n <= total; n++) if (!p.pageHasContent.has(n)) blank.push(n);
  out.push({ name: "No blank pages", ok: blank.length === 0, detail: blank.length ? `blank: ${blank.join(", ")}` : "every page has content" });
  const lowPages: number[] = [];
  for (let n = 3; n <= total; n++) if (p.log.filter((l) => l.page === n).length < 2) lowPages.push(n);
  out.push({ name: "No near-empty pages", ok: lowPages.length === 0, detail: lowPages.length ? `near-empty: ${lowPages.join(", ")}` : "ok" });
  out.push({ name: "Report matches audit", ok: p.log.some((l) => l.text.includes(reportId)) && reportId.includes(auditId.slice(0, 8).toUpperCase()), detail: reportId });
  const bad = p.log.filter((l) => /\bundefined\b|\bNaN\b|\[object Object\]/.test(l.text));
  out.push({ name: "No missing-data placeholders", ok: bad.length === 0, detail: bad.length ? `found "${bad[0].text.slice(0, 40)}" on page ${bad[0].page}` : "none" });
  return out;
}

// ------------------------------------------------------------------------------------------------------------------ cover

function drawCover(c: Ctx): void {
  const { p, bundle, brand, reportId, confidentiality, now, type } = c;
  const { audit } = bundle;
  const s = audit.scores!;
  const d = p.doc;
  p.currentSection = "Cover";
  d.setFillColor(...PALETTE.ink); d.rect(0, 0, PAGE.w, 118, "F");
  d.setFillColor(...PALETTE.gold); d.rect(0, 118, PAGE.w, 2.2, "F");
  d.setFillColor(...PALETTE.gold); d.roundedRect(PAGE.left, 20, 13, 13, 2.5, 2.5, "F");
  p.setText(PALETTE.ink, 11, "bold"); d.text("CN", PAGE.left + 6.5, 28.4, { align: "center" });
  p.setText(PALETTE.white, 13, "bold"); d.text(clean(brand.toUpperCase()), PAGE.left + 17, 26.3);
  p.setText([203, 213, 225], 8); d.text("Website Intelligence Engine", PAGE.left + 17, 31);
  p.setText(PALETTE.gold, 9, "bold"); d.text(clean(REPORT_TYPE_LABELS[type].toUpperCase()), PAGE.left, 56);
  p.setText(PALETTE.white, 25, "bold");
  const nameLines = p.wrap(c.bundle.audit.config.name || audit.hostname, CONTENT_W - 4).slice(0, 2);
  nameLines.forEach((l, i) => d.text(l, PAGE.left, 68 + i * 11));
  p.log.push({ page: 1, text: nameLines.join(" ") });
  p.setText([203, 213, 225], 10, "normal", "courier");
  const urlLines = p.wrap(audit.url, CONTENT_W - 4).slice(0, 2);
  urlLines.forEach((l, i) => { d.textWithLink(l, PAGE.left, 90 + i * 5, { url: audit.url }); p.log.push({ page: 1, text: l }); });
  p.setText([148, 163, 184], 8.5); d.text(clean(`${WEBSITE_TYPE_LABELS[audit.websiteType]}  |  ${audit.profile} profile`), PAGE.left, 106);

  // score block
  p.gauge(52, 168, 28, s.overall, s.provisional ? "Overall score (provisional)" : "Overall score");
  p.setText(PALETTE.ink, 12, "bold"); d.text(clean(s.band ?? "Band not available"), 100, 148);
  p.setText(PALETTE.body, 9.5); d.text(clean(`Readiness: ${s.readiness.label}`), 100, 155);
  p.log.push({ page: 1, text: s.readiness.label });
  p.setText(PALETTE.muted, 8.5);
  const note = s.provisional ? `Provisional: only ${pct(s.coverage)} of applicable tests produced a result.` : `Coverage: ${pct(s.coverage)} of applicable tests produced a result.`;
  p.wrap(note, 92).forEach((l, i) => d.text(l, 100, 162 + i * 4.5));

  const rows: [string, string][] = [
    ["Audit date", fmtDate(audit.completedAt ?? audit.createdAt)],
    ["Report ID", reportId],
    ["Report version", `${REPORT_VERSION} (scoring ${s.version})`],
    ["Assessment scope", `${audit.progress.inspected} page(s) inspected, depth ${audit.config.maxDepth}, ${audit.config.devices.join(" + ")}`],
    ["Generated", `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["Screenshot", "Not included (no screenshots captured for this audit)"],
  ];
  let y = 206;
  rows.forEach(([k, v]) => {
    p.setText(PALETTE.muted, 8.5, "bold"); d.text(k.toUpperCase(), PAGE.left, y);
    p.setText(PALETTE.ink, 9.5); const vl = p.wrap(v, 120)[0]; d.text(vl, PAGE.left + 42, y);
    p.log.push({ page: 1, text: `${k} ${v}` });
    y += 8;
  });
  d.setDrawColor(...PALETTE.rule); d.setLineWidth(0.2); d.line(PAGE.left, 262, PAGE.w - PAGE.right, 262);
  p.setText(PALETTE.muted, 8); d.text(clean(confidentiality), PAGE.left, 269);
  p.setText(PALETTE.muted, 7.5);
  p.wrap("Automated, non-destructive assessment. Scores summarise tested evidence only and are not a certification of accessibility conformance, legal compliance or security.", CONTENT_W).forEach((l, i) => d.text(l, PAGE.left, 275 + i * 4));
  p.pageHasContent.add(1);
}

// ---------------------------------------------------------------------------------------------------------------------

function secExec(c: Ctx): void {
  const { p, bundle, findings, type } = c;
  const s = bundle.audit.scores!;
  const y0 = p.y;
  p.gauge(PAGE.left + 30, y0 + 28, 24, s.overall, s.provisional ? "Overall (provisional)" : "Overall score");
  p.setText(PALETTE.ink, 11, "bold"); p.doc.text(clean(s.band ?? "No band"), PAGE.left + 66, y0 + 12);
  p.setText(PALETTE.body, 9); p.doc.text(clean(`Readiness: ${s.readiness.label}`), PAGE.left + 66, y0 + 18);
  const crit = findings.filter((f) => f.severity === "critical" && f.kind === "defect").length;
  const high = findings.filter((f) => f.severity === "high" && f.kind === "defect").length;
  p.doc.text(`${crit} critical and ${high} high-severity finding(s)`, PAGE.left + 66, y0 + 24);
  p.doc.text(`Coverage ${pct(s.coverage)}; ${bundle.audit.progress.inspected} page(s) inspected`, PAGE.left + 66, y0 + 30);
  p.log.push({ page: p.page, text: `${crit} critical and ${high} high` });
  p.y = y0 + 40;

  if (type === "executive" || type === "full" || type === "technical" || type === "roadmap" || type === "comparison") {
    p.heading(3, "Category scores");
    const rows = s.categories.map((cs) => ({ label: CATEGORY_SHORT_LABELS[cs.category], value: cs.score }));
    p.bars({ x: PAGE.left, y: p.y, w: CONTENT_W, h: rows.length * 7 }, rows, { rowH: 7 });
    p.y += rows.length * 7 + 4;
  }
  const top = findings.filter((f) => f.kind === "defect" && (f.severity === "critical" || f.severity === "high")).slice(0, 8);
  p.heading(3, "Critical and high-priority findings");
  if (!top.length) p.paragraph("No critical or high-severity defects were confirmed by the tests that produced a result in this scope.", { color: PALETTE.good });
  else p.table({ head: ["Severity", "Finding", "Affected", "Effort"], body: top.map((f) => [f.severity.toUpperCase(), f.title, `${f.affectedCount} of ${f.applicableCount || f.affectedCount}`, f.effort]), widths: [22, 112, 28, 20], cellColor: (col, row) => (col === 0 ? SEVERITY_RGB[String(row[0]).toLowerCase()] ?? null : null) });

  p.heading(3, "Main strengths");
  const strong = s.categories.filter((cs) => cs.score != null && cs.score >= 85 && cs.coverage >= 0.5);
  if (strong.length) p.bullets(strong.map((cs) => `${CATEGORY_LABELS[cs.category]}: ${Math.round(cs.score ?? 0)}/100 (${cs.passedTests} of ${cs.completedTests} completed tests passed, ${pct(cs.coverage)} coverage)`));
  else p.paragraph("No category reached 85/100 with at least 50% test coverage, so no category is presented as a strength.", { color: PALETTE.muted });

  p.heading(3, "Major risks");
  const risks = [...s.readiness.reasons, ...top.slice(0, 3).map((f) => `${f.title} (${f.severity})`)];
  p.bullets(risks.length ? risks.slice(0, 6) : ["No readiness-gating risks were identified in the tested scope."]);

  p.heading(3, "Audit coverage");
  p.paragraph(coverageSentence(bundle));

  p.heading(3, "Recommended next actions");
  const recs = bundle.recommendations.filter((r) => findings.some((f) => f.fingerprint === r.fingerprint)).slice(0, 5);
  if (recs.length) p.bullets(recs.map((r) => `${r.title} - ${HORIZON_LABELS[r.horizon].split(" (")[0]}, effort ${r.effort} (~${r.effortHours[0]}-${r.effortHours[1]} h)`));
  else p.paragraph("There are no open recommendations for this scope.", { color: PALETTE.muted });

  p.heading(3, "Important limitations");
  p.bullets(limitationLines(bundle).slice(0, 5));
}

function coverageSentence(b: AuditBundle): string {
  const cov = b.audit.coverage;
  if (!cov) return "Coverage statistics were not recorded for this audit.";
  const limit = cov.limitHit ? ` The crawl stopped at the ${cov.limitHit} limit, so pages beyond it were not inspected.` : "";
  return `${cov.inspected} page(s) were inspected of ${cov.discovered} discovered (${cov.failed} failed to load, ${cov.skippedRobots} excluded by robots.txt, ${cov.skippedScope} out of scope, ${cov.skippedLimit} skipped by limits). Depth reached: ${cov.depthReached} of ${cov.maxDepth}. ${cov.sitemapUrls} URL(s) were listed in sitemaps.${limit}`;
}

function limitationLines(b: AuditBundle): string[] {
  const out: string[] = [];
  const s = b.audit.scores!;
  const env = b.audit.environment;
  if (s.provisional) out.push(`The score is provisional: only ${pct(s.coverage)} of applicable tests produced a result.`);
  const un = s.counts.not_tested + s.counts.blocked + s.counts.inconclusive;
  if (un) out.push(`${un} test(s) were blocked, inconclusive or not tested. They are excluded from the score and are never counted as passes.`);
  if (env?.browserWorker !== "connected") out.push("No isolated browser worker was connected, so rendered-page checks (JavaScript-dependent content, visual layout, keyboard focus order) were not performed.");
  if (env?.pageSpeed !== "available") out.push("PageSpeed Insights was not available, so Lighthouse lab data and Chrome UX Report field data are not part of this report.");
  if (b.audit.coverage?.limitHit) out.push(`Crawl limit reached (${b.audit.coverage.limitHit}); the page sample may not represent the whole site.`);
  out.push("Automated checks cannot establish WCAG conformance, legal compliance, or the absence of security vulnerabilities.");
  return out;
}

function secMethod(c: Ctx): void {
  const { p, bundle } = c;
  const s = bundle.audit.scores!;
  p.paragraph("The Website Intelligence Engine requests public pages from the audit server, parses the responses, runs a versioned catalogue of tests and records every result with its evidence, provenance and confidence. Scores are computed from those recorded results only.");
  p.heading(2, "Result statuses");
  p.table({ head: ["Status", "Meaning", "Effect on score"], widths: [32, 100, 50], fontSize: 8, body: [
    ["Passed", "The test ran and the expectation was met.", "Counts as a pass."],
    ["Failed", "The test ran and the expectation was not met.", "Counts against the score by severity."],
    ["Warning", "Partly met, or met with a caveat.", "Half credit; reported one severity lower."],
    ["Informational", "Context that is neither good nor bad.", "Not scored."],
    ["Not applicable", "The test does not apply to this site or page.", "Removed from the denominator."],
    ["Not tested", "The test could not be run in this audit.", "Not scored, never a pass; lowers coverage."],
    ["Blocked", "Access was denied or prevented (robots, firewall, auth).", "Not scored, never a pass; lowers coverage."],
    ["Inconclusive", "The result could not be determined reliably.", "Not scored, never a pass; lowers coverage."],
  ] });
  p.heading(2, "Provenance and confidence");
  p.bullets([
    "Measured: a value the engine measured itself (timings, sizes, status codes).",
    "Observed: read from the live site (headers, markup, text).",
    "Inferred: a heuristic conclusion; always carries medium or low confidence.",
    "User supplied: taken from the audit form or an authorised owner integration.",
    "Unavailable: the data could not be obtained; no result is implied.",
  ]);
  p.heading(2, "Score formula and weights");
  p.paragraph(SCORE_FORMULA);
  p.table({ head: ["Category", "Weight", "Tests defined"], widths: [110, 30, 42], body: CATEGORY_IDS.map((id) => [CATEGORY_LABELS[id], `${s.weights[id]}%`, String(s.categories.find((x) => x.category === id)?.applicableTests ?? 0)]) });
  p.heading(2, "Priority formula");
  p.paragraph(PRIORITY_FORMULA);
  p.paragraph(`Engine ${bundle.audit.environment?.engineVersion ?? "n/a"}, scoring version ${s.version}, schema version ${bundle.audit.environment?.schemaVersion ?? "n/a"}.`, { size: 8.5, color: PALETTE.muted });
}

function secScope(c: Ctx): void {
  const { p, bundle } = c;
  const a = bundle.audit;
  const cfg = a.config;
  p.table({ head: ["Setting", "Value"], widths: [48, 134], body: [
    ["Website", `${cfg.name ?? a.hostname} (${a.url})`],
    ["Website type", WEBSITE_TYPE_LABELS[cfg.websiteType]],
    ["Objective", cfg.objective || "Not specified"],
    ["Market / audience / language", [cfg.market, cfg.audience, cfg.language].filter(Boolean).join(" / ") || "Not specified"],
    ["Profile", `${a.profile} (up to ${cfg.maxPages} pages, depth ${cfg.maxDepth}, concurrency ${cfg.concurrency})`],
    ["Devices", cfg.devices.join(", ")],
    ["Modules enabled", Object.entries(cfg.modules).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"],
    ["Important pages", cfg.importantPages.length ? cfg.importantPages.join(", ") : "None specified"],
    ["Outbound link checks", cfg.externalLinkCheck ? "Enabled (HEAD requests, capped)" : "Disabled"],
    ["Authorization", cfg.authorization.confirmed ? `Confirmed by ${cfg.authorization.confirmedBy || "the requester"} on ${fmtDate(cfg.authorization.confirmedAt)}` : "Not confirmed"],
    ["Authenticated scope", cfg.authenticated.enabled ? `Enabled for ${cfg.authenticated.allowedPathPrefixes.join(", ") || "no paths"}; credentials were held in memory only and never stored` : "Not used (public pages only)"],
  ] });
  p.heading(2, "Coverage");
  p.paragraph(coverageSentence(bundle));
  p.heading(2, "Safety boundaries");
  p.bullets([
    "Only the authorised hostname (and its www/apex twin) was crawled; private, loopback, link-local and cloud-metadata addresses are always refused, including after redirects and DNS changes.",
    "robots.txt was respected; request rates, timeouts, size and duration budgets were applied.",
    "No public forms were submitted and no destructive or exploit payloads were sent.",
    "Credentials, if any, were kept in memory for the duration of the audit and are not stored in the report or database.",
  ]);
  p.heading(2, "Environment");
  const env = a.environment;
  p.table({ head: ["Item", "State"], widths: [60, 122], body: [
    ["Engine / scoring version", `${env?.engineVersion ?? "n/a"} / ${env?.scoringVersion ?? "n/a"}`],
    ["User agent", env?.userAgent ?? "n/a"],
    ["Browser worker", env?.browserWorker === "connected" ? "Connected" : env?.browserWorker === "unreachable" ? "Configured but unreachable" : "Not configured"],
    ["PageSpeed Insights", env?.pageSpeed === "available" ? "Available" : env?.pageSpeed === "unreachable" ? "Configured but unreachable" : "Not configured"],
    ["Started", env?.startedAt ? env.startedAt.replace("T", " ").slice(0, 19) + " UTC" : "n/a"],
  ] });
}

function secOverall(c: Ctx): void {
  const { p, bundle } = c;
  const s = bundle.audit.scores!;
  const y0 = p.y;
  p.gauge(PAGE.left + 32, y0 + 32, 28, s.overall, s.provisional ? "Provisional score" : "Overall score");
  p.setText(PALETTE.ink, 13, "bold"); p.doc.text(clean(s.band ?? "No band available"), PAGE.left + 72, y0 + 14);
  p.setText(scoreRgb(s.overall), 10, "bold"); p.doc.text(clean(`Readiness: ${s.readiness.label}`), PAGE.left + 72, y0 + 21);
  p.setText(PALETTE.body, 9); p.doc.text(`Coverage ${pct(s.coverage)}`, PAGE.left + 72, y0 + 27);
  p.log.push({ page: p.page, text: `${s.band} ${s.readiness.label}` });
  p.y = y0 + 42;
  if (s.provisional) p.callout("Provisional score", "Less than the required share of applicable tests produced a result, so this score is shown as provisional. Tests that were blocked, inconclusive or not tested are not counted as passes.", PALETTE.warn, [254, 243, 199]);
  p.heading(2, "Readiness reasoning");
  p.bullets(s.readiness.reasons.length ? s.readiness.reasons : ["No readiness gates were triggered by tested results."]);
  if (s.readiness.gatingFindings.length) {
    p.heading(3, "Gating findings");
    p.bullets(s.readiness.gatingFindings);
  }
  p.heading(2, "Score bands");
  p.table({ head: ["Score", "Band"], widths: [30, 152], body: [["95-100", "Exceptional"], ["90-94", "Excellent"], ["80-89", "Very good"], ["70-79", "Good, with improvements needed"], ["50-69", "Needs substantial improvement"], ["0-49", "Major remediation required"]] });
  p.heading(2, "Test outcomes");
  p.stacked(PAGE.left, p.y, CONTENT_W, 7, [
    { label: "Passed", value: s.counts.passed, color: PALETTE.good }, { label: "Warning", value: s.counts.warning, color: [217, 119, 6] }, { label: "Failed", value: s.counts.failed, color: PALETTE.bad },
    { label: "Info", value: s.counts.informational, color: PALETTE.info }, { label: "Not tested", value: s.counts.not_tested, color: [148, 163, 184] }, { label: "Blocked", value: s.counts.blocked, color: [100, 116, 139] },
    { label: "Inconclusive", value: s.counts.inconclusive, color: [203, 213, 225] }, { label: "N/A", value: s.counts.not_applicable, color: [226, 232, 240] },
  ]);
  p.gap(6);
  p.heading(2, "Severity distribution");
  const sev = (["critical", "high", "medium", "low", "info"] as Severity[]).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: s.severityCounts[k], color: SEVERITY_RGB[k] }));
  p.bars({ x: PAGE.left, y: p.y, w: CONTENT_W, h: 5 * 7 }, sev, { max: Math.max(1, ...sev.map((x) => x.value)), rowH: 7, labelW: 30 });
  p.y += 5 * 7 + 4;
}

function secCategories(c: Ctx): void {
  const { p, bundle } = c;
  const s = bundle.audit.scores!;
  p.paragraph("Radar of category scores (0-100). A category with no scoreable result is not plotted and is labelled n/a.");
  p.ensure(80);
  p.radar(PAGE.w / 2, p.y + 36, 30, s.categories.map((cs) => ({ label: CATEGORY_SHORT_LABELS[cs.category], value: cs.score })));
  p.y += 78;
  p.heading(2, "Scores by category");
  p.bars({ x: PAGE.left, y: p.y, w: CONTENT_W, h: s.categories.length * 7 }, s.categories.map((cs) => ({ label: CATEGORY_LABELS[cs.category], value: cs.score })), { rowH: 7, labelW: 66 });
  p.y += s.categories.length * 7 + 4;
  p.table({ head: ["Category", "Score", "Weight", "Applicable", "Done", "Pass", "Warn", "Fail", "Unavail.", "Coverage"], fontSize: 7.5, widths: [50, 15, 15, 20, 14, 14, 14, 14, 18, 20],
    body: s.categories.map((cs) => [CATEGORY_SHORT_LABELS[cs.category], cs.score == null ? "n/a" : Math.round(cs.score), `${cs.weight}%`, cs.applicableTests, cs.completedTests, cs.passedTests, cs.warningTests, cs.failedTests, cs.unavailableTests, `${pct(cs.coverage)}${cs.provisional ? "*" : ""}`]),
    cellColor: (col, row) => (col === 1 && typeof row[1] === "number" ? scoreRgb(row[1] as number) : null) });
  p.paragraph("* provisional category: coverage below the required share of applicable tests.", { size: 8, color: PALETTE.muted });
  p.heading(2, "Additional scores");
  p.table({ head: ["Score", "Value", "Applicable tests", "Completed", "Coverage"], widths: [68, 22, 34, 26, 32], body: s.additional.map((a) => [a.label, a.score == null ? "n/a" : Math.round(a.score), a.applicableTests, a.completedTests, pct(a.coverage)]),
    cellColor: (col, row) => (col === 1 && typeof row[1] === "number" ? scoreRgb(row[1] as number) : null) });
}

/** Generic findings section. */
function findingSection(c: Ctx, key: SectionKey, pick: (f: FindingView) => boolean, caution?: string): void {
  const { p } = c;
  const list = c.findings.filter(pick);
  if (caution) p.callout("Interpretation", caution);
  if (!list.length) {
    p.paragraph(`No findings were recorded for this area. This means every applicable test that produced a result passed, or that no test in this area produced a result - see the category coverage in the score analysis. It is not evidence that the area is flawless.`, { color: PALETTE.muted });
    return;
  }
  const d = defects(list);
  const lim = list.filter((f) => f.kind === "limitation");
  const obs = list.filter((f) => f.kind === "observation");
  p.paragraph(`${d.length} defect(s), ${obs.length} observation(s) and ${lim.length} testing limitation(s) in ${SECTION_TITLES[key].toLowerCase()}.`, { color: PALETTE.muted });
  p.stacked(PAGE.left, p.y, CONTENT_W, 5, (["critical", "high", "medium", "low", "info"] as Severity[]).map((k) => ({ label: k, value: list.filter((f) => f.severity === k).length, color: SEVERITY_RGB[k] })));
  p.gap(10);
  for (const f of list.slice(0, 40)) findingBlock(c, f);
  if (list.length > 40) p.paragraph(`${list.length - 40} lower-priority finding(s) are available in the dashboard and are not printed here.`, { size: 8.5, color: PALETTE.muted });
}

function findingBlock(c: Ctx, f: FindingView): void {
  const { p } = c;
  const d = p.doc;
  p.ensure(34);
  const top = p.y;
  d.setFillColor(...SEVERITY_RGB[f.severity]); d.rect(PAGE.left, top, 1.6, 5.2, "F");
  p.setText(PALETTE.ink, 10, "bold");
  const titleLines = p.wrap(f.title, CONTENT_W - 36);
  titleLines.forEach((l, i) => { d.text(l, PAGE.left + 4, top + 3.7 + i * 4.6); p.log.push({ page: p.page, text: l }); });
  p.setText(SEVERITY_RGB[f.severity], 8, "bold"); d.text(f.severity.toUpperCase(), PAGE.w - PAGE.right, top + 3.7, { align: "right" });
  p.y = top + 4.5 + Math.max(0, titleLines.length - 1) * 4.6 + 2;
  p.pageHasContent.add(p.page);
  const meta = `${f.testId}  |  ${f.status}  |  ${f.kind}  |  confidence ${f.confidence}  |  ${f.provenance}  |  ${f.affectedCount}${f.applicableCount ? ` of ${f.applicableCount}` : ""} affected  |  workflow: ${FINDING_STATUS_LABELS[f.workflow.status]}`;
  p.paragraph(meta, { size: 7.5, color: PALETTE.muted, font: "courier", lead: 3.6, after: 1 });
  p.paragraph(f.description, { size: 9 });
  if (f.actual || f.expected) p.paragraph(`${f.actual ? `Observed: ${f.actual}` : ""}${f.actual && f.expected ? "\n" : ""}${f.expected ? `Expected: ${f.expected}` : ""}`, { size: 8.5, color: PALETTE.ink, style: "italic" });
  if (f.note) p.paragraph(`Note: ${f.note}`, { size: 8.5, color: PALETTE.warn });
  if (f.kind === "defect") {
    p.paragraph(`Why it matters: ${[f.impact.user, f.impact.search, f.impact.business, f.impact.security].filter(Boolean).join(" ")}`, { size: 8.5 });
    p.paragraph(`Fix: ${f.fix}`, { size: 8.5, color: PALETTE.ink, style: "bold", after: 1 });
    p.paragraph(f.implementation, { size: 8.5 });
    p.paragraph(`Effort ${f.effort}  |  Priority ${Math.round(f.priorityScore)}  |  ${HORIZON_LABELS[f.horizon].split(" (")[0]}`, { size: 8, color: PALETTE.muted, after: 1 });
  }
  if (f.affectedUrls.length) { p.paragraph("Affected URLs", { size: 8, color: PALETTE.muted, style: "bold", after: 0.5 }); p.urlList(f.affectedUrls, 5); }
  p.gap(1);
  p.rule();
}

function coverageBlock(c: Ctx): void {
  const { p, bundle } = c;
  const cov = bundle.audit.coverage;
  p.heading(2, "Audit coverage");
  if (!cov) { p.paragraph("Coverage statistics were not recorded for this audit.", { color: PALETTE.muted }); return; }
  p.stacked(PAGE.left, p.y, CONTENT_W, 7, [
    { label: "Inspected", value: cov.inspected, color: PALETTE.good }, { label: "Failed", value: cov.failed, color: PALETTE.bad }, { label: "Robots", value: cov.skippedRobots, color: PALETTE.warn },
    { label: "Out of scope", value: cov.skippedScope, color: [148, 163, 184] }, { label: "Limit", value: cov.skippedLimit, color: [100, 116, 139] },
  ]);
  p.gap(8);
  p.paragraph(coverageSentence(bundle));
  if (cov.skipped.length) p.table({ head: ["Skipped URL", "Reason"], widths: [118, 64], fontSize: 7.5, body: cov.skipped.slice(0, 30).map((s) => [s.url, s.reason]) });
}

function secPerf(c: Ctx): void {
  const { p, bundle } = c;
  const perf = bundle.performance;
  p.heading(2, "Core Web Vitals and speed measurements");
  p.callout("Lab and field data are different", "Lab data is a single synthetic run under fixed conditions. Field data is real-user data from the Chrome UX Report and only exists for sites with enough traffic. They are shown separately and never averaged.");
  const THRESH: Record<string, [number, number, string]> = { lcpMs: [2500, 4000, "LCP"], inpMs: [200, 500, "INP"], cls: [0.1, 0.25, "CLS"], fcpMs: [1800, 3000, "FCP"], tbtMs: [200, 600, "TBT"], ttfbMs: [800, 1800, "TTFB"] };
  const cwv = (label: string, value: number | undefined, key: string) => {
    if (value == null) return;
    const [good, poor, name] = THRESH[key];
    const w = 120, x = PAGE.left + 40, max = poor * 1.5;
    p.ensure(9);
    const y = p.y;
    p.setText(PALETTE.ink, 8, "bold"); p.doc.text(`${label} ${name}`, PAGE.left, y + 4.2);
    p.doc.setFillColor(...PALETTE.good); p.doc.rect(x, y + 1, (good / max) * w, 4, "F");
    p.doc.setFillColor(217, 119, 6); p.doc.rect(x + (good / max) * w, y + 1, ((poor - good) / max) * w, 4, "F");
    p.doc.setFillColor(...PALETTE.bad); p.doc.rect(x + (poor / max) * w, y + 1, w - (poor / max) * w, 4, "F");
    const mx = x + Math.min(1, value / max) * w;
    p.doc.setFillColor(...PALETTE.ink); p.doc.triangle(mx - 1.4, y, mx + 1.4, y, mx, y + 2.2, "F"); p.doc.rect(mx - 0.25, y + 1, 0.5, 4, "F");
    const txt = key === "cls" ? value.toFixed(3) : fmtMs(value);
    p.setText(PALETTE.ink, 8, "bold"); p.doc.text(txt, x + w + 3, y + 4.2);
    p.log.push({ page: p.page, text: `${label} ${name} ${txt}` });
    p.pageHasContent.add(p.page);
    p.y += 8;
  };
  if (!perf.length) p.paragraph("No performance samples were recorded for this audit.", { color: PALETTE.muted });
  for (const s of perf) {
    p.heading(3, `${s.device === "mobile" ? "Mobile" : "Desktop"} - ${s.source === "pagespeed" ? "PageSpeed Insights" : "HTTP timing"}`);
    p.urlList([s.url], 1, PAGE.left);
    if (!s.available) { p.paragraph(`Not available: ${s.reason ?? "no reason recorded"}`, { color: PALETTE.warn }); continue; }
    if (s.lab) {
      p.paragraph(`Lab data${s.lab.performanceScore != null ? ` (Lighthouse performance score ${Math.round(s.lab.performanceScore)})` : ""}:`, { size: 8.5, style: "bold", color: PALETTE.ink, after: 1 });
      cwv("Lab", s.lab.lcpMs, "lcpMs"); cwv("Lab", s.lab.fcpMs, "fcpMs"); cwv("Lab", s.lab.tbtMs, "tbtMs"); cwv("Lab", s.lab.cls, "cls"); cwv("Lab", s.lab.ttfbMs, "ttfbMs");
    }
    if (s.field) {
      p.paragraph(`Field data (Chrome UX Report, ${s.field.origin ? "origin-level" : "URL-level"}${s.field.category ? `, ${s.field.category}` : ""}):`, { size: 8.5, style: "bold", color: PALETTE.ink, after: 1 });
      cwv("Field", s.field.lcpMs, "lcpMs"); cwv("Field", s.field.inpMs, "inpMs"); cwv("Field", s.field.cls, "cls"); cwv("Field", s.field.fcpMs, "fcpMs"); cwv("Field", s.field.ttfbMs, "ttfbMs");
    } else p.paragraph("Field data: not available for this URL (insufficient real-user data or integration not configured).", { size: 8.5, color: PALETTE.muted });
    p.gap(2);
  }
  const fast = bundle.pages.filter((x) => x.facts.ttfbMs != null);
  if (fast.length) {
    p.heading(2, "Server response time by page (slowest first)");
    const rows = [...fast].sort((a, b) => (b.facts.ttfbMs ?? 0) - (a.facts.ttfbMs ?? 0)).slice(0, 12).map((x) => ({ label: shortUrl(x.facts.url), value: x.facts.ttfbMs as number, suffix: " ms", color: (x.facts.ttfbMs as number) > 1800 ? PALETTE.bad : (x.facts.ttfbMs as number) > 800 ? PALETTE.warn : PALETTE.good }));
    p.ensure(rows.length * 6.5 + 4);
    p.bars({ x: PAGE.left, y: p.y, w: CONTENT_W, h: rows.length * 6.5 }, rows, { max: Math.max(...rows.map((r) => r.value), 1), rowH: 6.5, labelW: 70 });
    p.y += rows.length * 6.5 + 4;
  }
  findingSection(c, "perf", (f) => f.category === "performance");
}

function shortUrl(u: string): string {
  try { const x = new URL(u); const s = `${x.pathname}${x.search}` || "/"; return s.length > 38 ? `${s.slice(0, 35)}...` : s; } catch { return u.slice(0, 38); }
}

function secPages(c: Ctx): void {
  const { p, bundle } = c;
  const pages = bundle.pages;
  if (!pages.length) { p.paragraph("No pages were inspected.", { color: PALETTE.muted }); return; }
  const scored = pages.filter((x) => x.score != null);
  if (scored.length) {
    p.heading(2, "Page-level score comparison (lowest first)");
    const rows = [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 15).map((x) => ({ label: shortUrl(x.facts.url), value: x.score }));
    p.ensure(rows.length * 6.5 + 4);
    p.bars({ x: PAGE.left, y: p.y, w: CONTENT_W, h: rows.length * 6.5 }, rows, { rowH: 6.5, labelW: 70 });
    p.y += rows.length * 6.5 + 4;
  }
  p.heading(2, "Inspected pages");
  const failedByUrl = new Map<string, number>();
  for (const f of c.findings.filter((x) => x.kind === "defect")) for (const u of f.affectedUrls) failedByUrl.set(u, (failedByUrl.get(u) ?? 0) + 1);
  p.table({ head: ["URL", "HTTP", "Title", "Words", "Issues", "Score"], widths: [70, 14, 38, 16, 16, 18], fontSize: 7.2,
    body: pages.slice(0, 250).map((x) => [x.facts.url, x.facts.status ?? "-", x.facts.title ? `${x.facts.titleLength} ch` : "missing", x.facts.wordCount, failedByUrl.get(x.facts.url) ?? 0, x.score == null ? "n/a" : Math.round(x.score)]),
    cellColor: (col, row) => (col === 5 && typeof row[5] === "number" ? scoreRgb(row[5] as number) : null) });
  if (pages.length > 250) p.paragraph(`${pages.length - 250} additional page(s) are listed in the dashboard.`, { size: 8.5, color: PALETTE.muted });
}

function secEvidence(c: Ctx): void {
  const { p, bundle } = c;
  const top = c.findings.filter((f) => f.kind === "defect" && f.evidence.length).slice(0, 14);
  p.callout("Screenshots", bundle.audit.environment?.browserWorker === "connected" ? "A browser worker was connected, but screenshots are not embedded in this report version. Evidence below is textual and reproducible." : "No browser worker was connected, so no screenshots were captured. Evidence below is textual (headers, markup fragments, measurements) and reproducible.");
  if (!top.length) { p.paragraph("No defect findings carry recorded evidence in this scope.", { color: PALETTE.muted }); return; }
  for (const f of top) {
    p.heading(3, `${f.title} (${f.testId})`);
    for (const e of f.evidence.slice(0, 4)) {
      p.paragraph(`${e.label} [${e.kind}]`, { size: 8, style: "bold", color: PALETTE.ink, after: 0.5 });
      p.paragraph(e.value.length > 700 ? `${e.value.slice(0, 700)} ...[truncated]` : e.value, { size: 7.5, font: "courier", color: PALETTE.body, after: 1.5 });
    }
    p.paragraph(`Observed ${f.observedAt.slice(0, 19).replace("T", " ")} UTC, provenance ${f.provenance}, confidence ${f.confidence}. Method: ${f.measurementMethod}`, { size: 7.5, color: PALETTE.muted });
  }
}

function secPlan(c: Ctx): void {
  const { p, bundle } = c;
  const inScope = new Set(c.findings.map((f) => f.fingerprint));
  const recs = bundle.recommendations.filter((r) => inScope.has(r.fingerprint));
  if (!recs.length) { p.paragraph("There are no recommendations for this scope.", { color: PALETTE.muted }); return; }
  p.paragraph(`Priority is calculated transparently: ${PRIORITY_FORMULA} No financial return is estimated.`, { size: 8.5, color: PALETTE.muted });
  p.heading(2, "Priority ranking");
  const top = recs.slice(0, 12);
  p.ensure(top.length * 6.5 + 4);
  p.bars({ x: PAGE.left, y: p.y, w: CONTENT_W, h: top.length * 6.5 }, top.map((r) => ({ label: r.title, value: r.priorityScore, color: SEVERITY_RGB[r.severity] })), { rowH: 6.5, labelW: 76 });
  p.y += top.length * 6.5 + 4;
  for (const h of ["immediate", "short", "strategic"] as const) {
    const list = recs.filter((r) => r.horizon === h);
    if (!list.length) continue;
    p.heading(2, HORIZON_LABELS[h]);
    p.table({ head: ["#", "Recommendation", "Severity", "Effort", "Priority"], widths: [10, 100, 24, 24, 24], fontSize: 8, body: list.slice(0, c.type === "executive" ? 8 : 60).map((r) => [r.rank, r.title, r.severity, `${r.effort} (${r.effortHours[0]}-${r.effortHours[1]} h)`, Math.round(r.priorityScore)]), cellColor: (col, row) => (col === 2 ? SEVERITY_RGB[String(row[2])] ?? null : null) });
    for (const r of list.slice(0, c.type === "executive" ? 0 : 15)) {
      p.heading(3, `${r.rank}. ${r.title}`);
      p.paragraph(`Problem: ${r.problem}`, { size: 8.5 });
      p.paragraph(`Correction: ${r.correction}`, { size: 8.5, style: "bold", color: PALETTE.ink });
      p.paragraph(`Implementation: ${r.implementation}`, { size: 8.5 });
      p.paragraph(`Expected outcome: ${r.expectedOutcome}`, { size: 8.5 });
      p.paragraph(`Risk of inaction: ${r.riskOfInaction}`, { size: 8.5, color: PALETTE.warn });
    }
  }
  if (bundle.roadmap.totalEffortHours[1] > 0) p.paragraph(`Total estimated effort: ${bundle.roadmap.totalEffortHours[0]}-${bundle.roadmap.totalEffortHours[1]} hours (ranges are planning estimates, not commitments).`, { size: 8.5, color: PALETTE.muted });
}

function secSequence(c: Ctx): void {
  const { p, bundle } = c;
  const byFp = new Map(bundle.recommendations.map((r) => [r.fingerprint, r]));
  const inScope = new Set(c.findings.map((f) => f.fingerprint));
  const seq = bundle.roadmap.sequence.filter((fp) => inScope.has(fp) && byFp.has(fp));
  if (!seq.length) { p.paragraph("There is nothing to sequence.", { color: PALETTE.muted }); return; }
  p.paragraph("Work is ordered so that prerequisites come first (for example HTTPS before redirects, crawl access before indexing fixes), then by priority score.");
  p.table({ head: ["Step", "Action", "Depends on", "Effort"], widths: [14, 100, 44, 24], body: seq.slice(0, 80).map((fp, i) => { const r = byFp.get(fp)!; return [i + 1, r.title, r.dependencies.length ? r.dependencies.join(", ") : "-", r.effort]; }) });
}

function secRetest(c: Ctx): void {
  const { p, bundle } = c;
  p.paragraph("A finding is only marked Verified after a passing retest of the affected URLs, or documented manual verification with notes. Changing a status by hand is never enough on its own.");
  p.heading(2, "Retest procedure");
  p.bullets(["Apply the fix in the live environment.", "Use Retest on the finding (or the immediate list) in the audit dashboard; the engine re-runs only the affected tests on the affected URLs.", "A passing result moves the finding to Verified; a failing result keeps it open with the new evidence.", "Re-run a full audit after a batch of fixes to refresh scores and detect regressions."]);
  const inScope = new Set(c.findings.map((f) => f.fingerprint));
  const recs = bundle.recommendations.filter((r) => inScope.has(r.fingerprint)).slice(0, 25);
  if (recs.length) { p.heading(2, "Acceptance criteria"); p.table({ head: ["Recommendation", "Verified when"], widths: [66, 116], fontSize: 7.8, body: recs.map((r) => [r.title, r.verification]) }); }
}

const GLOSSARY: [string, string][] = [
  ["Canonical URL", "The preferred address of a page that search engines should index when several URLs show the same content."],
  ["Core Web Vitals", "Google's user-experience metrics: Largest Contentful Paint (loading), Interaction to Next Paint (responsiveness) and Cumulative Layout Shift (visual stability)."],
  ["CSP", "Content-Security-Policy: a response header that restricts which sources a page may load scripts and other resources from."],
  ["Field data", "Measurements from real users (Chrome UX Report). Unlike lab data it reflects real devices and networks."],
  ["HSTS", "HTTP Strict Transport Security: tells browsers to use HTTPS only for a host."],
  ["Indexability", "Whether a page is allowed and able to appear in search results (status, robots directives, canonical)."],
  ["Lab data", "A synthetic measurement under fixed conditions (for example Lighthouse). Good for diagnosis, not a substitute for field data."],
  ["Provenance", "How a result was obtained: measured, observed, inferred, user supplied or unavailable."],
  ["robots.txt", "A public file that tells crawlers which paths they may fetch."],
  ["Structured data", "Machine-readable markup (JSON-LD, microdata) describing page content. Valid syntax does not guarantee rich-result eligibility."],
  ["WCAG 2.2 AA", "Web Content Accessibility Guidelines level AA. Automated tools can check only part of it."],
];

function secGlossary(c: Ctx): void { c.p.table({ head: ["Term", "Definition"], widths: [36, 146], body: GLOSSARY }); }

function secRefs(c: Ctx): void {
  const { p } = c;
  const seen = new Map<string, string>();
  const base: [string, string][] = [
    ["RFC 9309 - Robots Exclusion Protocol", "https://www.rfc-editor.org/rfc/rfc9309"],
    ["WCAG 2.2", "https://www.w3.org/TR/WCAG22/"],
    ["Google Search Central documentation", "https://developers.google.com/search/docs"],
    ["web.dev Core Web Vitals", "https://web.dev/articles/vitals"],
    ["OWASP Secure Headers Project", "https://owasp.org/www-project-secure-headers/"],
    ["Schema.org", "https://schema.org/"],
  ];
  base.forEach(([t, u]) => seen.set(u, t));
  for (const f of c.findings) for (const r of f.refs) if (/^https?:\/\//.test(r.url)) seen.set(r.url, r.title);
  const list = [...seen].slice(0, 60);
  p.paragraph("Official documentation used by the tests in this report. Links are clickable.");
  list.forEach(([url, t]) => {
    p.ensure(10);
    p.paragraph(t, { size: 8.5, style: "bold", color: PALETTE.ink, after: 0.2 });
    p.urlList([url], 1, PAGE.left + 2);
  });
}

function secLimits(c: Ctx): void {
  const { p, bundle } = c;
  p.bullets(limitationLines(bundle));
  const lim = bundle.findings.filter((f) => f.kind === "limitation").slice(0, 30);
  if (lim.length) {
    p.heading(2, "Tests that could not be completed");
    p.table({ head: ["Test", "Status", "Reason"], widths: [64, 24, 94], fontSize: 7.5, body: lim.map((f) => [f.title, f.status, f.note || f.description]) });
  }
  p.paragraph("This report describes the website at the time of the audit. Content, configuration and third-party services change; rerun the audit after changes. Scores are comparable across audits only when the scoring version and environment match.", { size: 8.5, color: PALETTE.muted });
}

function secFinal(c: Ctx): void {
  const { p, bundle } = c;
  const s = bundle.audit.scores!;
  p.callout(s.readiness.label, s.readiness.reasons.length ? s.readiness.reasons.join(" ") : "No readiness gates were triggered by the tests that produced a result.", scoreRgb(s.overall), PALETTE.panel);
  p.paragraph(`Based on ${bundle.audit.progress.inspected} inspected page(s) and ${s.categories.reduce((n, x) => n + x.completedTests, 0)} completed test(s) at ${pct(s.coverage)} coverage, the website scores ${s.overall == null ? "n/a" : Math.round(s.overall)}/100${s.provisional ? " (provisional)" : ""}${s.band ? ` - ${s.band}` : ""}.`);
  p.paragraph("This statement covers only what automated, non-destructive checks could observe. It is not a certification of accessibility conformance, legal or regulatory compliance, or security, and it does not replace manual review, user testing or a penetration test.");
  p.paragraph(`Prepared by ${c.brand}. Report ${c.reportId}, version ${REPORT_VERSION}.`, { size: 8.5, color: PALETTE.muted });
}

function secComparison(c: Ctx): void {
  const { p, bundle } = c;
  const cmp = bundle.comparison;
  if (!cmp) { p.paragraph("There is no earlier audit of this site to compare with.", { color: PALETTE.muted }); return; }
  if (cmp.scoringVersionMismatch) p.callout("Different scoring versions", `This audit used scoring ${cmp.scoringVersionCurrent}; the earlier audit used ${cmp.scoringVersionPrevious}. Score differences may reflect the method, not the website.`, PALETTE.warn, [254, 243, 199]);
  if (cmp.environmentNote) p.paragraph(cmp.environmentNote, { size: 8.5, color: PALETTE.muted });
  p.paragraph(`Overall score change: ${cmp.overallDelta == null ? "n/a" : `${cmp.overallDelta > 0 ? "+" : ""}${Math.round(cmp.overallDelta * 10) / 10}`} points (${bundle.previous?.overall == null ? "n/a" : Math.round(bundle.previous.overall)} -> ${bundle.audit.scores?.overall == null ? "n/a" : Math.round(bundle.audit.scores.overall)}).`, { size: 10.5, style: "bold", color: PALETTE.ink });
  p.heading(2, "Category changes");
  const rows = cmp.categoryDeltas;
  const h = rows.length * 11;
  p.ensure(h + 8);
  const d = p.doc;
  rows.forEach((r, i) => {
    const y = p.y + i * 11;
    p.setText(PALETTE.ink, 7.5, "bold"); d.text(clean(CATEGORY_SHORT_LABELS[r.category]), PAGE.left, y + 6);
    const x0 = PAGE.left + 40, w = 100;
    for (const [k, v, col] of [[0, r.previous, [148, 163, 184] as RGB], [1, r.current, scoreRgb(r.current)]] as const) {
      d.setFillColor(...PALETTE.rule); d.rect(x0, y + k * 4.2, w, 3.4, "F");
      if (v != null) { d.setFillColor(...col); d.rect(x0, y + k * 4.2, Math.max(0.5, (v / 100) * w), 3.4, "F"); }
    }
    p.setText(PALETTE.muted, 7); d.text(`before ${r.previous == null ? "n/a" : Math.round(r.previous)}`, x0 + w + 3, y + 3);
    p.setText(PALETTE.ink, 7, "bold"); d.text(`after ${r.current == null ? "n/a" : Math.round(r.current)}${r.delta == null ? "" : ` (${r.delta > 0 ? "+" : ""}${Math.round(r.delta * 10) / 10})`}`, x0 + w + 3, y + 7.2);
    p.log.push({ page: p.page, text: `${r.category} before ${r.previous} after ${r.current}` });
  });
  p.pageHasContent.add(p.page);
  p.y += h + 4;
  const list = (title: string, items: { title: string; severity: Severity }[]) => {
    p.heading(3, `${title} (${items.length})`);
    if (!items.length) p.paragraph("None.", { color: PALETTE.muted });
    else p.bullets(items.slice(0, 25).map((x) => `${x.title} [${x.severity}]`));
  };
  list("Resolved findings", cmp.resolvedFindings);
  list("New findings", cmp.newFindings);
  list("Recurring findings", cmp.recurringFindings);
  if (cmp.regressions.length) { p.heading(3, "Regressions"); p.table({ head: ["Item", "Before", "Now"], widths: [90, 46, 46], body: cmp.regressions.slice(0, 40).map((r) => [r.label, r.previous, r.current]) }); }
  if (cmp.improvements.length) { p.heading(3, "Improvements"); p.table({ head: ["Item", "Before", "Now"], widths: [90, 46, 46], body: cmp.improvements.slice(0, 40).map((r) => [r.label, r.previous, r.current]) }); }
  p.paragraph(`Pages added: ${cmp.pagesAdded.length}; pages removed: ${cmp.pagesRemoved.length}; broken links ${cmp.brokenLinks.previous} -> ${cmp.brokenLinks.current}.`, { size: 8.5 });
  if (cmp.securityHeaderChanges.length) p.table({ head: ["Security header", "Before", "Now"], widths: [60, 61, 61], fontSize: 7.5, body: cmp.securityHeaderChanges.map((h2) => [h2.header, h2.previous, h2.current]) });
}

void STAGE_LABELS;
