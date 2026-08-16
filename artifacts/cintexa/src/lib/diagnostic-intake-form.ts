/**
 * Fillable diagnostic intake form — download, complete offline/online, upload to autofill Nexus.
 */

export type IntakeFormPayload = {
  companyName?: string;
  website?: string;
  industry?: string;
  subIndustry?: string;
  businessModel?: string;
  geographicMarkets?: string;
  employees?: string;
  revenueRange?: string;
  strategicObjective?: string;
  monthlyRevenue?: number | null;
  monthlyLeads?: number | null;
  qualifiedLeads?: number | null;
  customers?: number | null;
  conversion?: number | null;
  aov?: number | null;
  cac?: number | null;
  churn?: number | null;
  retention?: number | null;
  grossMargin?: number | null;
  netMargin?: number | null;
  salesCycle?: number | null;
  competitors?: string; // comma-separated "Name|https://site.com"
  notes?: string;
};

const FIELD_ALIASES: Record<keyof IntakeFormPayload, string[]> = {
  companyName: ["companyName", "company_name", "company", "name", "business_name", "organisation", "organization"],
  website: ["website", "url", "site", "company_website", "web"],
  industry: ["industry", "industry_type", "sector"],
  subIndustry: ["subIndustry", "sub_industry", "subsector", "segment"],
  businessModel: ["businessModel", "business_model", "model"],
  geographicMarkets: ["geographicMarkets", "geographic_markets", "market", "markets", "region", "geography"],
  employees: ["employees", "employee_count", "headcount", "company_size", "size"],
  revenueRange: ["revenueRange", "revenue_range", "revenue", "annual_revenue"],
  strategicObjective: ["strategicObjective", "strategic_objective", "objective", "primary_objective", "goal"],
  monthlyRevenue: ["monthlyRevenue", "monthly_revenue"],
  monthlyLeads: ["monthlyLeads", "monthly_leads", "leads"],
  qualifiedLeads: ["qualifiedLeads", "qualified_leads", "mql"],
  customers: ["customers", "new_customers", "monthly_customers"],
  conversion: ["conversion", "conversion_rate", "lead_to_customer"],
  aov: ["aov", "avg_transaction", "average_order_value", "avgTransactionValue"],
  cac: ["cac", "customer_acquisition_cost", "acquisition_cost"],
  churn: ["churn", "customer_churn", "churn_rate"],
  retention: ["retention", "retention_rate"],
  grossMargin: ["grossMargin", "gross_margin"],
  netMargin: ["netMargin", "net_margin"],
  salesCycle: ["salesCycle", "sales_cycle", "sales_cycle_days"],
  competitors: ["competitors", "competitor_list", "main_competitors"],
  notes: ["notes", "comments", "additional_info"],
};

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^\w]/g, "");
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pick(obj: Record<string, unknown>, aliases: string[]): unknown {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    map.set(normalizeKey(k), v);
  }
  for (const a of aliases) {
    const n = normalizeKey(a);
    if (map.has(n) && map.get(n) !== "" && map.get(n) != null) return map.get(n);
  }
  return undefined;
}

