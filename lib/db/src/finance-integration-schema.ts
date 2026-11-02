/**
 * CINTEXA Financial Integration schema (Phase 2).
 *
 * Shared event log and party linkage between Sales Management and CINTEXA Finance.
 * All statements are idempotent and do not alter existing sales_* or finance_* tables.
 */
const T = (name: string, body: string) => `CREATE TABLE IF NOT EXISTS ${name} (\n${body}\n)`;
const IX = (sql: string) => `CREATE INDEX IF NOT EXISTS ${sql}`;
const UX = (sql: string) => `CREATE UNIQUE INDEX IF NOT EXISTS ${sql}`;
const TS = "TIMESTAMPTZ";

export const FINANCE_INTEGRATION_STATEMENTS: string[] = [
  // Durable cross-module event log. Source of truth for what was attempted and whether it succeeded.
  T("finance_integration_events", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','skipped','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  result_ref TEXT,
  result_payload JSONB,
  idempotency_key TEXT NOT NULL,
  processed_at ${TS},
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()`),
  UX("finance_integration_events_idem ON finance_integration_events (idempotency_key)"),
  IX("finance_integration_events_status ON finance_integration_events (status, created_at)"),
  IX("finance_integration_events_source ON finance_integration_events (source_module, source_entity_type, source_entity_id)"),
  IX("finance_integration_events_org ON finance_integration_events (org_id, event_type, created_at DESC)"),

  // Maps Sales accounts (CRM) to Finance customers so the same commercial party does not produce divergent masters.
  T("finance_party_links", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  sales_account_id INTEGER NOT NULL,
  finance_customer_id BIGINT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'customer' CHECK (link_type IN ('customer','supplier')),
  match_method TEXT NOT NULL DEFAULT 'auto' CHECK (match_method IN ('auto','manual','code','email')),
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now(),
  UNIQUE (org_id, sales_account_id, link_type)`),
  IX("finance_party_links_fin_cust ON finance_party_links (org_id, finance_customer_id)"),
  IX("finance_party_links_sales ON finance_party_links (sales_account_id)"),

  // Optional period reconciliation snapshot for management review (not used for posting).
  T("finance_reconciliation_runs", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed')),
  sales_order_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  sales_payment_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  finance_invoice_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  finance_receipt_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference_invoice NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference_cash NUMERIC(18,2) NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now()`),
  IX("finance_reconciliation_runs_org ON finance_reconciliation_runs (org_id, period_end DESC)"),
];
