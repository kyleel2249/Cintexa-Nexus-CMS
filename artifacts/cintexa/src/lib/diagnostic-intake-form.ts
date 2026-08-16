/**
 * Fillable diagnostic intake form — full profile, metrics, paid social, adaptive assessment.
 */

import { SOCIAL_AD_PLATFORMS, questionBank, type SocialAdPlatform } from "@/lib/business-diagnostic";

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
  competitors?: string;
  notes?: string;
  /** questionId → answer */
  answers?: Record<string, string | number | boolean>;
  /** platform id → metrics */
  social?: Record<
    string,
    {
      enabled?: boolean;
      monthlySpend?: number | null;
      impressions?: number | null;
      clicks?: number | null;
      leads?: number | null;
      conversions?: number | null;
      roas?: number | null;
      cpc?: number | null;
      cpl?: number | null;
      notes?: string;
    }
  >;
};

const FIELD_ALIASES: Record<string, string[]> = {
  companyName: ["companyName", "company_name", "company", "name", "business_name"],
  website: ["website", "url", "site", "company_website"],
  industry: ["industry", "industry_type", "sector"],
  subIndustry: ["subIndustry", "sub_industry", "subsector"],
  businessModel: ["businessModel", "business_model", "model"],
  geographicMarkets: ["geographicMarkets", "geographic_markets", "market", "markets"],
  employees: ["employees", "employee_count", "headcount"],
  revenueRange: ["revenueRange", "revenue_range", "revenue"],
  strategicObjective: ["strategicObjective", "strategic_objective", "objective", "goal"],
  monthlyRevenue: ["monthlyRevenue", "monthly_revenue"],
  monthlyLeads: ["monthlyLeads", "monthly_leads", "leads"],
  qualifiedLeads: ["qualifiedLeads", "qualified_leads"],
  customers: ["customers", "new_customers", "monthly_customers"],
  conversion: ["conversion", "conversion_rate"],
  aov: ["aov", "avg_transaction", "average_order_value"],
  cac: ["cac", "customer_acquisition_cost"],
  churn: ["churn", "customer_churn"],
  retention: ["retention", "retention_rate"],
  grossMargin: ["grossMargin", "gross_margin"],
  netMargin: ["netMargin", "net_margin"],
  salesCycle: ["salesCycle", "sales_cycle", "sales_cycle_days"],
  competitors: ["competitors", "competitor_list"],
  notes: ["notes", "comments"],
};

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^\w]/g, "");
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
}

function pick(obj: Record<string, unknown>, aliases: string[]): unknown {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) map.set(normalizeKey(k), v);
  for (const a of aliases) {
    const n = normalizeKey(a);
    if (map.has(n) && map.get(n) !== "" && map.get(n) != null) return map.get(n);
  }
  return undefined;
}