/** Parse JSON, CSV (key,value rows or header row), or simple key: value text into intake payload. */
export function parseIntakeFormText(raw: string, fileName = ""): IntakeFormPayload {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  // JSON object
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      return mapRecordToPayload(data);
    } catch {
      /* fall through */
    }
  }

  // JSON array of {field, value} or similar
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      const data: Record<string, unknown> = {};
      for (const row of arr) {
        if (row && typeof row === "object") {
          const r = row as Record<string, unknown>;
          const k = String(r.field ?? r.key ?? r.name ?? "");
          const v = r.value ?? r.val ?? r.data;
          if (k) data[k] = v;
        }
      }
      return mapRecordToPayload(data);
    } catch {
      /* fall through */
    }
  }

  // CSV: header,value lines OR single header row + data row
  if (/,/.test(trimmed) && (fileName.endsWith(".csv") || trimmed.includes("\n"))) {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines[0].toLowerCase().includes("company")) {
      // header row + data row
      const headers = splitCsvLine(lines[0]);
      const values = splitCsvLine(lines[1]);
      const data: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        data[h] = values[i];
      });
      return mapRecordToPayload(data);
    }
    // key,value per line
    const data: Record<string, unknown> = {};
    for (const line of lines) {
      const parts = splitCsvLine(line);
      if (parts.length >= 2) data[parts[0]] = parts.slice(1).join(",");
    }
    return mapRecordToPayload(data);
  }

  // key: value or key=value text / HTML form-ish
  const data: Record<string, unknown> = {};
  // strip simple HTML tags for text content
  const text = trimmed.replace(/<[^>]+>/g, "\n");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:=\n]+)\s*[:=]\s*(.+)\s*$/);
    if (m) data[m[1].trim()] = m[2].trim();
  }
  // name="field" value="x" from HTML
  const nameVal = [...trimmed.matchAll(/name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)];
  for (const m of nameVal) data[m[1]] = m[2];
  const valName = [...trimmed.matchAll(/value=["']([^"']*)["'][^>]*name=["']([^"']+)["']/gi)];
  for (const m of valName) data[m[2]] = m[1];

  return mapRecordToPayload(data);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === "," && !q) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function mapRecordToPayload(data: Record<string, unknown>): IntakeFormPayload {
  const payload: IntakeFormPayload = {};
  const setStr = (key: keyof IntakeFormPayload, aliases: string[]) => {
    const v = pick(data, aliases);
    if (v != null && String(v).trim() !== "") (payload as any)[key] = String(v).trim();
  };
  const setNum = (key: keyof IntakeFormPayload, aliases: string[]) => {
    const v = pick(data, aliases);
    if (v != null && String(v).trim() !== "") (payload as any)[key] = toNumber(v);
  };

  setStr("companyName", FIELD_ALIASES.companyName);
  setStr("website", FIELD_ALIASES.website);
  setStr("industry", FIELD_ALIASES.industry);
  setStr("subIndustry", FIELD_ALIASES.subIndustry);
  setStr("businessModel", FIELD_ALIASES.businessModel);
  setStr("geographicMarkets", FIELD_ALIASES.geographicMarkets);
  setStr("employees", FIELD_ALIASES.employees);
  setStr("revenueRange", FIELD_ALIASES.revenueRange);
  setStr("strategicObjective", FIELD_ALIASES.strategicObjective);
  setStr("competitors", FIELD_ALIASES.competitors);
  setStr("notes", FIELD_ALIASES.notes);
  setNum("monthlyRevenue", FIELD_ALIASES.monthlyRevenue);
  setNum("monthlyLeads", FIELD_ALIASES.monthlyLeads);
  setNum("qualifiedLeads", FIELD_ALIASES.qualifiedLeads);
  setNum("customers", FIELD_ALIASES.customers);
  setNum("conversion", FIELD_ALIASES.conversion);
  setNum("aov", FIELD_ALIASES.aov);
  setNum("cac", FIELD_ALIASES.cac);
  setNum("churn", FIELD_ALIASES.churn);
  setNum("retention", FIELD_ALIASES.retention);
  setNum("grossMargin", FIELD_ALIASES.grossMargin);
  setNum("netMargin", FIELD_ALIASES.netMargin);
  setNum("salesCycle", FIELD_ALIASES.salesCycle);
  return payload;
}

export function emptyIntakeTemplate(): IntakeFormPayload {
  return {
    companyName: "",
    website: "",
    industry: "",
    subIndustry: "",
    businessModel: "B2B",
    geographicMarkets: "",
    employees: "",
    revenueRange: "",
    strategicObjective: "",
    monthlyRevenue: null,
    monthlyLeads: null,
    qualifiedLeads: null,
    customers: null,
    conversion: null,
    aov: null,
    cac: null,
    churn: null,
    retention: null,
    grossMargin: null,
    netMargin: null,
    salesCycle: null,
    competitors: "",
    notes: "",
  };
}

