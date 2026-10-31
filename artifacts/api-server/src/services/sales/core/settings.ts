/**
 * Versioned Sales settings. Defaults live here; stored sections are deep-merged over them. Every change is
 * validated per section, versioned (sales_settings_history) and audited. Nothing company-wide that already exists
 * in platform settings (e.g. security) is duplicated here.
 */
import type { Actor, Db, Queryable } from "./types";
import { v, parse, type Schema } from "./validate";
import { audit } from "./audit";
import { badRequest } from "./errors";
import { isValidTimeZone } from "./time";

export interface SalesSettings {
  business: { timezone: string; currency: string; locale: string; rounding: "half_up" | "half_even"; weekStartsOn: 0 | 1; fiscalYearStartMonth: number };
  numbering: { leadPrefix: string; accountPrefix: string; opportunityPrefix: string; quotationPrefix: string; orderPrefix: string; yearly: boolean };
  leads: {
    assignment: "manual" | "round_robin" | "territory";
    responseSlaHours: number;
    followUpDays: number;
    dedupe: { matchEmail: boolean; matchPhone: boolean; matchCompany: boolean; nameSimilarity: number };
    scoring: {
      hasEmail: number; hasPhone: number; hasCompany: number; hasJobTitle: number; budgetKnown: number; highBudgetThreshold: string; highBudget: number;
      decisionMakerTitles: string[]; decisionMaker: number; sourceWeights: Record<string, number>; consent: number; recentContactDays: number; recentContact: number; staleDays: number; stalePenalty: number;
    };
  };
  discounts: { repMaxPercent: number; managerMaxPercent: number; directorMaxPercent: number; minMarginPercent: number; creditCheck: boolean };
  quotations: { validityDays: number; expiryReminderDays: number; defaultTerms: string };
  orders: { approvalThreshold: string; requireApprovalBelowMargin: boolean };
  pipeline: { requireCloseDate: boolean };
  retention: { inactiveDays: number; atRiskDays: number; reorderLeadDays: number; complaintWeight: number };
  commissions: { defaultBasis: "booked" | "invoiced" | "collected"; autoCalculate: boolean };
  forecast: { minimumClosedDeals: number; seasonalityMinMonths: number; bestCaseUplift: number; worstCaseHaircut: number };
  attribution: { model: "first_touch" | "last_touch" | "linear"; windowDays: number };
  notifications: { enabled: boolean; targetAtRisk: boolean; overdueFollowUps: boolean; expiringQuotations: boolean };
  automation: { enabled: boolean; maxDepth: number; maxRunsPerRecordPerDay: number; runLeaseSeconds: number };
  integrations: {
    inventory: { enabled: boolean; provider: string };
    finance: { enabled: boolean; provider: string };
    email: { enabled: boolean; provider: string; fromAddress: string };
    whatsapp: { enabled: boolean; provider: string };
    calendar: { enabled: boolean; provider: string };
    esignature: { enabled: boolean; provider: string };
    ai: { enabled: boolean; allowExternalProvider: boolean };
  };
  archival: { archiveClosedAfterDays: number; purgeOutboxAfterDays: number };
}

export const DEFAULT_SETTINGS: SalesSettings = {
  business: { timezone: "UTC", currency: "USD", locale: "en-US", rounding: "half_up", weekStartsOn: 1, fiscalYearStartMonth: 1 },
  numbering: { leadPrefix: "LD", accountPrefix: "AC", opportunityPrefix: "OP", quotationPrefix: "QT", orderPrefix: "SO", yearly: true },
  leads: {
    assignment: "manual",
    responseSlaHours: 24,
    followUpDays: 2,
    dedupe: { matchEmail: true, matchPhone: true, matchCompany: true, nameSimilarity: 0.85 },
    scoring: {
      hasEmail: 10, hasPhone: 8, hasCompany: 7, hasJobTitle: 5, budgetKnown: 10, highBudgetThreshold: "10000.00", highBudget: 15,
      decisionMakerTitles: ["owner", "founder", "ceo", "cfo", "coo", "cto", "director", "head", "vp", "president", "manager"], decisionMaker: 12,
      sourceWeights: { referral: 15, web_form: 8, event: 8, campaign: 6, partner: 10, manual: 3, cold: 1 }, consent: 5, recentContactDays: 7, recentContact: 8, staleDays: 30, stalePenalty: 10,
    },
  },
  discounts: { repMaxPercent: 10, managerMaxPercent: 20, directorMaxPercent: 35, minMarginPercent: 10, creditCheck: true },
  quotations: { validityDays: 30, expiryReminderDays: 3, defaultTerms: "Payment due per the stated payment terms. Prices exclude taxes unless shown. This quotation is valid until the validity date." },
  orders: { approvalThreshold: "50000.00", requireApprovalBelowMargin: true },
  pipeline: { requireCloseDate: true },
  retention: { inactiveDays: 90, atRiskDays: 60, reorderLeadDays: 7, complaintWeight: 15 },
  commissions: { defaultBasis: "collected", autoCalculate: true },
  forecast: { minimumClosedDeals: 10, seasonalityMinMonths: 24, bestCaseUplift: 1, worstCaseHaircut: 0.5 },
  attribution: { model: "last_touch", windowDays: 90 },
  notifications: { enabled: true, targetAtRisk: true, overdueFollowUps: true, expiringQuotations: true },
  automation: { enabled: true, maxDepth: 3, maxRunsPerRecordPerDay: 25, runLeaseSeconds: 120 },
  integrations: {
    inventory: { enabled: false, provider: "none" },
    finance: { enabled: false, provider: "none" },
    email: { enabled: false, provider: "smtp", fromAddress: "" },
    whatsapp: { enabled: false, provider: "none" },
    calendar: { enabled: false, provider: "none" },
    esignature: { enabled: false, provider: "none" },
    // AI assist is ON by default but only becomes AVAILABLE when a provider key exists on the server (see GET /ai/status); an admin can switch it off in Settings.
    ai: { enabled: true, allowExternalProvider: true },
  },
  archival: { archiveClosedAfterDays: 730, purgeOutboxAfterDays: 90 },
};

