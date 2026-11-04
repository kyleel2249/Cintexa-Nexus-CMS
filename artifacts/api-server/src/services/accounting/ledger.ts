import { createHash, randomUUID } from "node:crypto";
import type { SalesDb, SalesQueryable } from "@workspace/db";
import {
  ACCOUNT_CODE,
  DEFAULT_CHART,
  GENESIS_HASH,
  POLICY_KEYS,
  PolicyNotConfiguredError,
  buildReversalDraft,
  chainHash,
  defaultNormalBalance,
  draftFingerprint,
  fiscalYearPeriods,
  formatRate,
  isIsoDate,
  journalHash,
  normalizeDraft,
  normalizeLines,
  validateChart,
  validateJournalDraft,
  type AccountInfo,
  type AccountType,
  type IsoDate,
  type JournalDraft,
  type JournalLineInput,
  type NormalizedLine,
  type PeriodInfo,
  type PolicyRefLike,
  type ValidationIssue,
} from "@workspace/accounting-core";
import { LEDGER_LOCK_SQL, loadPolicyRegistry } from "./policy-store";

export type LedgerErrorCode =
  | "VALIDATION"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE_SOURCE"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_REVERSED"
  | "CANNOT_REVERSE_REVERSAL"
  | "PERIOD_STATE"
  | "POLICY_NOT_CONFIGURED";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  readonly issues: ValidationIssue[];
  constructor(code: LedgerErrorCode, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
    this.issues = issues;
  }
}

export interface FunctionalCurrencyResolution {
  currency: string;
  policyKey: string;
  policyVersion: number;
}
export type FunctionalCurrencyResolver = (date: IsoDate, q: SalesQueryable) => Promise<FunctionalCurrencyResolution>;

export interface LedgerOptions {
  clock?: () => Date;
  functionalCurrency?: FunctionalCurrencyResolver;
}

/** Functional currency comes from the effective-dated policy, never from a constant. */
export const policyFunctionalCurrency: FunctionalCurrencyResolver = async (date, q) => {
  const { registry } = await loadPolicyRegistry(q);
  const v = registry.resolve(POLICY_KEYS.functionalCurrency, date);
  return { currency: String(v.params.functionalCurrency), policyKey: v.key, policyVersion: v.version };
};

// ---- Record shapes (all amounts are digit strings in minor units, JSON-safe) ----------------------------------------

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  normalBalance: "debit" | "credit";
  parentCode: string | null;
  postable: boolean;
  active: boolean;
  systemRole: string | null;
  currency: string | null;
}

export interface PeriodRecord {
  id: string;
  fiscalYear: number;
  periodNo: number;
  start: string;
  end: string;
  status: "open" | "closed" | "locked";
}

export interface JournalLineRecord {
  lineNo: number;
  accountCode: string;
  accountName: string;
  debitMinor: string;
  creditMinor: string;
  memo: string | null;
  foreign: { currency: string; amountMinor: string; fxRate: string } | null;
  partyType: string | null;
  partyId: string | null;
  dimensions: Record<string, string>;
}

export interface JournalRecord {
  id: string;
  reference: string;
  entryDate: string;
  periodId: string;
  journalType: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  description: string;
  currency: string;
  totalMinor: string;
  status: "posted" | "reversed";
  reversesJournalId: string | null;
  reversedByJournalId: string | null;
  postedBy: string;
  postedAt: string;
  chainSeq: number;
  hash: string;
  policyRefs: PolicyRefLike[];
  lines: JournalLineRecord[];
  /** True when this call returned an already-posted journal for the same idempotency key. */
  replayed?: boolean;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: AccountType;
  debitMinor: string;
  creditMinor: string;
}
export interface TrialBalance {
  asOf: string;
  from: string | null;
  rows: TrialBalanceRow[];
  totalDebitMinor: string;
  totalCreditMinor: string;
  balanced: boolean;
}

export interface LedgerEntry {
  entryDate: string;
  reference: string;
  journalId: string;
  description: string;
  lineNo: number;
  debitMinor: string;
  creditMinor: string;
  memo: string | null;
  /** Running balance, debits minus credits (negative = credit balance). */
  runningMinor: string;
}

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v)));
const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoStr = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isUniqueViolation = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

export class LedgerService {
  private readonly db: SalesDb;
  private readonly clock: () => Date;
  private readonly functionalCurrency: FunctionalCurrencyResolver;

  constructor(db: SalesDb, opts: LedgerOptions = {}) {
    this.db = db;
    this.clock = opts.clock ?? (() => new Date());
    this.functionalCurrency = opts.functionalCurrency ?? policyFunctionalCurrency;
  }

  private today(): IsoDate {
    return this.clock().toISOString().slice(0, 10);
  }

  // ---- Audit (tamper-evident hash chain, written under the ledger lock) ------------------------------------------

