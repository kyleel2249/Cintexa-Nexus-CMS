/**
 * CINTEXA FINANCE schema - Phases 2-3 (organisations, chart of accounts, double-entry journals, ledger, periods).
 *
 * Same contract as sales-schema.ts / bootstrap.ts: every statement is idempotent so it runs on each API boot and
 * against an existing database. All tables are prefixed `finance_` and none of the existing Sales or CMS tables
 * are touched.
 *
 * Integrity rules enforced IN THE DATABASE (not only in application code):
 *  - money is NUMERIC(18,2); no floating point anywhere
 *  - tenant isolation: every child row carries org_id and references its parent through a composite
 *    (org_id, id) foreign key, so a row can never point at another organisation's record
 *  - a journal can only become `posted` when it has >= 2 lines and total debits = total credits
 *  - posted journals and their lines are immutable (only `reversed_by` may be set once)
 *  - ledger entries and audit events are append-only
 *  - nothing can be posted into a hard-closed period
 */
const T = (name: string, body: string) => `CREATE TABLE IF NOT EXISTS ${name} (\n${body}\n)`;
const IX = (sql: string) => `CREATE INDEX IF NOT EXISTS ${sql}`;
const UX = (sql: string) => `CREATE UNIQUE INDEX IF NOT EXISTS ${sql}`;
const MONEY = "NUMERIC(18,2)";
const TS = "TIMESTAMPTZ";
const TRG = (name: string, table: string, timing: string, fn: string) =>
  `DO $$ BEGIN\n  CREATE TRIGGER ${name} ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();\nEXCEPTION WHEN duplicate_object THEN NULL; END $$`;

export const FINANCE_SCHEMA_STATEMENTS: string[] = [
  T("finance_organisations", `  id BIGSERIAL PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trading_name TEXT,
  registration_number TEXT,
  tax_id TEXT,
  country CHAR(2) NOT NULL DEFAULT 'GH',
  functional_currency CHAR(3) NOT NULL DEFAULT 'GHS',
  timezone TEXT NOT NULL DEFAULT 'Africa/Accra',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  accounting_method TEXT NOT NULL DEFAULT 'accrual' CHECK (accounting_method IN ('accrual','cash')),
  accounting_framework TEXT NOT NULL DEFAULT 'ifrs_sme' CHECK (accounting_framework IN ('ifrs','ifrs_sme','gaap_local')),
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  branding JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  archived_at ${TS},
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()`),

  T("finance_members", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  user_sub TEXT,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()`),
  UX("finance_members_org_email_uq ON finance_members (org_id, lower(email))"),
  IX("finance_members_sub_ix ON finance_members (user_sub)"),

  T("finance_fiscal_years", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closing_journal_id BIGINT,
  closed_by TEXT,
  closed_at ${TS},
  created_at ${TS} NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  UNIQUE (org_id, id),
  UNIQUE (org_id, name)`),

  T("finance_periods", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  fiscal_year_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','soft_closed','hard_closed')),
  status_changed_by TEXT,
  status_changed_at ${TS},
  created_at ${TS} NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (org_id, id),
  UNIQUE (org_id, start_date),
  FOREIGN KEY (org_id, fiscal_year_id) REFERENCES finance_fiscal_years (org_id, id)`),

  T("finance_accounts", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  category TEXT NOT NULL,
  subtype TEXT,
  parent_id BIGINT,
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
  currency CHAR(3),
  allow_posting BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  fs_mapping TEXT,
  description TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, code),
  FOREIGN KEY (org_id, parent_id) REFERENCES finance_accounts (org_id, id),
  CHECK ((type IN ('asset','expense') AND normal_balance = 'debit') OR (type IN ('liability','equity','revenue') AND normal_balance = 'credit') OR subtype LIKE 'contra%')`),
  IX("finance_accounts_parent_ix ON finance_accounts (org_id, parent_id)"),

  T("finance_journals", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  reference TEXT NOT NULL,
  journal_type TEXT NOT NULL DEFAULT 'manual' CHECK (journal_type IN ('manual','automated','recurring','adjustment','accrual','prepayment','reclassification','reversal','opening','closing')),
  entry_date DATE NOT NULL,
  period_id BIGINT NOT NULL,
  description TEXT NOT NULL,
  source_module TEXT,
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','rejected')),
  created_by TEXT NOT NULL,
  created_by_label TEXT,
  approved_by TEXT,
  approved_by_label TEXT,
  approved_at ${TS},
  posted_by TEXT,
  posted_by_label TEXT,
  posted_at ${TS},
  rejection_reason TEXT,
  reversal_of BIGINT,
  reversed_by BIGINT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, reference),
  FOREIGN KEY (org_id, period_id) REFERENCES finance_periods (org_id, id),
  FOREIGN KEY (org_id, reversal_of) REFERENCES finance_journals (org_id, id),
  FOREIGN KEY (org_id, reversed_by) REFERENCES finance_journals (org_id, id),
  CHECK (source_ref IS NULL OR source_module IS NOT NULL)`),
  // one journal per source document (idempotent automated posting); reversals never carry a source ref
  UX("finance_journals_source_uq ON finance_journals (org_id, source_module, source_ref) WHERE source_ref IS NOT NULL AND journal_type <> 'reversal'"),
  IX("finance_journals_date_ix ON finance_journals (org_id, entry_date DESC, id DESC)"),
  IX("finance_journals_status_ix ON finance_journals (org_id, status)"),

  T("finance_journal_lines", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  journal_id BIGINT NOT NULL,
  line_no INTEGER NOT NULL,
  account_id BIGINT NOT NULL,
  description TEXT,
  debit ${MONEY} NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit ${MONEY} NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency CHAR(3),
  fx_rate NUMERIC(18,8),
  foreign_amount ${MONEY},
  department TEXT,
  cost_centre TEXT,
  project TEXT,
  UNIQUE (journal_id, line_no),
  CHECK ((debit > 0) <> (credit > 0)),
  FOREIGN KEY (org_id, journal_id) REFERENCES finance_journals (org_id, id),
  FOREIGN KEY (org_id, account_id) REFERENCES finance_accounts (org_id, id)`),
  IX("finance_journal_lines_acct_ix ON finance_journal_lines (org_id, account_id)"),

  T("finance_ledger_entries", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  journal_id BIGINT NOT NULL,
  journal_line_id BIGINT NOT NULL REFERENCES finance_journal_lines(id),
  account_id BIGINT NOT NULL,
  period_id BIGINT NOT NULL,
  entry_date DATE NOT NULL,
  journal_type TEXT NOT NULL,
  reference TEXT NOT NULL,
  description TEXT,
  debit ${MONEY} NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit ${MONEY} NOT NULL DEFAULT 0 CHECK (credit >= 0),
  posted_at ${TS} NOT NULL DEFAULT now(),
  UNIQUE (journal_line_id),
  FOREIGN KEY (org_id, journal_id) REFERENCES finance_journals (org_id, id),
  FOREIGN KEY (org_id, account_id) REFERENCES finance_accounts (org_id, id),
  FOREIGN KEY (org_id, period_id) REFERENCES finance_periods (org_id, id)`),
  IX("finance_ledger_acct_date_ix ON finance_ledger_entries (org_id, account_id, entry_date, id)"),
  IX("finance_ledger_period_ix ON finance_ledger_entries (org_id, period_id)"),

  T("finance_audit_events", `  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT,
  seq BIGINT NOT NULL,
  at ${TS} NOT NULL DEFAULT now(),
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  source_module TEXT NOT NULL DEFAULT 'finance',
  summary TEXT,
  before JSONB,
  after JSONB,
  request_id TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL`),
  UX("finance_audit_org_seq_uq ON finance_audit_events ((COALESCE(org_id, 0)), seq)"),

  T("finance_idempotency_keys", `  org_id BIGINT NOT NULL,
  actor TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response JSONB,
  created_at ${TS} NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, actor, scope, key)`),

  T("finance_number_sequences", `  org_id BIGINT NOT NULL REFERENCES finance_organisations(id),
  key TEXT NOT NULL,
  next_value BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, key)`),

  // ───────────────────────── integrity triggers ─────────────────────────
  `CREATE OR REPLACE FUNCTION finance_journal_guard() RETURNS trigger AS $$
