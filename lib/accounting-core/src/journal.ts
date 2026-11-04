import { createHash } from "node:crypto";
import { isIsoDate, parseDecimalScaled, type IsoDate } from "./decimal";

export const RATE_SCALE = 10;
export const RATE_FACTOR = 10n ** 10n;
/** Keeps every SUM() of line amounts inside a signed 64-bit BIGINT column. */
export const MAX_MINOR = 9_000_000_000_000_000_000n;
export const GENESIS_HASH = "0".repeat(64);

export type JournalType = "standard" | "adjusting" | "opening" | "closing" | "reversal";

export interface ForeignDetail {
  currency: string;
  /** Amount in the foreign currency, minor units, positive. */
  amountMinor: bigint;
  /** Functional units per one foreign unit, plain decimal string, up to 10 dp. */
  fxRate: string;
}

export interface JournalLineInput {
  accountCode: string;
  /** Functional-currency amounts in minor units (pesewas). Exactly one of the two must be positive. */
  debitMinor?: bigint;
  creditMinor?: bigint;
  memo?: string;
  foreign?: ForeignDetail;
  partyType?: string;
  partyId?: string;
  dimensions?: Record<string, string>;
}

export interface PolicyRefLike {
  policyKey: string;
  policyVersion: number;
}

export interface JournalDraft {
  entryDate: IsoDate;
  journalType?: JournalType;
  /** The business transaction this journal records, e.g. ("sales_invoice", "INV-0042"). Required on every journal. */
  sourceType: string;
  sourceId: string;
  /** Bumped when a corrected source is re-posted after a reversal. */
  sourceVersion?: number;
  description: string;
  /** Functional currency. May be omitted; the ledger fills it from the functional-currency policy. */
  currency?: string;
  idempotencyKey?: string;
  lines: JournalLineInput[];
  policyRefs?: PolicyRefLike[];
}

export interface NormalizedDraft {
  entryDate: IsoDate;
  journalType: JournalType;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  description: string;
  currency: string;
  idempotencyKey: string;
  lines: JournalLineInput[];
  policyRefs: PolicyRefLike[];
}

export function normalizeDraft(d: JournalDraft): NormalizedDraft {
  const journalType = d.journalType ?? "standard";
  const sourceVersion = d.sourceVersion ?? 1;
  const sourceType = (d.sourceType ?? "").trim();
  const sourceId = String(d.sourceId ?? "").trim();
  const supplied = d.idempotencyKey?.trim();
  return {
    entryDate: d.entryDate,
    journalType,
    sourceType,
    sourceId,
    sourceVersion,
    description: (d.description ?? "").trim(),
    currency: (d.currency ?? "").trim(),
    idempotencyKey: supplied ? supplied : `${sourceType}:${sourceId}:v${sourceVersion}:${journalType}`,
    lines: d.lines ?? [],
    policyRefs: d.policyRefs ?? [],
  };
}

export interface AccountInfo {
  code: string;
  postable: boolean;
  active: boolean;
  /** Set when the account is held in one specific foreign currency. */
  currency: string | null;
}

export interface PeriodInfo {
  id: string;
  status: "open" | "closed" | "locked";
  start: IsoDate;
  end: IsoDate;
}

export interface ValidationIssue {
  code: string;
  message: string;
  line?: number;
}

export interface JournalValidationContext {
  functionalCurrency: string;
  accounts: ReadonlyMap<string, AccountInfo>;
  period: PeriodInfo | null;
}

export interface JournalValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
}

const CURRENCY = /^[A-Z]{3}$/;

