/**
 * Fill plan + safe apply for records that are NOT open in a form (bulk enrichment).
 * Rules: only EMPTY columns are filled; names are never changed; hypotheses, conflicting and low-confidence (<0.55) values are never applied
 * automatically; every value is validated for its column; the person must hold the write permission and be allowed to see the record.
 */
import type { Queryable, Actor } from "../core/types";
import { audit } from "../core/audit";

export type EntityKind = "lead" | "account";
const LEAD_MAP: Record<string, string> = { email: "email", phone: "phone", industry: "industry", country: "country", products_services: "product_interest", description: "notes" };
const ACCOUNT_MAP: Record<string, string> = { website: "website", email: "email", phone: "phone", industry: "industry", address: "address_line", city: "city", region: "region", country: "country", postal_code: "postal_code", description: "notes", tags: "tags" };
export const MIN_AUTO_CONFIDENCE = 0.55;

export interface PlanItem { field: string; column: string; value: string; confidence: number; verification: string; kind: string; sourceUrl: string | null }
export interface Plan { fills: PlanItem[]; skipped: { field: string; reason: string }[] }

function validate(column: string, v: string): string | null {
  const t = v.trim();
  if (!t) return "empty";
  if (column === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? null : "not a valid email";
  if (column === "phone") return t.replace(/\D/g, "").length >= 7 ? null : "not a valid phone number";
  if (column === "website") return /^https?:\/\/\S+$/.test(t) ? null : "not a valid web address";
  return t.length <= (column === "notes" ? 2000 : 300) ? null : "too long";
}
const blank = (x: unknown) => x === null || x === undefined || (typeof x === "string" && x.trim() === "") || (Array.isArray(x) && x.length === 0);

export function buildPlan(kind: EntityKind, record: Record<string, any>, evidence: { field: string; value: string; kind: string; confidence: number | string; verification: string; source_url: string | null }[]): Plan {
  const map = kind === "lead" ? LEAD_MAP : ACCOUNT_MAP;
  const plan: Plan = { fills: [], skipped: [] };
  const best = new Map<string, (typeof evidence)[number]>();
  for (const e of [...evidence].sort((a, b) => Number(b.confidence) - Number(a.confidence))) if (!best.has(e.field)) best.set(e.field, e);
  for (const [field, column] of Object.entries(map)) {
    const e = best.get(field);
    if (!e) continue;
    if (!blank(record[column])) { plan.skipped.push({ field, reason: "already has a value" }); continue; }
    if (e.kind === "hypothesis") { plan.skipped.push({ field, reason: "only a hypothesis" }); continue; }
    if (e.verification === "conflicting") { plan.skipped.push({ field, reason: "sources conflict - review in the form" }); continue; }
    if (Number(e.confidence) < MIN_AUTO_CONFIDENCE) { plan.skipped.push({ field, reason: "confidence below 55%" }); continue; }
    let value = e.value.trim();
    if (field === "tags") value = [...new Set(evidence.filter((x) => x.field === "tags" && Number(x.confidence) >= MIN_AUTO_CONFIDENCE).map((x) => x.value.trim()))].slice(0, 3).join(", ");
    const bad = field === "tags" ? (value ? null : "empty") : validate(column, value);
    if (bad) { plan.skipped.push({ field, reason: bad }); continue; }
    plan.fills.push({ field, column, value, confidence: Number(e.confidence), verification: e.verification, kind: e.kind, sourceUrl: e.source_url });
  }
  return plan;
}

export async function applyPlan(q: Queryable, actor: Actor, kind: EntityKind, id: number, plan: Plan, only: string[] | undefined, jobId: number, onLead?: () => Promise<void>): Promise<{ applied: PlanItem[] }> {
  const chosen = plan.fills.filter((f) => !only || only.includes(f.field));
  if (!chosen.length) return { applied: [] };
  const table = kind === "lead" ? "sales_leads" : "sales_accounts";
  const sets: string[] = [], p: unknown[] = [id];
  for (const f of chosen) {
    p.push(f.column === "tags" ? f.value.split(",").map((x) => x.trim()).filter(Boolean) : f.value);
    // the WHERE clause re-checks emptiness so a value typed by someone else a moment ago is never overwritten
    sets.push(f.column === "tags" ? `tags = CASE WHEN cardinality(tags) = 0 THEN $${p.length}::text[] ELSE tags END` : `${f.column} = CASE WHEN ${f.column} IS NULL OR btrim(${f.column}) = '' THEN $${p.length} ELSE ${f.column} END`);
  }
  await q.query(`UPDATE ${table} SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, p);
  for (const f of chosen) await q.query("INSERT INTO sales_autofill_decisions (job_id, field, proposed, previous, action, decided_by) VALUES ($1,$2,$3,NULL,'applied',$4)", [jobId, f.field, f.value, actor.label]);
  await audit(q, actor, { action: "research.apply", entityType: kind, entityId: id, summary: `Filled ${chosen.length} empty field(s) from public-web research (job ${jobId})`, after: Object.fromEntries(chosen.map((f) => [f.column, f.value])) });
  if (kind === "lead" && onLead) await onLead();
  return { applied: chosen };
}