type Section = keyof SalesSettings;
export const SETTING_SECTIONS = Object.keys(DEFAULT_SETTINGS) as Section[];

const pct = () => v.number({ min: 0, max: 100 });
const prefix = () => v.string({ min: 1, max: 6, upper: true, pattern: /^[A-Z0-9]+$/, patternMessage: "Use letters and digits only" });

const SECTION_SCHEMAS: Record<Section, Schema<any>> = {
  business: v.object({
    timezone: v.string({ min: 1, max: 64 }), currency: v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ }), locale: v.string({ min: 2, max: 16 }),
    rounding: v.enumOf(["half_up", "half_even"] as const), weekStartsOn: v.int({ min: 0, max: 1 }), fiscalYearStartMonth: v.int({ min: 1, max: 12 }),
  }),
  numbering: v.object({ leadPrefix: prefix(), accountPrefix: prefix(), opportunityPrefix: prefix(), quotationPrefix: prefix(), orderPrefix: prefix(), yearly: v.boolean() }),
  leads: v.object({
    assignment: v.enumOf(["manual", "round_robin", "territory"] as const), responseSlaHours: v.number({ min: 1, max: 720 }), followUpDays: v.int({ min: 0, max: 90 }),
    dedupe: v.object({ matchEmail: v.boolean(), matchPhone: v.boolean(), matchCompany: v.boolean(), nameSimilarity: v.number({ min: 0.5, max: 1 }) }),
    scoring: v.object({
      hasEmail: v.int({ min: 0, max: 50 }), hasPhone: v.int({ min: 0, max: 50 }), hasCompany: v.int({ min: 0, max: 50 }), hasJobTitle: v.int({ min: 0, max: 50 }), budgetKnown: v.int({ min: 0, max: 50 }),
      highBudgetThreshold: v.money(), highBudget: v.int({ min: 0, max: 50 }), decisionMakerTitles: v.array(v.string({ max: 40, lower: true }), { max: 50 }), decisionMaker: v.int({ min: 0, max: 50 }),
      sourceWeights: v.record(v.int({ min: 0, max: 50 }), { maxKeys: 40 }), consent: v.int({ min: 0, max: 50 }), recentContactDays: v.int({ min: 1, max: 90 }), recentContact: v.int({ min: 0, max: 50 }),
      staleDays: v.int({ min: 1, max: 365 }), stalePenalty: v.int({ min: 0, max: 50 }),
    }),
  }),
  discounts: v.object({ repMaxPercent: pct(), managerMaxPercent: pct(), directorMaxPercent: pct(), minMarginPercent: pct(), creditCheck: v.boolean() }),
  quotations: v.object({ validityDays: v.int({ min: 1, max: 365 }), expiryReminderDays: v.int({ min: 0, max: 60 }), defaultTerms: v.string({ max: 4000, allowEmpty: true, raw: true }) }),
  orders: v.object({ approvalThreshold: v.money(), requireApprovalBelowMargin: v.boolean() }),
  pipeline: v.object({ requireCloseDate: v.boolean() }),
  retention: v.object({ inactiveDays: v.int({ min: 1, max: 1825 }), atRiskDays: v.int({ min: 1, max: 1825 }), reorderLeadDays: v.int({ min: 0, max: 120 }), complaintWeight: v.int({ min: 0, max: 100 }) }),
  commissions: v.object({ defaultBasis: v.enumOf(["booked", "invoiced", "collected"] as const), autoCalculate: v.boolean() }),
  forecast: v.object({ minimumClosedDeals: v.int({ min: 1, max: 1000 }), seasonalityMinMonths: v.int({ min: 12, max: 120 }), bestCaseUplift: v.number({ min: 0, max: 5 }), worstCaseHaircut: v.number({ min: 0, max: 1 }) }),
  attribution: v.object({ model: v.enumOf(["first_touch", "last_touch", "linear"] as const), windowDays: v.int({ min: 1, max: 730 }) }),
  notifications: v.object({ enabled: v.boolean(), targetAtRisk: v.boolean(), overdueFollowUps: v.boolean(), expiringQuotations: v.boolean() }),
  automation: v.object({ enabled: v.boolean(), maxDepth: v.int({ min: 1, max: 5 }), maxRunsPerRecordPerDay: v.int({ min: 1, max: 500 }), runLeaseSeconds: v.int({ min: 10, max: 3600 }) }),
  integrations: v.object({
    inventory: v.object({ enabled: v.boolean(), provider: v.string({ max: 40 }) }), finance: v.object({ enabled: v.boolean(), provider: v.string({ max: 40 }) }),
    email: v.object({ enabled: v.boolean(), provider: v.string({ max: 40 }), fromAddress: v.string({ max: 254, allowEmpty: true }) }), whatsapp: v.object({ enabled: v.boolean(), provider: v.string({ max: 40 }) }),
    calendar: v.object({ enabled: v.boolean(), provider: v.string({ max: 40 }) }), esignature: v.object({ enabled: v.boolean(), provider: v.string({ max: 40 }) }),
    ai: v.object({ enabled: v.boolean(), allowExternalProvider: v.boolean() }),
  }),
  archival: v.object({ archiveClosedAfterDays: v.int({ min: 30, max: 3650 }), purgeOutboxAfterDays: v.int({ min: 7, max: 3650 }) }),
};