export function parseIntakeFormText(raw: string, fileName = ""): IntakeFormPayload {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{")) {
    try {
      return mapRecordToPayload(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* continue */
    }
  }

  const data: Record<string, unknown> = {};
  if (trimmed.startsWith("[")) {
    try {
      for (const row of JSON.parse(trimmed) as unknown[]) {
        if (row && typeof row === "object") {
          const r = row as Record<string, unknown>;
          const k = String(r.field ?? r.key ?? r.name ?? "");
          if (k) data[k] = r.value ?? r.val;
        }
      }
      return mapRecordToPayload(data);
    } catch {
      /* continue */
    }
  }

  if (/,/.test(trimmed) && (fileName.endsWith(".csv") || trimmed.includes("\n"))) {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const headers = splitCsvLine(lines[0]);
      const values = splitCsvLine(lines[1]);
      headers.forEach((h, i) => {
        data[h] = values[i];
      });
      return mapRecordToPayload(data);
    }
  }

  const text = trimmed.replace(/<[^>]+>/g, "\n");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:=\n]+)\s*[:=]\s*(.+)\s*$/);
    if (m) data[m[1].trim()] = m[2].trim();
  }
  for (const m of trimmed.matchAll(/name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)) data[m[1]] = m[2];
  for (const m of trimmed.matchAll(/value=["']([^"']*)["'][^>]*name=["']([^"']+)["']/gi)) data[m[2]] = m[1];
  // checkbox checked
  for (const m of trimmed.matchAll(/name=["']([^"']+)["'][^>]*checked/gi)) data[m[1]] = true;

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
  for (const k of [
    "monthlyRevenue",
    "monthlyLeads",
    "qualifiedLeads",
    "customers",
    "conversion",
    "aov",
    "cac",
    "churn",
    "retention",
    "grossMargin",
    "netMargin",
    "salesCycle",
  ] as const) {
    setNum(k, FIELD_ALIASES[k]);
  }

  // Nested answers / social from JSON
  if (data.answers && typeof data.answers === "object") {
    payload.answers = data.answers as Record<string, string | number | boolean>;
  }
  if (data.social && typeof data.social === "object") {
    payload.social = data.social as IntakeFormPayload["social"];
  }

  // Flattened answer_* and social_* keys
  const answers: Record<string, string | number | boolean> = { ...(payload.answers || {}) };
  const social: NonNullable<IntakeFormPayload["social"]> = { ...(payload.social || {}) };
  for (const [k, v] of Object.entries(data)) {
    const nk = normalizeKey(k);
    if (nk.startsWith("answer_") || nk.startsWith("q_")) {
      const id = k.replace(/^(answer_|q_)/i, "");
      const b = toBool(v);
      if (b !== undefined) answers[id] = b;
      else {
        const n = toNumber(v);
        answers[id] = n != null && String(v).trim() !== "" && !Number.isNaN(Number(v)) ? n : String(v);
      }
    }
    const sm = nk.match(/^social_([a-z0-9]+)_([a-z0-9]+)$/);
    if (sm) {
      const [, pid, field] = sm;
      social[pid] = social[pid] || {};
      if (field === "enabled") (social[pid] as any).enabled = toBool(v) ?? Boolean(v);
      else if (field === "notes") (social[pid] as any).notes = String(v ?? "");
      else (social[pid] as any)[field] = toNumber(v);
    }
  }
  if (Object.keys(answers).length) payload.answers = answers;
  if (Object.keys(social).length) payload.social = social;

  return payload;
}

export function emptyIntakeTemplate(): IntakeFormPayload {
  const answers: Record<string, string | number | boolean> = {};
  for (const q of questionBank) {
    answers[q.id] = q.type === "boolean" ? false : q.type === "number" || q.type === "scale" ? 0 : "";
  }
  const social: NonNullable<IntakeFormPayload["social"]> = {};
  for (const p of SOCIAL_AD_PLATFORMS) {
    social[p.id] = {
      enabled: false,
      monthlySpend: null,
      impressions: null,
      clicks: null,
      leads: null,
      conversions: null,
      roas: null,
      cpc: null,
      cpl: null,
      notes: "",
    };
  }
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
    answers,
    social,
  };
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadIntakeJsonTemplate() {
  downloadBlob(JSON.stringify(emptyIntakeTemplate(), null, 2), "CINTEXA-Diagnostic-Intake-Form.json", "application/json");
}

export function downloadIntakeCsvTemplate() {
  const t = emptyIntakeTemplate();
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === "answers" || k === "social") continue;
    flat[k] = v == null ? "" : String(v);
  }
  for (const [qid, val] of Object.entries(t.answers || {})) {
    flat[`answer_${qid}`] = String(val ?? "");
  }
  for (const [pid, metrics] of Object.entries(t.social || {})) {
    for (const [field, val] of Object.entries(metrics || {})) {
      flat[`social_${pid}_${field}`] = val == null ? "" : String(val);
    }
  }
  const keys = Object.keys(flat);
  downloadBlob(`${keys.join(",")}\n${keys.map((k) => flat[k]).join(",")}\n`, "CINTEXA-Diagnostic-Intake-Form.csv", "text/csv");
}