/** Pure validation of a journal before it is posted. The database enforces the same invariants again as a second line of defence. */
export function validateJournalDraft(d: NormalizedDraft, ctx: JournalValidationContext): JournalValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, line?: number): void => {
    issues.push(line === undefined ? { code, message } : { code, message, line });
  };

  if (!isIsoDate(d.entryDate)) add("INVALID_DATE", "entryDate must be a valid YYYY-MM-DD date");
  if (!d.sourceType || !d.sourceId) add("MISSING_SOURCE", "Every journal must identify its source transaction (sourceType and sourceId)");
  if (!Number.isInteger(d.sourceVersion) || d.sourceVersion < 1) add("INVALID_SOURCE_VERSION", "sourceVersion must be a whole number of at least 1");
  if (!d.description) add("MISSING_DESCRIPTION", "A description is required");
  else if (d.description.length > 500) add("DESCRIPTION_TOO_LONG", "Description is limited to 500 characters");
  if (d.currency !== ctx.functionalCurrency) add("CURRENCY_MISMATCH", `Journals are kept in the functional currency (${ctx.functionalCurrency}); got "${d.currency}". Put foreign amounts on the line's foreign detail`);
  if (d.lines.length < 2) add("TOO_FEW_LINES", "A journal needs at least two lines");
  if (d.lines.length > 500) add("TOO_MANY_LINES", "A journal is limited to 500 lines");

  let debits = 0n;
  let credits = 0n;
  d.lines.forEach((l, i) => {
    const n = i + 1;
    const debit = l.debitMinor ?? 0n;
    const credit = l.creditMinor ?? 0n;
    if (debit < 0n || credit < 0n) add("NEGATIVE_AMOUNT", "Amounts cannot be negative; use the opposite side instead", n);
    else if (debit > 0n === credit > 0n) add("LINE_SIDE", "Each line must carry exactly one of a debit or a credit amount greater than zero", n);
    debits += debit;
    credits += credit;

    const acc = ctx.accounts.get(l.accountCode);
    if (!acc) add("UNKNOWN_ACCOUNT", `Account ${l.accountCode} does not exist`, n);
    else {
      if (!acc.active) add("INACTIVE_ACCOUNT", `Account ${l.accountCode} is inactive`, n);
      if (!acc.postable) add("NON_POSTABLE_ACCOUNT", `Account ${l.accountCode} is a header account and cannot be posted to`, n);
    }

    const f = l.foreign;
    if (f) {
      if (!CURRENCY.test(f.currency)) add("INVALID_FOREIGN_CURRENCY", "Foreign currency must be a 3-letter ISO code", n);
      else if (f.currency === ctx.functionalCurrency) add("FOREIGN_SAME_CURRENCY", "Foreign detail must be in a currency other than the functional currency", n);
      if (f.amountMinor <= 0n) add("INVALID_FOREIGN_AMOUNT", "Foreign amount must be greater than zero", n);
      const rate = parseDecimalScaled(f.fxRate, RATE_SCALE);
      if (rate === null || rate === 0n) add("INVALID_FX_RATE", "fxRate must be a positive plain decimal with at most 10 decimal places", n);
      else if (f.amountMinor > 0n) {
        const expected = (f.amountMinor * rate + RATE_FACTOR / 2n) / RATE_FACTOR;
        const actual = debit > 0n ? debit : credit;
        const diff = expected > actual ? expected - actual : actual - expected;
        if (diff > 1n) add("FX_AMOUNT_MISMATCH", `Foreign amount x rate gives ${expected} but the line carries ${actual}`, n);
      }
      if (acc?.currency && acc.currency !== f.currency) add("ACCOUNT_CURRENCY_MISMATCH", `Account ${l.accountCode} is held in ${acc.currency}`, n);
    } else if (acc?.currency && acc.currency !== ctx.functionalCurrency) {
      add("FOREIGN_DETAIL_REQUIRED", `Account ${l.accountCode} is held in ${acc.currency}; the line needs its foreign detail`, n);
    }
  });

  if (debits !== credits) add("UNBALANCED", `Total debits (${debits}) must equal total credits (${credits})`);
  else if (debits === 0n) add("ZERO_JOURNAL", "A journal cannot be for zero");
  if (debits > MAX_MINOR || credits > MAX_MINOR) add("AMOUNT_TOO_LARGE", "Journal total exceeds the supported maximum");

  if (!ctx.period) add("NO_PERIOD", `No accounting period covers ${d.entryDate}`);
  else if (ctx.period.status !== "open") add("PERIOD_CLOSED", `The accounting period containing ${d.entryDate} is ${ctx.period.status}; posting is not allowed`);
  else if (isIsoDate(d.entryDate) && (d.entryDate < ctx.period.start || d.entryDate > ctx.period.end)) add("DATE_OUTSIDE_PERIOD", "Entry date falls outside its accounting period");

  return { ok: issues.length === 0, issues, totalDebitMinor: debits, totalCreditMinor: credits };
}

// ---- Canonical form and hashing -----------------------------------------------------------------------------------