function isPlain(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) {
    if (k === "__proto__" || k === "constructor") continue;
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], over[k]) : over[k];
  }
  return out as T;
}

const cache = new WeakMap<object, { at: number; value: SalesSettings }>();
const TTL_MS = 3000;

export async function loadSettings(db: Pick<Db, "query"> | Queryable, now = Date.now()): Promise<SalesSettings> {
  const hit = cache.get(db);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const r = await db.query<{ key: string; value: unknown }>("SELECT key, value FROM sales_settings");
  let merged = structuredClone(DEFAULT_SETTINGS);
  for (const row of r.rows) if ((SETTING_SECTIONS as string[]).includes(row.key)) merged = { ...merged, [row.key]: deepMerge((merged as any)[row.key], row.value) };
  cache.set(db, { at: now, value: merged });
  return merged;
}

export function invalidateSettings(db: object): void {
  cache.delete(db);
}

export async function updateSection(db: Db, actor: Actor, section: string, input: unknown, requestId?: string): Promise<SalesSettings[Section]> {
  if (!(SETTING_SECTIONS as string[]).includes(section)) throw badRequest(`Unknown settings section "${section}"`);
  const key = section as Section;
  const current = (await loadSettings(db, Date.now() + TTL_MS + 1))[key];
  const merged = deepMerge(current, input);
  const value = parse(SECTION_SCHEMAS[key], merged, key);
  if (key === "business" && !isValidTimeZone((value as SalesSettings["business"]).timezone)) throw badRequest("Unknown timezone", { issues: [{ path: "business.timezone", message: "Unknown timezone" }] });
  if (key === "discounts") {
    const d = value as SalesSettings["discounts"];
    if (!(d.repMaxPercent <= d.managerMaxPercent && d.managerMaxPercent <= d.directorMaxPercent)) throw badRequest("Discount limits must increase: representative ≤ manager ≤ director");
  }
  if (key === "retention") {
    const r = value as SalesSettings["retention"];
    if (r.atRiskDays > r.inactiveDays) throw badRequest("At-risk days cannot exceed inactive days");
  }
  await db.tx(async (q) => {
    const prev = await q.query<{ version: number }>("SELECT version FROM sales_settings WHERE key = $1 FOR UPDATE", [key]);
    const version = (prev.rows[0]?.version ?? 0) + 1;
    await q.query(
      `INSERT INTO sales_settings (key, value, version, updated_by) VALUES ($1, $2::text::jsonb, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), version, actor.label],
    );
    await q.query("INSERT INTO sales_settings_history (key, version, value, changed_by) VALUES ($1,$2,$3::text::jsonb,$4)", [key, version, JSON.stringify(value), actor.label]);
    await audit(q, actor, { action: "settings.update", entityType: "settings", entityId: key, summary: `Updated ${key} settings (v${version})`, before: current, after: value }, requestId);
  });
  invalidateSettings(db);
  return value;
}