  private async audit(q: SalesQueryable, actor: string, action: string, entityType: string, entityId: string | null, meta: Record<string, unknown>): Promise<void> {
    const last = await q.query<{ hash: string }>("SELECT hash FROM acct_audit ORDER BY id DESC LIMIT 1");
    const prev = last.rows[0]?.hash ?? GENESIS_HASH;
    const at = this.clock().toISOString();
    const metaJson = JSON.stringify(meta);
    const hash = chainHash([prev, at, actor, action, entityType, entityId, metaJson]);
    await q.query("INSERT INTO acct_audit (at, actor, action, entity_type, entity_id, meta_json, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [at, actor, action, entityType, entityId, metaJson, prev, hash]);
  }

  async verifyAuditChain(): Promise<{ ok: boolean; checked: number; firstBadId?: number }> {
    const r = await this.db.query<{ id: number; at: unknown; actor: string; action: string; entity_type: string; entity_id: string | null; meta_json: string; prev_hash: string; hash: string }>("SELECT id, at, actor, action, entity_type, entity_id, meta_json, prev_hash, hash FROM acct_audit ORDER BY id");
    let prev = GENESIS_HASH;
    for (const row of r.rows) {
      const expected = chainHash([prev, isoStr(row.at), row.actor, row.action, row.entity_type, row.entity_id, row.meta_json]);
      if (row.prev_hash !== prev || row.hash !== expected) return { ok: false, checked: r.rows.length, firstBadId: Number(row.id) };
      prev = row.hash;
    }
    return { ok: true, checked: r.rows.length };
  }

  // ---- Chart of accounts -----------------------------------------------------------------------------------------

  private toAccount(r: Record<string, unknown>): AccountRecord {
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      type: r.account_type as AccountType,
      subtype: String(r.subtype),
      normalBalance: r.normal_balance as "debit" | "credit",
      parentCode: r.parent_code === null || r.parent_code === undefined ? null : String(r.parent_code),
      postable: Boolean(r.is_postable),
      active: Boolean(r.is_active),
      systemRole: r.system_role === null || r.system_role === undefined ? null : String(r.system_role),
      currency: r.currency === null || r.currency === undefined ? null : String(r.currency),
    };
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const r = await this.db.query("SELECT * FROM acct_accounts ORDER BY code");
    return r.rows.map((x) => this.toAccount(x));
  }

