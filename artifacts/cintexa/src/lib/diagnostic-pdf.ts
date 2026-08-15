export type PdfSection = { title: string; paragraphs?: string[]; bullets?: string[] };

function escapePdf(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

function wrap(text: string, max = 92) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function downloadDiagnosticPdf(title: string, subtitle: string, sections: PdfSection[]) {
  const pages: string[][] = [];
  let lines: string[] = [];
  const push = (line: string) => {
    lines.push(line);
    if (lines.length >= 48) { pages.push(lines); lines = []; }
  };
  push(title);
  push(subtitle);
  push("");
  for (const section of sections) {
    push(`## ${section.title}`);
    for (const p of section.paragraphs ?? []) for (const l of wrap(p)) push(l);
    for (const b of section.bullets ?? []) for (const l of wrap(`- ${b}`)) push(l);
    push("");
  }
  if (lines.length) pages.push(lines);

  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const page of pages) {
    const commands: string[] = ["BT", "/F1 9 Tf", "12 TL", "50 760 Td"];
    page.forEach((line, index) => {
      const size = line.startsWith("## ") ? 13 : index < 2 ? 16 : 9;
      if (size !== 9) commands.push(`/F1 ${size} Tf`);
      commands.push(`(${escapePdf(line)}) Tj`);
      commands.push("0 -12 Td");
    });
    commands.push("ET");
    const stream = commands.join("\n");
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    contentIds.push(contentId); pageIds.push(pageId);
  }
  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const fixed = objects.map((obj) => obj.replaceAll("PAGES", `${pagesId} 0 R`));
  const chunks: string[] = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets: number[] = [0];
  let offset = chunks[0].length;
  fixed.forEach((obj, i) => {
    offsets[i + 1] = offset;
    const chunk = `${i + 1} 0 obj\n${obj}\nendobj\n`;
    chunks.push(chunk); offset += chunk.length;
  });
  const xref = offset;
  chunks.push(`xref\n0 ${fixed.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= fixed.length; i++) chunks.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${fixed.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const blob = new Blob(chunks, { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cintexa-diagnostic"}.pdf`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