DECLARE d NUMERIC; c NUMERIC; n INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN RAISE EXCEPTION 'Posted journals cannot be deleted; post a reversal instead'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.journal_type IS DISTINCT FROM OLD.journal_type
       OR NEW.entry_date IS DISTINCT FROM OLD.entry_date OR NEW.period_id IS DISTINCT FROM OLD.period_id OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.source_module IS DISTINCT FROM OLD.source_module OR NEW.source_ref IS DISTINCT FROM OLD.source_ref OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.posted_by IS DISTINCT FROM OLD.posted_by OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.reversal_of IS DISTINCT FROM OLD.reversal_of OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR (OLD.reversed_by IS NOT NULL AND NEW.reversed_by IS DISTINCT FROM OLD.reversed_by) THEN
      RAISE EXCEPTION 'Posted journals are immutable; post a reversal or adjustment instead';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'posted' THEN
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n FROM finance_journal_lines WHERE journal_id = NEW.id;
    IF n < 2 THEN RAISE EXCEPTION 'A journal needs at least two lines to post'; END IF;
    IF d <> c OR d = 0 THEN RAISE EXCEPTION 'Journal is not balanced: debits % credits %', d, c; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql`,
  TRG("finance_journal_guard_trg", "finance_journals", "BEFORE UPDATE OR DELETE", "finance_journal_guard"),

  `CREATE OR REPLACE FUNCTION finance_line_guard() RETURNS trigger AS $$
DECLARE st TEXT; jid BIGINT;
BEGIN
  jid := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_id ELSE NEW.journal_id END;
  SELECT status INTO st FROM finance_journals WHERE id = jid;
  IF st = 'posted' THEN RAISE EXCEPTION 'Lines of a posted journal cannot be changed'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql`,
  TRG("finance_line_guard_trg", "finance_journal_lines", "BEFORE INSERT OR UPDATE OR DELETE", "finance_line_guard"),

  `CREATE OR REPLACE FUNCTION finance_ledger_guard() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'finance_ledger_entries is append-only'; END IF;
  SELECT status INTO st FROM finance_periods WHERE id = NEW.period_id AND org_id = NEW.org_id;
  IF st = 'hard_closed' THEN RAISE EXCEPTION 'The accounting period is hard-closed; nothing can be posted into it'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql`,
  TRG("finance_ledger_guard_trg", "finance_ledger_entries", "BEFORE INSERT OR UPDATE OR DELETE", "finance_ledger_guard"),

  `CREATE OR REPLACE FUNCTION finance_audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'finance_audit_events is append-only'; END; $$ LANGUAGE plpgsql`,
  TRG("finance_audit_no_update", "finance_audit_events", "BEFORE UPDATE OR DELETE", "finance_audit_immutable"),

  `CREATE OR REPLACE FUNCTION finance_account_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW.type IS DISTINCT FROM OLD.type OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance OR NEW.code IS DISTINCT FROM OLD.code)
     AND EXISTS (SELECT 1 FROM finance_ledger_entries WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'An account with posted activity cannot change its code, type or normal balance';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql`,
  TRG("finance_account_guard_trg", "finance_accounts", "BEFORE UPDATE", "finance_account_guard"),
];