  /** Idempotent: existing codes are left untouched. Returns how many accounts were added. */
  async seedChart(actor: string): Promise<number> {
    const problems = validateChart(DEFAULT_CHART);
    if (problems.length > 0) throw new LedgerError("INVALID_INPUT", `Default chart is invalid: ${problems.join("; ")}`);
    return this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      let added = 0;
      for (const s of DEFAULT_CHART) {
        const r = await q.query(
          "INSERT INTO acct_accounts (id, code, name, account_type, subtype, normal_balance, parent_code, is_postable, is_active, system_role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT (code) DO NOTHING",
          [randomUUID(), s.code, s.name, s.type, s.subtype, s.normalBalance, s.parentCode ?? null, s.postable, s.systemRole ?? null],
        );
        added += r.rowCount;
      }
      if (added > 0) await this.audit(q, actor, "chart_seeded", "chart", null, { added });
      return added;
    });
  }

  async createAccount(input: { code: string; name: string; type: AccountType; subtype: string; parentCode?: string; postable?: boolean; normalBalance?: "debit" | "credit"; currency?: string }, actor: string): Promise<AccountRecord> {
    const problems: string[] = [];
    if (!ACCOUNT_CODE.test(input.code)) problems.push("code must be 4-10 digits");
    if (!input.name?.trim()) problems.push("name is required");
    if (!["asset", "liability", "equity", "revenue", "cost_of_sales", "expense"].includes(input.type)) problems.push("type is invalid");
    if (!input.subtype?.trim()) problems.push("subtype is required");
    if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) problems.push("currency must be a 3-letter ISO code");
    if (problems.length > 0) throw new LedgerError("INVALID_INPUT", problems.join("; "));
    return this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      if (input.parentCode) {
        const p = await q.query("SELECT is_postable, account_type FROM acct_accounts WHERE code = $1", [input.parentCode]);
        const parent = p.rows[0];
        if (!parent) throw new LedgerError("INVALID_INPUT", `Parent account ${input.parentCode} does not exist`);
        if (parent.is_postable) throw new LedgerError("INVALID_INPUT", "The parent must be a header account");
        if (parent.account_type !== input.type) throw new LedgerError("INVALID_INPUT", "The parent must be of the same account type");
      }
      const id = randomUUID();
      try {
        await q.query(
          "INSERT INTO acct_accounts (id, code, name, account_type, subtype, normal_balance, parent_code, is_postable, is_active, system_role, currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NULL,$9)",
          [id, input.code, input.name.trim(), input.type, input.subtype.trim(), input.normalBalance ?? defaultNormalBalance(input.type), input.parentCode ?? null, input.postable ?? true, input.currency ?? null],
        );
      } catch (e) {
        if (isUniqueViolation(e)) throw new LedgerError("CONFLICT", `Account code ${input.code} already exists`);
        throw e;
      }
      await this.audit(q, actor, "account_created", "account", input.code, { name: input.name.trim(), type: input.type });
      const r = await q.query("SELECT * FROM acct_accounts WHERE id = $1", [id]);
      return this.toAccount(r.rows[0] as Record<string, unknown>);
    });
  }

  /** Code and type never change. An account can only be switched off when it carries no balance, and header-ness cannot change once it has postings. */
  async updateAccount(code: string, patch: { name?: string; active?: boolean }, actor: string): Promise<AccountRecord> {
    return this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      const cur = await q.query("SELECT * FROM acct_accounts WHERE code = $1", [code]);
      const acc = cur.rows[0] as Record<string, unknown> | undefined;
      if (!acc) throw new LedgerError("NOT_FOUND", `Account ${code} does not exist`);
      if (patch.name !== undefined) {
        if (!patch.name.trim()) throw new LedgerError("INVALID_INPUT", "name cannot be empty");
        await q.query("UPDATE acct_accounts SET name = $2, updated_at = now() WHERE code = $1", [code, patch.name.trim()]);
      }
      if (patch.active !== undefined && patch.active !== Boolean(acc.is_active)) {
        if (!patch.active) {
          if (acc.system_role) throw new LedgerError("CONFLICT", "System-role accounts cannot be deactivated");
          const bal = await q.query<{ n: unknown }>("SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0) AS n FROM acct_journal_lines l WHERE l.account_id = $1", [acc.id]);
          if (big(bal.rows[0]?.n ?? 0) !== 0n) throw new LedgerError("CONFLICT", "An account with a balance cannot be deactivated");
        }
        await q.query("UPDATE acct_accounts SET is_active = $2, updated_at = now() WHERE code = $1", [code, patch.active]);
      }
      await this.audit(q, actor, "account_updated", "account", code, { patch });
      const r = await q.query("SELECT * FROM acct_accounts WHERE code = $1", [code]);
      return this.toAccount(r.rows[0] as Record<string, unknown>);
    });
  }

  // ---- Periods ---------------------------------------------------------------------------------------------------

  private toPeriod(r: Record<string, unknown>): PeriodRecord {
    return { id: String(r.id), fiscalYear: Number(r.fiscal_year), periodNo: Number(r.period_no), start: dateStr(r.period_start), end: dateStr(r.period_end), status: r.status as PeriodRecord["status"] };
  }

  async listPeriods(fiscalYear?: number): Promise<PeriodRecord[]> {
    const r = fiscalYear === undefined ? await this.db.query("SELECT * FROM acct_periods ORDER BY period_start") : await this.db.query("SELECT * FROM acct_periods WHERE fiscal_year = $1 ORDER BY period_start", [fiscalYear]);
    return r.rows.map((x) => this.toPeriod(x));
  }

  /** Idempotent: an existing fiscal year is returned as is. Refuses to overlap periods that belong to another year. */
  async ensureFiscalYear(fiscalYear: number, actor: string, startMonth: number = 1): Promise<PeriodRecord[]> {
    let specs;
    try {
      specs = fiscalYearPeriods(fiscalYear, startMonth);
    } catch (e) {
      throw new LedgerError("INVALID_INPUT", (e as Error).message);
    }
    await this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      const have = await q.query("SELECT 1 FROM acct_periods WHERE fiscal_year = $1", [fiscalYear]);
      if (have.rows.length > 0) return;
      const first = specs[0];
      const last = specs[specs.length - 1];
      if (!first || !last) return;
      const overlap = await q.query("SELECT 1 FROM acct_periods WHERE period_start <= $2::date AND period_end >= $1::date", [first.start, last.end]);
      if (overlap.rows.length > 0) throw new LedgerError("CONFLICT", `Fiscal year ${fiscalYear} would overlap existing periods`);
      for (const s of specs) await q.query("INSERT INTO acct_periods (id, fiscal_year, period_no, period_start, period_end, status) VALUES ($1,$2,$3,$4,$5,'open')", [randomUUID(), s.fiscalYear, s.periodNo, s.start, s.end]);
      await this.audit(q, actor, "fiscal_year_created", "fiscal_year", String(fiscalYear), { startMonth });
    });
    return this.listPeriods(fiscalYear);
  }

  /**
   * open -> closed (earlier periods must already be closed), closed -> open (reopen, only while no later period is locked),
   * closed -> locked. A locked period only changes through a formal restatement (built in a later step).
   */
  async setPeriodStatus(periodId: string, target: "open" | "closed" | "locked", actor: string): Promise<PeriodRecord> {
    return this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      const r = await q.query("SELECT * FROM acct_periods WHERE id = $1", [periodId]);
      const p = r.rows[0] as Record<string, unknown> | undefined;
      if (!p) throw new LedgerError("NOT_FOUND", "Period not found");
      const from = String(p.status);
      if (from === target) throw new LedgerError("PERIOD_STATE", `Period is already ${from}`);
      if (from === "locked") throw new LedgerError("PERIOD_STATE", "A locked period can only be changed through a formal restatement");
      if (from === "open" && target === "locked") throw new LedgerError("PERIOD_STATE", "Close the period before locking it");
      const start = dateStr(p.period_start);
      if (target === "closed") {
        const earlier = await q.query("SELECT 1 FROM acct_periods WHERE period_start < $1::date AND status = 'open' LIMIT 1", [start]);
        if (earlier.rows.length > 0) throw new LedgerError("PERIOD_STATE", "Close earlier periods first");
        await q.query("UPDATE acct_periods SET status = 'closed', closed_at = $2, closed_by = $3 WHERE id = $1", [periodId, this.clock().toISOString(), actor]);
      } else if (target === "open") {
        const later = await q.query("SELECT 1 FROM acct_periods WHERE period_start > $1::date AND status = 'locked' LIMIT 1", [start]);
        if (later.rows.length > 0) throw new LedgerError("PERIOD_STATE", "A later period is locked; reopening this one is not allowed");
        await q.query("UPDATE acct_periods SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1", [periodId]);
      } else {
        await q.query("UPDATE acct_periods SET status = 'locked', locked_at = $2, locked_by = $3 WHERE id = $1", [periodId, this.clock().toISOString(), actor]);
      }
      await this.audit(q, actor, `period_${target}`, "period", periodId, { from, to: target, start });
      const out = await q.query("SELECT * FROM acct_periods WHERE id = $1", [periodId]);
      return this.toPeriod(out.rows[0] as Record<string, unknown>);
    });
  }

  // ---- Journals --------------------------------------------------------------------------------------------------

  private async loadJournal(q: SalesQueryable, id: string): Promise<JournalRecord | null> {
    const j = await q.query("SELECT * FROM acct_journals WHERE id = $1", [id]);
    const row = j.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const l = await q.query(
      "SELECT l.line_no, a.code, a.name, l.debit_minor, l.credit_minor, l.memo, l.original_currency, l.original_amount_minor, l.fx_rate, l.party_type, l.party_id, l.dimensions FROM acct_journal_lines l JOIN acct_accounts a ON a.id = l.account_id WHERE l.journal_id = $1 ORDER BY l.line_no",
      [id],
    );
    return {
      id: String(row.id),
      reference: String(row.reference),
      entryDate: dateStr(row.entry_date),
      periodId: String(row.period_id),
      journalType: String(row.journal_type),
      sourceType: String(row.source_type),
      sourceId: String(row.source_id),
      sourceVersion: Number(row.source_version),
      description: String(row.description),
      currency: String(row.functional_currency),
      totalMinor: String(row.total_debit_minor),
      status: row.status as "posted" | "reversed",
      reversesJournalId: row.reverses_journal_id ? String(row.reverses_journal_id) : null,
      reversedByJournalId: row.reversed_by_journal_id ? String(row.reversed_by_journal_id) : null,
      postedBy: String(row.posted_by),
      postedAt: isoStr(row.posted_at),
      chainSeq: Number(row.chain_seq),
      hash: String(row.hash),
      policyRefs: (row.policy_refs ?? []) as PolicyRefLike[],
      lines: l.rows.map((x: Record<string, unknown>) => ({
        lineNo: Number(x.line_no),
        accountCode: String(x.code),
        accountName: String(x.name),
        debitMinor: String(x.debit_minor),
        creditMinor: String(x.credit_minor),
        memo: x.memo === null || x.memo === undefined ? null : String(x.memo),
        foreign: x.original_currency ? { currency: String(x.original_currency), amountMinor: String(x.original_amount_minor), fxRate: formatRate(String(x.fx_rate)) ?? String(x.fx_rate) } : null,
        partyType: x.party_type === null || x.party_type === undefined ? null : String(x.party_type),
        partyId: x.party_id === null || x.party_id === undefined ? null : String(x.party_id),
        dimensions: (x.dimensions ?? {}) as Record<string, string>,
      })),
    };
  }

  async getJournal(id: string): Promise<JournalRecord> {
    const j = await this.loadJournal(this.db, id);
    if (!j) throw new LedgerError("NOT_FOUND", "Journal not found");
    return j;
  }

  async listJournals(f: { from?: IsoDate; to?: IsoDate; sourceType?: string; sourceId?: string; limit?: number; offset?: number } = {}): Promise<{ journals: Omit<JournalRecord, "lines">[]; limit: number; offset: number }> {
    const limit = Math.min(Math.max(Math.trunc(f.limit ?? 50), 1), 200);
    const offset = Math.max(Math.trunc(f.offset ?? 0), 0);
    for (const d of [f.from, f.to]) if (d !== undefined && !isIsoDate(d)) throw new LedgerError("INVALID_INPUT", "Dates must be YYYY-MM-DD");
    const r = await this.db.query(
      "SELECT * FROM acct_journals WHERE ($1::date IS NULL OR entry_date >= $1::date) AND ($2::date IS NULL OR entry_date <= $2::date) AND ($3::text IS NULL OR source_type = $3) AND ($4::text IS NULL OR source_id = $4) ORDER BY chain_seq DESC LIMIT $5 OFFSET $6",
      [f.from ?? null, f.to ?? null, f.sourceType ?? null, f.sourceId ?? null, limit, offset],
    );
    const journals = r.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      reference: String(row.reference),
      entryDate: dateStr(row.entry_date),
      periodId: String(row.period_id),
      journalType: String(row.journal_type),
      sourceType: String(row.source_type),
      sourceId: String(row.source_id),
      sourceVersion: Number(row.source_version),
      description: String(row.description),
      currency: String(row.functional_currency),
      totalMinor: String(row.total_debit_minor),
      status: row.status as "posted" | "reversed",
      reversesJournalId: row.reverses_journal_id ? String(row.reverses_journal_id) : null,
      reversedByJournalId: row.reversed_by_journal_id ? String(row.reversed_by_journal_id) : null,
      postedBy: String(row.posted_by),
      postedAt: isoStr(row.posted_at),
      chainSeq: Number(row.chain_seq),
      hash: String(row.hash),
      policyRefs: (row.policy_refs ?? []) as PolicyRefLike[],
    }));
    return { journals, limit, offset };
  }

  /**
   * Posts one balanced journal atomically. Validation, idempotency, period check, reference allocation, hash chaining and
   * the audit record all happen in one transaction under the ledger lock; either everything lands or nothing does.
   */
  postJournal(draft: JournalDraft, actor: string): Promise<JournalRecord> {
    return this.db.tx((q) => this.postInTx(q, draft, actor, null));
  }

  private async postInTx(q: SalesQueryable, input: JournalDraft, actor: string, reversesJournalId: string | null): Promise<JournalRecord> {
    if (!actor || !actor.trim()) throw new LedgerError("INVALID_INPUT", "actor is required");
    let d = normalizeDraft(input);
    if (!isIsoDate(d.entryDate)) throw new LedgerError("VALIDATION", "entryDate must be a valid YYYY-MM-DD date", [{ code: "INVALID_DATE", message: "entryDate must be a valid YYYY-MM-DD date" }]);

    await q.query(LEDGER_LOCK_SQL);

    let fc: FunctionalCurrencyResolution;
    try {
      fc = await this.functionalCurrency(d.entryDate, q);
    } catch (e) {
      if (e instanceof PolicyNotConfiguredError) throw new LedgerError("POLICY_NOT_CONFIGURED", e.message);
      throw e;
    }
    const refs = d.policyRefs.some((p) => p.policyKey === fc.policyKey) ? d.policyRefs : [...d.policyRefs, { policyKey: fc.policyKey, policyVersion: fc.policyVersion }];
    d = { ...d, currency: d.currency || fc.currency, policyRefs: refs };

    const fingerprint = draftFingerprint(d);
    const existing = await q.query<{ id: string; content_hash: string }>("SELECT id, content_hash FROM acct_journals WHERE idempotency_key = $1", [d.idempotencyKey]);
    const prior = existing.rows[0];
    if (prior) {
      if (prior.content_hash !== fingerprint) throw new LedgerError("IDEMPOTENCY_CONFLICT", `Idempotency key "${d.idempotencyKey}" was already used for a different journal`);
      const rec = await this.loadJournal(q, prior.id);
      if (!rec) throw new LedgerError("NOT_FOUND", "Journal not found");
      return { ...rec, replayed: true };
    }
    if (d.journalType !== "reversal") {
      const dup = await q.query<{ reference: string }>("SELECT reference FROM acct_journals WHERE source_type = $1 AND source_id = $2 AND source_version = $3 AND journal_type = $4", [d.sourceType, d.sourceId, d.sourceVersion, d.journalType]);
      if (dup.rows[0]) throw new LedgerError("DUPLICATE_SOURCE", `Source ${d.sourceType}/${d.sourceId} (version ${d.sourceVersion}) is already posted as ${dup.rows[0].reference}. Reverse it and re-post with a higher sourceVersion to correct it`);
    }

    const codes = [...new Set(d.lines.map((l) => l.accountCode))];
    const ar = await q.query<{ id: string; code: string; is_postable: boolean; is_active: boolean; currency: string | null }>("SELECT id, code, is_postable, is_active, currency FROM acct_accounts WHERE code = ANY($1::text[])", [codes]);
    const accounts = new Map<string, AccountInfo>();
    const accountIds = new Map<string, string>();
    for (const a of ar.rows) {
      accounts.set(a.code, { code: a.code, postable: Boolean(a.is_postable), active: Boolean(a.is_active), currency: a.currency ?? null });
      accountIds.set(a.code, a.id);
    }
    const pr = await q.query("SELECT id, fiscal_year, status, period_start, period_end FROM acct_periods WHERE period_start <= $1::date AND period_end >= $1::date", [d.entryDate]);
    const prow = pr.rows[0] as Record<string, unknown> | undefined;
    const period: PeriodInfo | null = prow ? { id: String(prow.id), status: prow.status as PeriodInfo["status"], start: dateStr(prow.period_start), end: dateStr(prow.period_end) } : null;

    const v = validateJournalDraft(d, { functionalCurrency: fc.currency, accounts, period });
    if (!v.ok || !prow || !period) {
      const first = v.issues[0];
      throw new LedgerError("VALIDATION", first ? `Journal rejected: ${first.message}${v.issues.length > 1 ? ` (+${v.issues.length - 1} more)` : ""}` : "Journal rejected", v.issues);
    }

    const seq = await q.query<{ last_no: number }>("INSERT INTO acct_journal_sequences (fiscal_year, last_no) VALUES ($1, 1) ON CONFLICT (fiscal_year) DO UPDATE SET last_no = acct_journal_sequences.last_no + 1 RETURNING last_no", [Number(prow.fiscal_year)]);
    const reference = `JNL-${Number(prow.fiscal_year)}-${String(seq.rows[0]?.last_no ?? 1).padStart(6, "0")}`;

    const last = await q.query<{ chain_seq: number | string; hash: string }>("SELECT chain_seq, hash FROM acct_journals ORDER BY chain_seq DESC LIMIT 1");
    const prevHash = last.rows[0]?.hash ?? GENESIS_HASH;
    const chainSeq = last.rows[0] ? Number(last.rows[0].chain_seq) + 1 : 1;

    const id = randomUUID();
    const postedAt = this.clock().toISOString();
    const lines = normalizeLines(d.lines);
    const hash = journalHash(prevHash, { reference, entryDate: d.entryDate, journalType: d.journalType, sourceType: d.sourceType, sourceId: d.sourceId, sourceVersion: d.sourceVersion, description: d.description, currency: d.currency, postedBy: actor, postedAt, reversesJournalId }, lines);

    await q.query(
      "INSERT INTO acct_journals (id, reference, entry_date, period_id, journal_type, source_type, source_id, source_version, description, functional_currency, total_debit_minor, total_credit_minor, status, idempotency_key, content_hash, reverses_journal_id, policy_refs, posted_by, posted_at, chain_seq, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'posted',$13,$14,$15,$16,$17,$18,$19,$20,$21)",
      [id, reference, d.entryDate, period.id, d.journalType, d.sourceType, d.sourceId, d.sourceVersion, d.description, d.currency, v.totalDebitMinor.toString(), v.totalCreditMinor.toString(), d.idempotencyKey, fingerprint, reversesJournalId, JSON.stringify(d.policyRefs), actor, postedAt, chainSeq, prevHash, hash],
    );
    for (const l of lines) {
      await q.query(
        "INSERT INTO acct_journal_lines (journal_id, line_no, account_id, debit_minor, credit_minor, memo, original_currency, original_amount_minor, fx_rate, party_type, party_id, dimensions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [id, l.lineNo, accountIds.get(l.accountCode), l.debitMinor.toString(), l.creditMinor.toString(), l.memo, l.foreignCurrency, l.foreignAmountMinor === null ? null : l.foreignAmountMinor.toString(), l.fxRate, l.partyType, l.partyId, JSON.stringify(l.dimensions)],
      );
    }
    await this.audit(q, actor, d.journalType === "reversal" ? "journal_reversal_posted" : "journal_posted", "journal", id, { reference, sourceType: d.sourceType, sourceId: d.sourceId, totalMinor: v.totalDebitMinor.toString() });

    const rec = await this.loadJournal(q, id);
    if (!rec) throw new LedgerError("NOT_FOUND", "Journal vanished after posting");
    return rec;
  }

  /**
   * Corrects a posted journal without ever editing it: posts a mirror entry and marks the original reversed, atomically.
   * The reversal goes into the original's period when that is still open, otherwise into today's period.
   */
  async reverseJournal(journalId: string, input: { reason: string; entryDate?: IsoDate }, actor: string): Promise<{ original: JournalRecord; reversal: JournalRecord }> {
    if (!input.reason || !input.reason.trim()) throw new LedgerError("INVALID_INPUT", "A reason is required to reverse a journal");
    if (input.entryDate !== undefined && !isIsoDate(input.entryDate)) throw new LedgerError("INVALID_INPUT", "entryDate must be a valid YYYY-MM-DD date");
    return this.db.tx(async (q) => {
      await q.query(LEDGER_LOCK_SQL);
      const orig = await this.loadJournal(q, journalId);
      if (!orig) throw new LedgerError("NOT_FOUND", "Journal not found");
      if (orig.journalType === "reversal") throw new LedgerError("CANNOT_REVERSE_REVERSAL", "A reversal cannot itself be reversed; post a new correcting journal instead");
      if (orig.status === "reversed") throw new LedgerError("ALREADY_REVERSED", `${orig.reference} has already been reversed`);

      let entryDate = input.entryDate;
      if (!entryDate) {
        const p = await q.query<{ status: string }>("SELECT status FROM acct_periods WHERE id = $1", [orig.periodId]);
        entryDate = p.rows[0]?.status === "open" ? orig.entryDate : this.today();
      }
      const lines: JournalLineInput[] = orig.lines.map((l) => ({
        accountCode: l.accountCode,
        debitMinor: big(l.debitMinor),
        creditMinor: big(l.creditMinor),
        memo: l.memo ?? undefined,
        foreign: l.foreign ? { currency: l.foreign.currency, amountMinor: big(l.foreign.amountMinor), fxRate: l.foreign.fxRate } : undefined,
        partyType: l.partyType ?? undefined,
        partyId: l.partyId ?? undefined,
        dimensions: l.dimensions,
      }));
      const draft = buildReversalDraft({ id: orig.id, reference: orig.reference, sourceType: orig.sourceType, sourceId: orig.sourceId, sourceVersion: orig.sourceVersion, currency: orig.currency, lines }, { entryDate, reason: input.reason });
      const reversal = await this.postInTx(q, draft, actor, orig.id);
      const upd = await q.query("UPDATE acct_journals SET status = 'reversed', reversed_by_journal_id = $2 WHERE id = $1 AND status = 'posted'", [orig.id, reversal.id]);
      if (upd.rowCount !== 1) throw new LedgerError("CONFLICT", "The journal changed while it was being reversed");
      await this.audit(q, actor, "journal_reversed", "journal", orig.id, { reversal: reversal.reference, reason: input.reason.trim() });
      const original = await this.loadJournal(q, orig.id);
      if (!original) throw new LedgerError("NOT_FOUND", "Journal not found");
      return { original, reversal };
    });
  }

  // ---- Reports ---------------------------------------------------------------------------------------------------

  async trialBalance(opts: { asOf?: IsoDate; from?: IsoDate; includeZero?: boolean } = {}): Promise<TrialBalance> {
    const asOf = opts.asOf ?? this.today();
    for (const d of [opts.asOf, opts.from]) if (d !== undefined && !isIsoDate(d)) throw new LedgerError("INVALID_INPUT", "Dates must be YYYY-MM-DD");
    const r = await this.db.query<{ code: string; name: string; account_type: AccountType; d: unknown; c: unknown }>(
      "SELECT a.code, a.name, a.account_type, COALESCE(t.d, 0) AS d, COALESCE(t.c, 0) AS c FROM acct_accounts a LEFT JOIN (SELECT l.account_id, SUM(l.debit_minor) AS d, SUM(l.credit_minor) AS c FROM acct_journal_lines l JOIN acct_journals j ON j.id = l.journal_id WHERE j.entry_date <= $1::date AND ($2::date IS NULL OR j.entry_date >= $2::date) GROUP BY l.account_id) t ON t.account_id = a.id ORDER BY a.code",
      [asOf, opts.from ?? null],
    );
    const rows: TrialBalanceRow[] = [];
    let totalD = 0n;
    let totalC = 0n;
    for (const x of r.rows) {
      const net = big(x.d) - big(x.c);
      if (net === 0n && !opts.includeZero) continue;
      const debit = net > 0n ? net : 0n;
      const credit = net < 0n ? -net : 0n;
      totalD += debit;
      totalC += credit;
      rows.push({ code: x.code, name: x.name, type: x.account_type, debitMinor: debit.toString(), creditMinor: credit.toString() });
    }
    return { asOf, from: opts.from ?? null, rows, totalDebitMinor: totalD.toString(), totalCreditMinor: totalC.toString(), balanced: totalD === totalC };
  }

  async accountLedger(code: string, range: { from?: IsoDate; to?: IsoDate } = {}): Promise<{ account: AccountRecord; openingMinor: string; entries: LedgerEntry[]; closingMinor: string }> {
    for (const d of [range.from, range.to]) if (d !== undefined && !isIsoDate(d)) throw new LedgerError("INVALID_INPUT", "Dates must be YYYY-MM-DD");
    const a = await this.db.query("SELECT * FROM acct_accounts WHERE code = $1", [code]);
    if (!a.rows[0]) throw new LedgerError("NOT_FOUND", `Account ${code} does not exist`);
    const account = this.toAccount(a.rows[0] as Record<string, unknown>);
    let running = 0n;
    if (range.from) {
      const o = await this.db.query<{ n: unknown }>("SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0) AS n FROM acct_journal_lines l JOIN acct_journals j ON j.id = l.journal_id WHERE l.account_id = $1 AND j.entry_date < $2::date", [account.id, range.from]);
      running = big(o.rows[0]?.n ?? 0);
    }
    const opening = running;
    const r = await this.db.query(
      "SELECT j.entry_date, j.reference, j.id AS journal_id, j.description, l.line_no, l.debit_minor, l.credit_minor, l.memo FROM acct_journal_lines l JOIN acct_journals j ON j.id = l.journal_id WHERE l.account_id = $1 AND ($2::date IS NULL OR j.entry_date >= $2::date) AND ($3::date IS NULL OR j.entry_date <= $3::date) ORDER BY j.entry_date, j.chain_seq, l.line_no",
      [account.id, range.from ?? null, range.to ?? null],
    );
    const entries: LedgerEntry[] = r.rows.map((x: Record<string, unknown>) => {
      running += big(x.debit_minor) - big(x.credit_minor);
      return { entryDate: dateStr(x.entry_date), reference: String(x.reference), journalId: String(x.journal_id), description: String(x.description), lineNo: Number(x.line_no), debitMinor: String(x.debit_minor), creditMinor: String(x.credit_minor), memo: x.memo === null || x.memo === undefined ? null : String(x.memo), runningMinor: running.toString() };
    });
    return { account, openingMinor: opening.toString(), entries, closingMinor: running.toString() };
  }

  /** Recomputes every journal hash from the stored rows. Any edited figure, removed journal or reordered entry is detected. */
  async verifyChain(): Promise<{ ok: boolean; checked: number; firstBadSeq?: number; reason?: string }> {
    const js = await this.db.query<Record<string, unknown>>("SELECT * FROM acct_journals ORDER BY chain_seq");
    const ls = await this.db.query<Record<string, unknown>>("SELECT l.journal_id, l.line_no, a.code, l.debit_minor, l.credit_minor, l.memo, l.original_currency, l.original_amount_minor, l.fx_rate, l.party_type, l.party_id, l.dimensions FROM acct_journal_lines l JOIN acct_accounts a ON a.id = l.account_id ORDER BY l.journal_id, l.line_no");
    const byJournal = new Map<string, NormalizedLine[]>();
    for (const x of ls.rows) {
      const key = String(x.journal_id);
      const list = byJournal.get(key) ?? [];
      list.push({
        lineNo: Number(x.line_no),
        accountCode: String(x.code),
        debitMinor: big(x.debit_minor),
        creditMinor: big(x.credit_minor),
        memo: x.memo === null || x.memo === undefined ? null : String(x.memo),
        foreignCurrency: x.original_currency ? String(x.original_currency) : null,
        foreignAmountMinor: x.original_amount_minor === null || x.original_amount_minor === undefined ? null : big(x.original_amount_minor),
        fxRate: x.fx_rate === null || x.fx_rate === undefined ? null : (formatRate(String(x.fx_rate)) ?? String(x.fx_rate)),
        partyType: x.party_type === null || x.party_type === undefined ? null : String(x.party_type),
        partyId: x.party_id === null || x.party_id === undefined ? null : String(x.party_id),
        dimensions: (x.dimensions ?? {}) as Record<string, string>,
      });
      byJournal.set(key, list);
    }
    let prev = GENESIS_HASH;
    let n = 0;
    for (const j of js.rows) {
      n += 1;
      const seq = Number(j.chain_seq);
      const lines = byJournal.get(String(j.id)) ?? [];
      const bad = (reason: string) => ({ ok: false, checked: js.rows.length, firstBadSeq: seq, reason });
      if (seq !== n) return bad("Gap or reordering in the chain sequence");
      if (String(j.prev_hash) !== prev) return bad("Previous-hash link is broken");
      const dr = lines.reduce((s, l) => s + l.debitMinor, 0n);
      const cr = lines.reduce((s, l) => s + l.creditMinor, 0n);
      if (dr !== cr || dr !== big(j.total_debit_minor) || cr !== big(j.total_credit_minor)) return bad("Lines do not balance or do not match the journal header");
      const expected = journalHash(prev, { reference: String(j.reference), entryDate: dateStr(j.entry_date), journalType: String(j.journal_type), sourceType: String(j.source_type), sourceId: String(j.source_id), sourceVersion: Number(j.source_version), description: String(j.description), currency: String(j.functional_currency), postedBy: String(j.posted_by), postedAt: isoStr(j.posted_at), reversesJournalId: j.reverses_journal_id ? String(j.reverses_journal_id) : null }, lines);
      if (String(j.hash) !== expected) return bad("Journal content does not match its recorded hash");
      prev = String(j.hash);
    }
    return { ok: true, checked: js.rows.length };
  }
}

export { createHash as _createHashForTests };
