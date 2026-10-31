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
  // ── one-time markers (so a data migration never re-runs after an administrator changes a setting on purpose)
  T("sales_schema_markers", `  id TEXT PRIMARY KEY,
  applied_at ${TS} NOT NULL DEFAULT now()`),
  // AI assist used to default to OFF/blocked. Installs still on that untouched default pair are switched on once; any other stored choice is left alone.
  `WITH m AS (INSERT INTO sales_schema_markers (id) VALUES ('ai_default_on_2026_10') ON CONFLICT DO NOTHING RETURNING id)
   UPDATE sales_settings SET value = jsonb_set(value, '{ai}', '{"enabled": true, "allowExternalProvider": true}'::jsonb), version = version + 1, updated_by = 'system: AI assist on by default', updated_at = now()
   WHERE key = 'integrations' AND EXISTS (SELECT 1 FROM m) AND COALESCE((value->'ai'->>'enabled')::boolean, false) = false AND COALESCE((value->'ai'->>'allowExternalProvider')::boolean, false) = false`,
  // ── exchange rates (manual entry or provider import); history is kept, rows are never overwritten
  T("sales_exchange_rates", `  id BIGSERIAL PRIMARY KEY,
  base TEXT NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  quote TEXT NOT NULL CHECK (quote ~ '^[A-Z]{3}$' AND quote <> base),
  rate NUMERIC(24,10) NOT NULL CHECK (rate > 0),
  effective_on DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  entered_by TEXT,
  note TEXT,
  created_at ${TS} NOT NULL DEFAULT now()`),
  UX("sales_exchange_rates_uniq ON sales_exchange_rates(base, quote, effective_on, source)"),
  IX("sales_exchange_rates_lookup ON sales_exchange_rates(base, quote, effective_on DESC)"),
  // ── transaction date: when the sale actually happened (may differ from created_at, the entry time)
  "ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS transaction_date DATE",
  IX("sales_orders_txn_date ON sales_orders(transaction_date)"),
];
