/**
 * Sales research & autofill schema (tables `sales_research_*`, `sales_autofill_decisions`).
 * Same contract as sales-schema.ts: idempotent, additive, run on every API boot.
 *
 *  sales_research_jobs      one row per research request (durable state: queued -> ... -> awaiting_review -> completed)
 *  sales_research_evidence  one row per proposed value, with its source URL, excerpt, confidence and verification status
 *  sales_autofill_decisions what the person did with each proposal (applied / rejected) and the value it replaced
 */
const T = (name: string, body: string) => `CREATE TABLE IF NOT EXISTS ${name} (\n${body}\n)`;
const IX = (sql: string) => `CREATE INDEX IF NOT EXISTS ${sql}`;
const UX = (sql: string) => `CREATE UNIQUE INDEX IF NOT EXISTS ${sql}`;
const TS = "TIMESTAMPTZ";

export const SALES_RESEARCH_SCHEMA_STATEMENTS: string[] = [
  T("sales_research_jobs", `  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'company' CHECK (kind IN ('company','seo_aeo','refresh')),
  entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('lead','account','contact','opportunity')),
  entity_id INTEGER,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','researching','extracting','validating','awaiting_review','applying','completed','partial','failed','cancelled')),
  stage_detail TEXT,
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result JSONB,
  error TEXT,
  error_code TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key TEXT NOT NULL,
  cache_key TEXT,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_by_member BIGINT,
  created_at ${TS} NOT NULL DEFAULT now(),
  started_at ${TS},
  finished_at ${TS}`),
  UX("sales_research_jobs_idem ON sales_research_jobs(idempotency_key)"),
  IX("sales_research_jobs_status ON sales_research_jobs(status, created_at DESC)"),
  IX("sales_research_jobs_entity ON sales_research_jobs(entity_type, entity_id)"),
  IX("sales_research_jobs_cache ON sales_research_jobs(cache_key, finished_at DESC)"),
  T("sales_research_evidence", `  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES sales_research_jobs(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact','estimate','hypothesis')),
  source_url TEXT,
  source_title TEXT,
  source_domain TEXT,
  excerpt TEXT,
  retrieved_at ${TS} NOT NULL DEFAULT now(),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  confidence_basis JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('verified','corroborated','single_source','unverified','conflicting')),
  conflict JSONB`),
  IX("sales_research_evidence_job ON sales_research_evidence(job_id, field)"),
  T("sales_autofill_decisions", `  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES sales_research_jobs(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  proposed TEXT,
  previous TEXT,
  action TEXT NOT NULL CHECK (action IN ('applied','rejected','cleared')),
  decided_by TEXT,
  decided_at ${TS} NOT NULL DEFAULT now()`),
  IX("sales_autofill_decisions_job ON sales_autofill_decisions(job_id)"),
];