export function downloadIntakeHtmlForm() {
  const qBlocks = questionBank
    .map((q) => {
      const label = `[${q.pillar}] ${q.text}`;
      if (q.type === "boolean") {
        return `<div class="q"><label>${escapeHtml(label)}</label>
          <select name="answer_${q.id}"><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></div>`;
      }
      if (q.type === "scale") {
        return `<div class="q"><label>${escapeHtml(label)} (1–5)</label>
          <select name="answer_${q.id}"><option value="">—</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></div>`;
      }
      if (q.type === "select" && q.options?.length) {
        return `<div class="q"><label>${escapeHtml(label)}</label>
          <select name="answer_${q.id}"><option value="">—</option>${q.options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select></div>`;
      }
      if (q.type === "number") {
        return `<div class="q"><label>${escapeHtml(label)}</label>
          <input name="answer_${q.id}" type="number" step="any" /></div>`;
      }
      return `<div class="q"><label>${escapeHtml(label)}</label>
        <input name="answer_${q.id}" type="text" /></div>`;
    })
    .join("\n");

  const socialBlocks = SOCIAL_AD_PLATFORMS.map((p) => {
    return `<div class="platform">
      <label class="en"><input type="checkbox" name="social_${p.id}_enabled" value="true" /> ${escapeHtml(p.label)} <span class="muted">(${escapeHtml(p.channel)})</span></label>
      <div class="row metrics">
        <div><label>Monthly spend</label><input name="social_${p.id}_monthlySpend" type="number" step="any" /></div>
        <div><label>Impressions</label><input name="social_${p.id}_impressions" type="number" step="any" /></div>
        <div><label>Clicks</label><input name="social_${p.id}_clicks" type="number" step="any" /></div>
        <div><label>Leads</label><input name="social_${p.id}_leads" type="number" step="any" /></div>
        <div><label>Conversions</label><input name="social_${p.id}_conversions" type="number" step="any" /></div>
        <div><label>ROAS</label><input name="social_${p.id}_roas" type="number" step="any" /></div>
        <div><label>CPC</label><input name="social_${p.id}_cpc" type="number" step="any" /></div>
        <div><label>CPL</label><input name="social_${p.id}_cpl" type="number" step="any" /></div>
      </div>
      <label>Notes</label><input name="social_${p.id}_notes" type="text" placeholder="Campaign focus, audience…" />
    </div>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Diagnostic Intake Form</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #0f172a; }
    body { max-width: 800px; margin: 24px auto; padding: 0 16px 48px; background: #f8fafc; }
    section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; margin: 16px 0; }
    h2 { font-size: 0.95rem; margin: 0 0 12px; color: #1e3a8a; }
    label { display: block; font-size: 0.8rem; font-weight: 600; margin: 10px 0 4px; }
    input, select, textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.9rem; }
    textarea { min-height: 72px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .row.metrics { grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 700px) { .row, .row.metrics { grid-template-columns: 1fr 1fr; } }
    .platform { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
    .en { font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .en input { width: auto; }
    .muted { color: #64748b; font-weight: 400; font-size: 0.75rem; }
    .q { margin-bottom: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    button { background: #1e6bff; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; }
    button.secondary { background: #0f172a; }
    footer { margin-top: 24px; font-size: 0.75rem; color: #64748b; }
  </style>
</head>
<body>
  <form id="intake">
    <section>
      <h2>Company intelligence profile</h2>
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
      <h2>Core business metrics</h2>
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
      <h2>Paid social &amp; ad boost platforms</h2>
      <p class="muted" style="margin-top:0">Enable each platform you use and enter spend / outcomes when known.</p>
      ${socialBlocks}
    </section>

    <section>
      <h2>Adaptive assessment</h2>
      <p class="muted" style="margin-top:0">Answer from the evidence you have. These map to diagnostic pillars.</p>
      ${qBlocks}
    </section>

    <section>
      <h2>Competitors</h2>
      <label>List as Name|https://website.com separated by commas</label>
      <textarea name="competitors" placeholder="Acme Corp|https://acme.com, Beta Ltd|https://beta.com"></textarea>
      <label>Notes</label>
      <textarea name="notes" placeholder="Additional context"></textarea>
    </section>

    <div class="actions">
      <button type="button" id="btnJson">Download filled JSON</button>
      <button type="button" class="secondary" id="btnPrint">Print / Save as PDF</button>
    </div>
  </form>

  <footer>
    © ${new Date().getFullYear()} Cintexa Technologies · Powered by Cintexa Technologies · https://cintexa.com
  </footer>

  <script>
    function formToObject() {
      const form = document.getElementById('intake');
      const fd = new FormData(form);
      const o = { answers: {}, social: {} };
      const metricKeys = /monthlyRevenue|monthlyLeads|qualifiedLeads|customers|conversion|aov|cac|churn|retention|grossMargin|netMargin|salesCycle/;
      for (const [k, v] of fd.entries()) {
        if (k.startsWith('answer_')) {
          const id = k.slice(7);
          if (v === '') continue;
          if (v === 'true') o.answers[id] = true;
          else if (v === 'false') o.answers[id] = false;
          else if (!isNaN(Number(v)) && String(v).trim() !== '') o.answers[id] = Number(v);
          else o.answers[id] = v;
          continue;
        }
        if (k.startsWith('social_')) {
          const parts = k.split('_');
          const pid = parts[1];
          const field = parts.slice(2).join('_');
          o.social[pid] = o.social[pid] || {};
          if (field === 'enabled') o.social[pid].enabled = true;
          else if (field === 'notes') o.social[pid].notes = v;
          else o.social[pid][field] = v === '' ? null : Number(v);
          continue;
        }
        if (v === '') { o[k] = metricKeys.test(k) ? null : ''; continue; }
        if (metricKeys.test(k)) { const n = Number(v); o[k] = Number.isFinite(n) ? n : null; }
        else o[k] = v;
      }
      // unchecked social platforms
      ${JSON.stringify(SOCIAL_AD_PLATFORMS.map((p) => p.id))}.forEach(function(pid) {
        o.social[pid] = o.social[pid] || { enabled: false };
        if (o.social[pid].enabled == null) o.social[pid].enabled = false;
      });
      return o;
    }
    document.getElementById('btnJson').onclick = function() {
      const blob = new Blob([JSON.stringify(formToObject(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'CINTEXA-Diagnostic-Intake-Filled.json';
      a.click();
    };
    document.getElementById('btnPrint').onclick = function() { window.print(); };
  </script>
</body>
</html>`;
  downloadBlob(html, "CINTEXA-Diagnostic-Intake-Form.html", "text/html");
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

export function intakeCompetitors(payload: IntakeFormPayload): Array<{ name: string; website: string }> {
  if (!payload.competitors?.trim()) return [];
  return payload.competitors
    .split(/[,;]+/)
    .map((part) => {
      const [name, website] = part.split("|").map((s) => s.trim());
      return { name: name || "Competitor", website: website || "" };
    })
    .filter((c) => c.name);
}

export function intakeSocialPatches(payload: IntakeFormPayload, current: SocialAdPlatform[]): SocialAdPlatform[] {
  if (!payload.social) return current;
  return current.map((p) => {
    const s = payload.social![p.id];
    if (!s) return p;
    return {
      ...p,
      enabled: s.enabled ?? p.enabled,
      monthlySpend: s.monthlySpend !== undefined ? s.monthlySpend : p.monthlySpend,
      impressions: s.impressions !== undefined ? s.impressions : p.impressions,
      clicks: s.clicks !== undefined ? s.clicks : p.clicks,
      leads: s.leads !== undefined ? s.leads : p.leads,
      conversions: s.conversions !== undefined ? s.conversions : p.conversions,
      roas: s.roas !== undefined ? s.roas : p.roas,
      cpc: s.cpc !== undefined ? s.cpc : p.cpc,
      cpl: s.cpl !== undefined ? s.cpl : p.cpl,
      notes: s.notes !== undefined ? s.notes : p.notes,
    };
  });
}