/** Downloadable JSON template for autofill. */
export function downloadIntakeJsonTemplate() {
  const blob = new Blob([JSON.stringify(emptyIntakeTemplate(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "CINTEXA-Diagnostic-Intake-Form.json";
  a.click();
  URL.revokeObjectURL(url);
}

/** Downloadable CSV template. */
export function downloadIntakeCsvTemplate() {
  const t = emptyIntakeTemplate();
  const keys = Object.keys(t);
  const header = keys.join(",");
  const example = keys.map((k) => {
    const v = (t as any)[k];
    return v == null ? "" : String(v);
  }).join(",");
  const blob = new Blob([`${header}\n${example}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "CINTEXA-Diagnostic-Intake-Form.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Fillable HTML form — open in browser, fill, Save as, then upload the HTML or export JSON from the form. */
export function downloadIntakeHtmlForm() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CINTEXA Diagnostic Intake Form</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #0f172a; }
    body { max-width: 720px; margin: 24px auto; padding: 0 16px 48px; background: #f8fafc; }
    h1 { font-size: 1.35rem; margin-bottom: 4px; }
    p.lead { color: #64748b; margin-top: 0; }
    section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; margin: 16px 0; }
    h2 { font-size: 0.95rem; margin: 0 0 12px; color: #1e3a8a; }
    label { display: block; font-size: 0.8rem; font-weight: 600; margin: 10px 0 4px; }
    input, select, textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.9rem; }
    textarea { min-height: 72px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 600px) { .row { grid-template-columns: 1fr; } }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    button { background: #1e6bff; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; }
    button.secondary { background: #0f172a; }
    footer { margin-top: 24px; font-size: 0.75rem; color: #64748b; }
  </style>
</head>
<body>
  <form id="intake">
    <section>
      <h2>Company profile</h2>
      <div class="row">
        <div><label>Company name</label><input name="companyName" required placeholder="Legal or trading name" /></div>
        <div><label>Website</label><input name="website" type="url" placeholder="https://" /></div>
      </div>
      <div class="row">
        <div><label>Industry</label>
          <select name="industry">
            <option value="">Select…</option>
            <option>SaaS / Software</option><option>E-commerce / Retail</option><option>Digital Agency / Marketing</option>
            <option>Professional Services</option><option>Healthcare</option><option>Fintech / Financial Services</option>
            <option>Education / EdTech</option><option>Manufacturing</option><option>Hospitality / Travel</option>
            <option>Real Estate / PropTech</option><option>Logistics / Supply Chain</option><option>Media / Entertainment</option>
            <option>Non-profit / NGO</option><option>Other / General</option>
          </select>
        </div>
        <div><label>Sub-industry</label><input name="subIndustry" placeholder="e.g. B2B SaaS" /></div>
      </div>
      <div class="row">
        <div><label>Geographic markets</label><input name="geographicMarkets" placeholder="e.g. Ghana, West Africa" /></div>
        <div><label>Business model</label>
          <select name="businessModel"><option>B2B</option><option>B2C</option><option>B2B2C</option><option>Marketplace</option><option>Subscription</option></select>
        </div>
      </div>
      <div class="row">
        <div><label>Employees</label><input name="employees" placeholder="e.g. 25-50" /></div>
        <div><label>Revenue range</label><input name="revenueRange" placeholder="e.g. GHS 50k–150k / mo" /></div>
      </div>
      <label>Primary strategic objective</label>
      <input name="strategicObjective" placeholder="e.g. Increase qualified revenue and conversion efficiency" />
    </section>

    <section>
      <h2>Core metrics (leave blank if unknown)</h2>
      <div class="row">
        <div><label>Monthly revenue</label><input name="monthlyRevenue" type="number" step="any" /></div>
        <div><label>Monthly leads</label><input name="monthlyLeads" type="number" step="any" /></div>
        <div><label>Qualified leads / month</label><input name="qualifiedLeads" type="number" step="any" /></div>
        <div><label>New customers / month</label><input name="customers" type="number" step="any" /></div>
        <div><label>Lead-to-customer conversion %</label><input name="conversion" type="number" step="any" /></div>
        <div><label>Average transaction value</label><input name="aov" type="number" step="any" /></div>
        <div><label>Customer acquisition cost</label><input name="cac" type="number" step="any" /></div>
        <div><label>Monthly churn %</label><input name="churn" type="number" step="any" /></div>
        <div><label>Retention %</label><input name="retention" type="number" step="any" /></div>
        <div><label>Gross margin %</label><input name="grossMargin" type="number" step="any" /></div>
        <div><label>Net margin %</label><input name="netMargin" type="number" step="any" /></div>
        <div><label>Sales cycle (days)</label><input name="salesCycle" type="number" step="any" /></div>
      </div>
    </section>

    <section>
      <h2>Competitors</h2>
      <label>List competitors as Name|https://website.com separated by commas</label>
      <textarea name="competitors" placeholder="Acme Corp|https://acme.com, Beta Ltd|https://beta.com"></textarea>
      <label>Notes</label>
      <textarea name="notes" placeholder="Anything else the diagnostic should know"></textarea>
    </section>

    <div class="actions">
      <button type="button" id="btnJson">Download filled JSON (for Nexus upload)</button>
      <button type="button" class="secondary" id="btnPrint">Print / Save as PDF</button>
    </div>
  </form>

  <footer>
    © ${new Date().getFullYear()} Cintexa Technologies · Powered by Cintexa Technologies · https://cintexa.com
  </footer>

  <script>
    function formToObject() {
      const fd = new FormData(document.getElementById('intake'));
      const o = {};
      for (const [k, v] of fd.entries()) {
        if (v === '') { o[k] = k.match(/Revenue|Leads|customers|conversion|aov|cac|churn|retention|Margin|Cycle/i) ? null : ''; continue; }
        if (k.match(/monthlyRevenue|monthlyLeads|qualifiedLeads|customers|conversion|aov|cac|churn|retention|grossMargin|netMargin|salesCycle/)) {
          const n = Number(v); o[k] = Number.isFinite(n) ? n : null;
        } else o[k] = v;
      }
      return o;
    }
    document.getElementById('btnJson').onclick = () => {
      const blob = new Blob([JSON.stringify(formToObject(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'CINTEXA-Diagnostic-Intake-Filled.json';
      a.click();
    };
    document.getElementById('btnPrint').onclick = () => window.print();
  </script>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "CINTEXA-Diagnostic-Intake-Form.html";
  a.click();
  URL.revokeObjectURL(url);
}

export function intakeToCompany(payload: IntakeFormPayload) {
  return {
    name: payload.companyName ?? "",
    website: payload.website ?? "",
    industry: payload.industry ?? "",
    subIndustry: payload.subIndustry ?? "",
    model: payload.businessModel || "B2B",
    market: payload.geographicMarkets ?? "",
    employees: payload.employees ?? "",
    revenue: payload.revenueRange ?? "",
    objective: payload.strategicObjective ?? "",
  };
}

export function intakeMetricPatches(payload: IntakeFormPayload): Record<string, number | null> {
  return {
    monthlyRevenue: payload.monthlyRevenue ?? null,
    monthlyLeads: payload.monthlyLeads ?? null,
    qualifiedLeads: payload.qualifiedLeads ?? null,
    customers: payload.customers ?? null,
    conversion: payload.conversion ?? null,
    aov: payload.aov ?? null,
    cac: payload.cac ?? null,
    churn: payload.churn ?? null,
    retention: payload.retention ?? null,
    grossMargin: payload.grossMargin ?? null,
    netMargin: payload.netMargin ?? null,
    salesCycle: payload.salesCycle ?? null,
  };
}

/** Parse "Name|url, Name2|url2" into competitor seeds. */
export function intakeCompetitors(payload: IntakeFormPayload): Array<{ name: string; website: string }> {
  if (!payload.competitors?.trim()) return [];
  return payload.competitors.split(/[,;]+/).map((part) => {
    const [name, website] = part.split("|").map((s) => s.trim());
    return { name: name || "Competitor", website: website || "" };
  }).filter((c) => c.name);
}
