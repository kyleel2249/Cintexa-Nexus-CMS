/**
 * CINTEXA Nexus accounting ledger schema. Every table is prefixed `acct_` and is entirely new: the dormant `finance_*`
 * tables are deliberately not used, referenced or migrated.
 *
 * Same contract as bootstrap.ts / sentinel-schema.ts: every statement is idempotent, so it can run on every API boot and
 * on the on-device PGlite database. Money is stored as BIGINT minor units (pesewas): never floating point.
 *
 * Integrity is enforced twice - in the posting service and here in the database:
 *  - a journal's lines must sum to its header, and debits must equal credits (deferred constraint trigger)
 *  - a journal can only be inserted into an OPEN period, dated inside that period
 *  - lines and audit rows are append-only; a posted journal can only flip posted -> reversed
 *  - one journal per (source, version, type); one reversal per journal; unique idempotency keys
 */
const TS = "TIMESTAMPTZ";

export const ACCOUNTING_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS acct_accounts (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[0-9]{4,10}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  account_type TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','cost_of_sales','expense')),
  subtype TEXT NOT NULL,
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
  parent_code TEXT REFERENCES acct_accounts(code),
  is_postable BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  system_role TEXT UNIQUE,
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  created_at ${TS} NOT NULL DEFAULT now(),
  updated_at ${TS} NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_acct_accounts_type ON acct_accounts(account_type, code)`,

  `CREATE TABLE IF NOT EXISTS acct_periods (
  id UUID PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  period_no INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  period_start DATE NOT NULL UNIQUE,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
  closed_at ${TS},
  closed_by TEXT,
  locked_at ${TS},
  locked_by TEXT,
  created_at ${TS} NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (fiscal_year, period_no)
)`,

  `CREATE TABLE IF NOT EXISTS acct_journal_sequences (
  fiscal_year INTEGER PRIMARY KEY,
  last_no INTEGER NOT NULL
)`,

  `CREATE TABLE IF NOT EXISTS acct_journals (
  id UUID PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL,
  period_id UUID NOT NULL REFERENCES acct_periods(id),
  journal_type TEXT NOT NULL DEFAULT 'standard' CHECK (journal_type IN ('standard','adjusting','opening','closing','reversal')),
  source_type TEXT NOT NULL CHECK (char_length(source_type) > 0),
  source_id TEXT NOT NULL CHECK (char_length(source_id) > 0),
  source_version INTEGER NOT NULL DEFAULT 1 CHECK (source_version >= 1),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  functional_currency TEXT NOT NULL CHECK (functional_currency ~ '^[A-Z]{3}$'),
  total_debit_minor BIGINT NOT NULL CHECK (total_debit_minor > 0),
  total_credit_minor BIGINT NOT NULL CHECK (total_credit_minor > 0),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  reverses_journal_id UUID UNIQUE REFERENCES acct_journals(id),
  reversed_by_journal_id UUID REFERENCES acct_journals(id),
  policy_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  posted_by TEXT NOT NULL,
  posted_at ${TS} NOT NULL,
  chain_seq BIGINT NOT NULL UNIQUE,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  CHECK (total_debit_minor = total_credit_minor)
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_journals_source ON acct_journals(source_type, source_id, source_version, journal_type) WHERE journal_type <> 'reversal'`,
  `CREATE INDEX IF NOT EXISTS ix_acct_journals_date ON acct_journals(entry_date, chain_seq)`,
  `CREATE INDEX IF NOT EXISTS ix_acct_journals_period ON acct_journals(period_id)`,
  `CREATE INDEX IF NOT EXISTS ix_acct_journals_source ON acct_journals(source_type, source_id)`,

  `CREATE TABLE IF NOT EXISTS acct_journal_lines (
  id BIGSERIAL PRIMARY KEY,
  journal_id UUID NOT NULL REFERENCES acct_journals(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  account_id UUID NOT NULL REFERENCES acct_accounts(id) ON DELETE RESTRICT,
  debit_minor BIGINT NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor BIGINT NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  memo TEXT,
  original_currency TEXT CHECK (original_currency IS NULL OR original_currency ~ '^[A-Z]{3}$'),
  original_amount_minor BIGINT,
  fx_rate NUMERIC(24,10),
  party_type TEXT,
  party_id TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (journal_id, line_no),
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
  CHECK ((original_currency IS NULL) = (original_amount_minor IS NULL) AND (original_currency IS NULL) = (fx_rate IS NULL))
)`,
  `CREATE INDEX IF NOT EXISTS ix_acct_lines_account ON acct_journal_lines(account_id)`,
  `CREATE INDEX IF NOT EXISTS ix_acct_lines_party ON acct_journal_lines(party_type, party_id) WHERE party_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS acct_audit (
  id BIGSERIAL PRIMARY KEY,
  at ${TS} NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS ix_acct_audit_entity ON acct_audit(entity_type, entity_id)`,

  // Policy snapshot is TEXT, not JSONB: the policy audit hash chain depends on exact key order, which JSONB does not keep.
  `CREATE TABLE IF NOT EXISTS acct_policy_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  snapshot TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at ${TS} NOT NULL DEFAULT now()
)`,

  // ---- Database-level invariants ----
  `CREATE OR REPLACE FUNCTION acct_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION acct_journal_insert_guard() RETURNS trigger AS $$
DECLARE p RECORD;
BEGIN
  SELECT status, period_start, period_end INTO p FROM acct_periods WHERE id = NEW.period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal period does not exist';
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'Accounting period is % - posting is not allowed', p.status;
  END IF;
  IF NEW.entry_date < p.period_start OR NEW.entry_date > p.period_end THEN
    RAISE EXCEPTION 'Entry date is outside its accounting period';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION acct_journal_update_guard() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'reversed_by_journal_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'reversed_by_journal_id') THEN
    RAISE EXCEPTION 'Posted journals are immutable; post a reversal instead';
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'A reversed journal cannot change again';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
  `CREATE OR REPLACE FUNCTION acct_check_journal_balance() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT; hd BIGINT; hc BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0) INTO d, c FROM acct_journal_lines WHERE journal_id = NEW.journal_id;
  SELECT total_debit_minor, total_credit_minor INTO hd, hc FROM acct_journals WHERE id = NEW.journal_id;
  IF d <> hd OR c <> hc OR d <> c THEN
    RAISE EXCEPTION 'Journal % is unbalanced or its lines do not match its header', NEW.journal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS acct_lines_immutable ON acct_journal_lines`,
  `CREATE TRIGGER acct_lines_immutable BEFORE UPDATE OR DELETE ON acct_journal_lines FOR EACH ROW EXECUTE PROCEDURE acct_block_mutation()`,
  `DROP TRIGGER IF EXISTS acct_audit_immutable ON acct_audit`,
  `CREATE TRIGGER acct_audit_immutable BEFORE UPDATE OR DELETE ON acct_audit FOR EACH ROW EXECUTE PROCEDURE acct_block_mutation()`,
  `DROP TRIGGER IF EXISTS acct_journals_no_delete ON acct_journals`,
  `CREATE TRIGGER acct_journals_no_delete BEFORE DELETE ON acct_journals FOR EACH ROW EXECUTE PROCEDURE acct_block_mutation()`,
  `DROP TRIGGER IF EXISTS acct_journals_update_guard ON acct_journals`,
  `CREATE TRIGGER acct_journals_update_guard BEFORE UPDATE ON acct_journals FOR EACH ROW EXECUTE PROCEDURE acct_journal_update_guard()`,
  `DROP TRIGGER IF EXISTS acct_journals_insert_guard ON acct_journals`,
  `CREATE TRIGGER acct_journals_insert_guard BEFORE INSERT ON acct_journals FOR EACH ROW EXECUTE PROCEDURE acct_journal_insert_guard()`,
  `DROP TRIGGER IF EXISTS acct_lines_balance ON acct_journal_lines`,
  `CREATE CONSTRAINT TRIGGER acct_lines_balance AFTER INSERT ON acct_journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE PROCEDURE acct_check_journal_balance()`,
];

let running: Promise<void> | null = null;

/** Idempotent; safe to call on every request. Retries on the next call if a statement fails. */
export function ensureAccountingSchema(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  if (!running) {
    running = (async () => {
      for (const statement of ACCOUNTING_SCHEMA_STATEMENTS) await pool.query(statement);
    })().catch((err) => {
      running = null;
      throw err;
    });
  }
  return running;
}
