/**
 * Local CSV parse + import helpers. No network upload.
 */
export type CsvParseResult = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsv(text: string): CsvParseResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] != null ? cells[idx] : "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export type ImportEntity = "campaigns" | "leads";

export type MappedImportRow = Record<string, string>;

export type ImportPreview = {
  valid: MappedImportRow[];
  invalid: { row: number; reason: string; data: MappedImportRow }[];
  duplicates: { row: number; key: string; data: MappedImportRow }[];
};

const CAMPAIGN_ALIASES: Record<string, string[]> = {
  name: ["name", "campaign", "campaign_name", "title"],
  status: ["status", "state"],
  budget: ["budget", "planned_budget"],
  spent: ["spent", "actual_spend", "spend"],
  objective: ["objective", "goal"],
};

const LEAD_ALIASES: Record<string, string[]> = {
  name: ["name", "lead_name", "full_name"],
  email: ["email", "e-mail", "mail"],
  source: ["source", "channel", "utm_source"],
  score: ["score", "lead_score"],
  status: ["status", "lead_status"],
};

export function autoMapHeaders(headers: string[], entity: ImportEntity): Record<string, string> {
  const aliases = entity === "campaigns" ? CAMPAIGN_ALIASES : LEAD_ALIASES;
  const map: Record<string, string> = {};
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const [field, names] of Object.entries(aliases)) {
    const idx = lower.findIndex((h) => names.includes(h));
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}

export function buildPreview(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  entity: ImportEntity,
  existingKeys: Set<string>,
): ImportPreview {
  const valid: MappedImportRow[] = [];
  const invalid: ImportPreview["invalid"] = [];
  const duplicates: ImportPreview["duplicates"] = [];
  rows.forEach((raw, i) => {
    const data: MappedImportRow = {};
    for (const [field, col] of Object.entries(mapping)) {
      if (col) data[field] = (raw[col] || "").trim();
    }
    if (!data.name) {
      invalid.push({ row: i + 2, reason: "Missing required name", data });
      return;
    }
    const key = entity === "leads" ? (data.email || data.name).toLowerCase() : data.name.toLowerCase();
    if (existingKeys.has(key)) {
      duplicates.push({ row: i + 2, key, data });
      return;
    }
    valid.push(data);
  });
  return { valid, invalid, duplicates };
}