export interface NormalizedLine {
  lineNo: number;
  accountCode: string;
  debitMinor: bigint;
  creditMinor: bigint;
  memo: string | null;
  foreignCurrency: string | null;
  foreignAmountMinor: bigint | null;
  /** Fixed 10 dp so that the draft and the NUMERIC(24,10) column read back identically. */
  fxRate: string | null;
  partyType: string | null;
  partyId: string | null;
  dimensions: Record<string, string>;
}

/** Fixed-10-dp text for a decimal rate, or null when it is not a valid rate. */
export function formatRate(rate: string): string | null {
  const scaled = parseDecimalScaled(rate, RATE_SCALE);
  if (scaled === null) return null;
  return `${scaled / RATE_FACTOR}.${(scaled % RATE_FACTOR).toString().padStart(RATE_SCALE, "0")}`;
}

export function normalizeLines(lines: readonly JournalLineInput[]): NormalizedLine[] {
  return lines.map((l, i) => {
    const memo = l.memo?.trim();
    return {
      lineNo: i + 1,
      accountCode: l.accountCode,
      debitMinor: l.debitMinor ?? 0n,
      creditMinor: l.creditMinor ?? 0n,
      memo: memo ? memo : null,
      foreignCurrency: l.foreign ? l.foreign.currency : null,
      foreignAmountMinor: l.foreign ? l.foreign.amountMinor : null,
      fxRate: l.foreign ? (formatRate(l.foreign.fxRate) ?? l.foreign.fxRate) : null,
      partyType: l.partyType?.trim() ? l.partyType.trim() : null,
      partyId: l.partyId?.trim() ? l.partyId.trim() : null,
      dimensions: l.dimensions ?? {},
    };
  });
}

export function canonicalLines(lines: readonly NormalizedLine[]): string {
  return JSON.stringify(
    lines.map((l) => [
      l.lineNo,
      l.accountCode,
      l.debitMinor.toString(),
      l.creditMinor.toString(),
      l.memo,
      l.foreignCurrency,
      l.foreignAmountMinor === null ? null : l.foreignAmountMinor.toString(),
      l.fxRate,
      l.partyType,
      l.partyId,
      Object.keys(l.dimensions).sort().map((k) => [k, l.dimensions[k]]),
    ]),
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Identifies the content of a draft (not who posted it or when). Same key + same fingerprint = a safe replay. */
export function draftFingerprint(d: NormalizedDraft): string {
  return sha256(JSON.stringify([d.entryDate, d.journalType, d.sourceType, d.sourceId, d.sourceVersion, d.description, d.currency]) + canonicalLines(normalizeLines(d.lines)));
}

export interface HashedHeader {
  reference: string;
  entryDate: string;
  journalType: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  description: string;
  currency: string;
  postedBy: string;
  postedAt: string;
  reversesJournalId: string | null;
}

/** Hash chained to the previous journal: editing any posted figure anywhere breaks every hash after it. */
export function journalHash(prevHash: string, h: HashedHeader, lines: readonly NormalizedLine[]): string {
  const head = JSON.stringify([prevHash, h.reference, h.entryDate, h.journalType, h.sourceType, h.sourceId, h.sourceVersion, h.description, h.currency, h.postedBy, h.postedAt, h.reversesJournalId]);
  return sha256(head + canonicalLines(lines));
}

export function chainHash(parts: readonly unknown[]): string {
  return sha256(JSON.stringify(parts));
}

// ---- Reversal -----------------------------------------------------------------------------------------------------

export interface ReversalSource {
  id: string;
  reference: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  currency: string;
  lines: JournalLineInput[];
}

/** A reversal mirrors the original with debits and credits swapped; the original is never edited or deleted. */
export function buildReversalDraft(src: ReversalSource, opts: { entryDate: IsoDate; reason: string }): JournalDraft {
  return {
    entryDate: opts.entryDate,
    journalType: "reversal",
    sourceType: src.sourceType,
    sourceId: src.sourceId,
    sourceVersion: src.sourceVersion,
    description: `Reversal of ${src.reference}: ${opts.reason.trim()}`,
    currency: src.currency,
    idempotencyKey: `reversal:${src.id}`,
    lines: src.lines.map((l) => ({ ...l, debitMinor: l.creditMinor ?? 0n, creditMinor: l.debitMinor ?? 0n })),
  };
}
