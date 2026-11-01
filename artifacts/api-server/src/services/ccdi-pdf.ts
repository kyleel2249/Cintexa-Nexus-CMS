/**
 * CINTEXA CCDI — Phase 15 minimal PDF builder (no external PDF library).
 * Produces a valid single-page or multi-page text PDF for report export.
 */

function escapePdfText(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw;
    while (line.length > maxChars) {
      let breakAt = line.lastIndexOf(" ", maxChars);
      if (breakAt < 20) breakAt = maxChars;
      out.push(line.slice(0, breakAt));
      line = line.slice(breakAt).trimStart();
    }
    out.push(line);
  }
  return out;
}

/**
 * Build a simple multi-page PDF from title + body lines.
 * Uses Helvetica; portrait A4-ish page size.
 */
export function buildSimplePdf(opts: {
  title: string;
  subtitle?: string;
  lines: string[];
}): Buffer {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const lineHeight = 12;
  const maxChars = 90;
  const maxLinesPerPage = Math.floor((pageHeight - margin * 2 - 40) / lineHeight);

  const headerLines = [
    opts.title,
    opts.subtitle || "",
    `Generated: ${new Date().toISOString()}`,
    "Source: CINTEXA CCDI — evidence-backed data only",
    "",
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));

  const allLines = [
    ...headerLines.flatMap((l) => wrapLines(l, maxChars)),
    ...opts.lines.flatMap((l) => wrapLines(l, maxChars)),
  ];

  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
    pages.push(allLines.slice(i, i + maxLinesPerPage));
  }
  if (!pages.length) pages.push(["(empty report)"]);

  const objects: string[] = [];
  const offsets: number[] = [];

  const addObject = (body: string) => {
    offsets.push(
      // approximate; recalculated below when serialising
      0,
    );
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // 1: Catalog
  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages (kids filled later)
  addObject("PLACEHOLDER_PAGES");

  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];

  for (const pageLines of pages) {
    let y = pageHeight - margin;
    const contentOps: string[] = ["BT", "/F1 10 Tf", `50 ${y} Td", "14 TL"];
    // Title on first content line slightly larger handled as plain text for simplicity
    for (let i = 0; i < pageLines.length; i++) {
      const t = escapePdfText(pageLines[i]!);
      if (i === 0) {
        contentOps.push(`(${t}) Tj`);
      } else {
        contentOps.push("T*");
        contentOps.push(`(${t}) Tj`);
      }
    }
    contentOps.push("ET");
    const stream = contentOps.join("\n");
    const contentNum = addObject(
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    );
    contentObjNums.push(contentNum);

    const pageNum = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    pageObjNums.push(pageNum);
  }

  // Font object 3 — inject after catalog/pages so numbering stays stable:
  // We reserved objects in order; insert font as object 3 by rebuilding.
  // Simpler approach: rewrite objects array properly.

  // Rebuild with correct structure:
  const rebuilt: string[] = [];
  rebuilt.push("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  rebuilt.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageObjNums.length} >>`); // 2
  rebuilt.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 3

  // Page and content objects were added after 2; renumbering is messy.
  // Use a cleaner single-pass builder instead.
  return buildPdfSinglePass(opts);
}

function buildPdfSinglePass(opts: {
  title: string;
  subtitle?: string;
  lines: string[];
}): Buffer {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const lineHeight = 12;
  const maxChars = 90;
  const maxLinesPerPage = Math.floor((pageHeight - margin * 2 - 24) / lineHeight);

  const allLines = [
    ...wrapLines(opts.title, maxChars),
    ...wrapLines(opts.subtitle || "CINTEXA CCDI Report", maxChars),
    ...wrapLines(`Generated: ${new Date().toISOString()}`, maxChars),
    ...wrapLines("Evidence-backed data only. No fabricated statistics.", maxChars),
    "",
    ...opts.lines.flatMap((l) => wrapLines(l, maxChars)),
  ];

  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
    pages.push(allLines.slice(i, i + maxLinesPerPage));
  }
  if (!pages.length) pages.push(["(empty report)"]);

  type Obj = { id: number; body: string };
  const objs: Obj[] = [];
  const nextId = () => objs.length + 1;

  const fontId = nextId();
  objs.push({ id: fontId, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });

  const pageIds: number[] = [];
  for (const pageLines of pages) {
    let y = pageHeight - margin;
    const ops = [`BT", `/F1 10 Tf`, `${margin} ${y} Td`, `${lineHeight} TL`];
    pageLines.forEach((line, idx) => {
      const t = escapePdfText(line);
      if (idx === 0) ops.push(`(${t}) Tj`);
      else {
        ops.push("T*");
        ops.push(`(${t}) Tj`);
      }
    });
    ops.push("ET");
    const stream = ops.join("\n");
    const contentId = nextId();
    objs.push({
      id: contentId,
      body: `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    });
    const pageId = nextId();
    // Parent filled later — use pages object id we'll set parent id after
    objs.push({
      id: pageId,
      body: `PAGE_PLACEHOLDER ${contentId}`,
    });
    pageIds.push(pageId);
  }

  const pagesId = nextId();
  const catalogId = nextId();

  // Fix page objects with parent + resources
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i]!;
    if (o.body.startsWith("PAGE_PLACEHOLDER")) {
      const contentId = Number(o.body.split(" ")[1]);
      objs[i] = {
        id: o.id,
        body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      };
    }
  }

  objs.push({
    id: pagesId,
    body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  });
  objs.push({
    id: catalogId,
    body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
  });

  // Serialise
  const sorted = [...objs].sort((a, b) => a.id - b.id);
  let pdf = "%PDF-1.4\n";
  const xref: number[] = [];
  for (const o of sorted) {
    xref[o.id] = Buffer.byteLength(pdf, "utf8");
    pdf += `${o.id} 0 obj\n${o.body}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  const maxId = sorted[sorted.length - 1]!.id;
  pdf += `xref\n0 ${maxId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= maxId; i++) {
    const off = xref[i] ?? 0;
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

export function reportToPdfLines(report: {
  title: string;
  report_type?: string;
  generated_at?: string;
  generated_by?: string;
  summary?: unknown;
  sections?: Array<{ heading?: string; body?: unknown }>;
}): { title: string; subtitle: string; lines: string[] } {
  const lines: string[] = [];
  lines.push(`Type: ${report.report_type || "report"}`);
  if (report.generated_by) lines.push(`Generated by: ${report.generated_by}`);
  lines.push("");
  lines.push("=== SUMMARY ===");
  lines.push(JSON.stringify(report.summary ?? {}, null, 2));
  const sections = Array.isArray(report.sections) ? report.sections : [];
  for (const sec of sections) {
    lines.push("");
    lines.push(`=== ${sec.heading || "Section"} ===`);
    lines.push(JSON.stringify(sec.body ?? {}, null, 2));
  }
  return {
    title: report.title || "CCDI Report",
    subtitle: "CINTEXA Advanced Cyber Defense & Security Intelligence",
    lines,
  };
}
