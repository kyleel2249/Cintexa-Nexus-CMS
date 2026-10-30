/** Durable research jobs: queued -> researching -> extracting -> validating -> awaiting_review -> completed (or failed / cancelled). State lives in the database, so a refresh or restart never loses a job. */
import type { Db, Queryable } from "../core/types";
import { researchCompany, normaliseWebsite, registrable, Cancelled, ResearchError, type ResearchInput, type ResearchResult } from "./engine";
import { configuredProviders, type SearchProvider } from "./search";
import type { FetchFn } from "./fetcher";
import { createHash } from "node:crypto";

export const LIMITS = () => ({
  enabled: process.env.SALES_RESEARCH_ENABLED !== "false",
  perMemberPerHour: Math.max(1, Number(process.env.SALES_RESEARCH_MAX_PER_HOUR ?? 20)),
  concurrent: Math.max(1, Number(process.env.SALES_RESEARCH_MAX_CONCURRENT ?? 3)),
  maxPages: Math.min(12, Math.max(1, Number(process.env.SALES_RESEARCH_MAX_PAGES ?? 6))),
  cacheHours: Math.max(0, Number(process.env.SALES_RESEARCH_CACHE_HOURS ?? 24)),
  staleMinutes: 5,
});
export interface Runtime { providers?: SearchProvider[]; fetchFn?: FetchFn; resolve?: import("@workspace/intelligence/ssrf").Resolver; now?: () => Date }

export function cacheKeyOf(input: ResearchInput): string {
  const site = normaliseWebsite(input);
  return createHash("sha256").update(site ? `site:${registrable(site.hostname)}${site.pathname}` : `name:${(input.companyName ?? "").trim().toLowerCase()}|${(input.country ?? "").trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

export async function enqueue(q: Queryable, p: { input: ResearchInput; kind?: string; entityType?: string | null; entityId?: number | null; memberId: number; label: string; now: Date; force?: boolean }): Promise<{ id: number; cached: boolean; created: boolean }> {
  const L = LIMITS();
  const cacheKey = cacheKeyOf(p.input);
  if (!p.force && L.cacheHours > 0) {
    const hit = (await q.query<{ id: number }>("SELECT id FROM sales_research_jobs WHERE cache_key = $1 AND status IN ('awaiting_review','completed') AND finished_at > $2::timestamptz - ($3 || ' hours')::interval ORDER BY finished_at DESC LIMIT 1", [cacheKey, p.now.toISOString(), String(L.cacheHours)])).rows[0];
    if (hit) return { id: hit.id, cached: true, created: false };
  }
  const idem = `${p.memberId}:${cacheKey}:${Math.floor(p.now.getTime() / 60_000)}${p.force ? ":f" : ""}`;
  const ins = await q.query<{ id: number }>("INSERT INTO sales_research_jobs (kind, entity_type, entity_id, input, idempotency_key, cache_key, created_by, created_by_member) VALUES ($1,$2,$3,$4::text::jsonb,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id", [p.kind ?? "company", p.entityType ?? null, p.entityId ?? null, JSON.stringify(p.input), idem, cacheKey, p.label, p.memberId || null]);
  if (ins.rows[0]) return { id: ins.rows[0].id, cached: false, created: true };
  const ex = (await q.query<{ id: number }>("SELECT id FROM sales_research_jobs WHERE idempotency_key = $1", [idem])).rows[0]!;
  return { id: ex.id, cached: false, created: false };
}

/** Claim and run a queued job. Safe to call from several instances: only one wins the atomic claim. Never throws. */
export async function runJob(db: Db, id: number, rt: Runtime = {}): Promise<void> {
  const now = rt.now ?? (() => new Date());
  const claim = (await db.query<{ input: ResearchInput; attempts: number }>("UPDATE sales_research_jobs SET status = 'researching', started_at = now(), attempts = attempts + 1, progress = 2, stage_detail = 'Starting' WHERE id = $1 AND status = 'queued' RETURNING input, attempts", [id])).rows[0];
  if (!claim) return;
  const L = LIMITS();
  const stage = async (status: string, progress: number, detail: string) => { await db.query("UPDATE sales_research_jobs SET status = $2, progress = $3, stage_detail = $4 WHERE id = $1 AND status NOT IN ('cancelled','failed')", [id, status, progress, detail]); };
  try {
    const result: ResearchResult = await researchCompany(claim.input, {
      onStage: (s, p, d) => stage(s, p, d),
      isCancelled: async () => (await db.query<{ c: boolean }>("SELECT cancel_requested c FROM sales_research_jobs WHERE id = $1", [id])).rows[0]?.c === true,
    }, { fetchFn: rt.fetchFn, resolve: rt.resolve, providers: rt.providers ?? configuredProviders(), maxPages: L.maxPages, now });
    await db.tx(async (q) => {
      for (const p of result.proposals) {
        await q.query("INSERT INTO sales_research_evidence (job_id, field, value, kind, source_url, source_title, source_domain, excerpt, retrieved_at, confidence, confidence_basis, verification, conflict) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text::jsonb,$12,$13::text::jsonb)", [id, p.field, p.value, p.kind, p.sourceUrl, p.sourceTitle, p.sourceDomain, p.excerpt, p.retrievedAt, p.confidence, JSON.stringify(p.confidenceBasis), p.verification, p.conflict ? JSON.stringify(p.conflict) : null]);
      }
      const useful = result.proposals.some((p) => !["website", "domain", "source_note"].includes(p.field));
      await q.query("UPDATE sales_research_jobs SET status = $2, progress = 100, stage_detail = $3, result = $4::text::jsonb, pages_fetched = $5, finished_at = now() WHERE id = $1 AND status NOT IN ('cancelled')", [id, useful ? "awaiting_review" : "partial", useful ? "Ready for your review" : "Little public information was found", JSON.stringify({ seoAeo: result.seoAeo, hypotheses: result.hypotheses, sources: result.sources, skipped: result.skipped, warnings: result.warnings, websiteDiscovery: result.websiteDiscovery, method: result.method }), result.sources.length]);
    });
  } catch (e) {
    if (e instanceof Cancelled) { await db.query("UPDATE sales_research_jobs SET status = 'cancelled', stage_detail = 'Cancelled', finished_at = now() WHERE id = $1", [id]); return; }
    const code = e instanceof ResearchError ? e.code : "research_failed";
    const msg = e instanceof Error ? e.message.slice(0, 500) : "Research failed";
    await db.query("UPDATE sales_research_jobs SET status = 'failed', error = $2, error_code = $3, stage_detail = 'Failed', finished_at = now() WHERE id = $1", [id, msg, code]).catch(() => undefined);
  }
}

/** Fire-and-forget start used by the API; concurrency is capped by the database state, not by memory. */
export function startInBackground(db: Db, id: number, rt?: Runtime): void { setImmediate(() => { runJob(db, id, rt).catch(() => undefined); }); }

/** Jobs stuck mid-run (process restart) are marked failed with a clear message so the person can re-run; nothing is silently lost. */
export async function recoverStale(q: Queryable): Promise<number> {
  const L = LIMITS();
  const r = await q.query("UPDATE sales_research_jobs SET status = 'failed', error = 'The research was interrupted (server restart or timeout). Run it again.', error_code = 'interrupted', finished_at = now() WHERE status IN ('researching','extracting','validating','applying') AND started_at < now() - ($1 || ' minutes')::interval", [String(L.staleMinutes)]);
  return r.rowCount;
}
