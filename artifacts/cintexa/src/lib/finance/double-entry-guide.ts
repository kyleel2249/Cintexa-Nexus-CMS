/**
 * CINTEXA Finance — double-entry guide and GAAP concept explanations.
 *
 * Pure, deterministic and offline. Every sentence is derived from the selected accounts, the side (debit or credit)
 * and the amount, so it changes the moment the user changes an account or an amount.
 *
 * Educational text only: it explains the concepts behind the entry. It is not an audit opinion or tax advice.
 */

import { formatCurrency } from "./money";

export type GuideAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type Side = "debit" | "credit";

export interface GuideLineInput {
  accountCode: string;
  accountName: string;
  type: GuideAccountType;
  subtype?: string;
  side: Side;
  /** Minor units. */
  amount: number;
}

/** Normal balance and the effect of a debit or credit, by account type. */
export const EFFECT_TABLE: Record<GuideAccountType, { normal: Side; debit: "increases" | "decreases"; credit: "increases" | "decreases"; meaning: string }> = {
  asset: { normal: "debit", debit: "increases", credit: "decreases", meaning: "Things the business owns or is owed (cash, receivables, equipment)." },
  expense: { normal: "debit", debit: "increases", credit: "decreases", meaning: "Costs of running the business in the period." },
  liability: { normal: "credit", debit: "decreases", credit: "increases", meaning: "What the business owes to others (payables, loans, deferred revenue)." },
  equity: { normal: "credit", debit: "decreases", credit: "increases", meaning: "The owners' residual claim on the assets (capital, retained earnings)." },
  revenue: { normal: "credit", debit: "decreases", credit: "increases", meaning: "Income earned from the business's activities." },
};

/** Contra accounts reverse the usual effect (for example Accumulated Depreciation is an asset with a credit balance). */
export function isContra(subtype?: string, name?: string): boolean {
  return subtype === "contra" || /accumulated depreciation|allowance for|discount allowed|sales returns/i.test(name || "");
}

export interface LineEffect {
  accountCode: string;
  accountName: string;
  side: Side;
  amount: number;
  direction: "increases" | "decreases";
  headline: string;
  explanation: string;
  statement: string;
}

const STATEMENT: Record<GuideAccountType, string> = {
  asset: "Balance Sheet (assets)",
  liability: "Balance Sheet (liabilities)",
  equity: "Balance Sheet (equity)",
  revenue: "Income Statement (revenue)",
  expense: "Income Statement (expenses)",
};

export function lineEffect(line: GuideLineInput, currency = "GHS"): LineEffect {
  const contra = isContra(line.subtype, line.accountName);
  const base = EFFECT_TABLE[line.type];
  let direction = line.side === "debit" ? base.debit : base.credit;
  if (contra) direction = direction === "increases" ? "decreases" : "increases";
  const money = formatCurrency(line.amount, currency);
  const sideWord = line.side === "debit" ? "Debit" : "Credit";
  const kind = contra ? `contra-${line.type}` : line.type;
  const headline = `${sideWord} ${money} to ${line.accountName} (${kind}) ${direction} it`;
  const why = contra
    ? `${line.accountName} offsets a related ${line.type} account, so a ${line.side} ${direction === "increases" ? "adds to" : "reduces"} the offset and the net ${line.type} moves the other way.`
    : `${capitalise(line.type)} accounts normally carry a ${base.normal} balance, so a ${line.side} ${direction === "increases" ? "adds to" : "takes away from"} the balance.`;
  return {
    accountCode: line.accountCode,
    accountName: line.accountName,
    side: line.side,
    amount: line.amount,
    direction,
    headline,
    explanation: `${why} ${base.meaning}`,
    statement: STATEMENT[line.type],
  };
}

export interface GaapConcept {
  id: string;
  name: string;
  reference: string;
  explanation: string;
}

/** Concepts from US GAAP (FASB ASC) that the entry relies on. Wording is explanatory, not a quotation of the standard. */
export const GAAP_CONCEPTS: GaapConcept[] = [
  { id: "dual-aspect", name: "Double-entry (dual aspect)", reference: "Accounting equation: Assets = Liabilities + Equity", explanation: "Every transaction has two equal sides. Total debits must equal total credits, so the accounting equation always stays in balance." },
  { id: "accrual", name: "Accrual basis", reference: "FASB Concepts Statement No. 8; ASC 105", explanation: "Income and costs are recorded when they are earned or incurred, not when cash moves." },
  { id: "revenue-recognition", name: "Revenue recognition", reference: "ASC 606", explanation: "Revenue is recognised when control of the goods or services passes to the customer, in the amount the business expects to be entitled to." },
  { id: "matching", name: "Matching principle", reference: "FASB Concepts Statement No. 6 (expense recognition)", explanation: "Costs are recorded in the same period as the revenue they helped to earn." },
  { id: "historical-cost", name: "Historical cost", reference: "ASC 360 (property, plant and equipment)", explanation: "Assets are recorded at what was paid to acquire them and made ready for use, not at today's market value." },
  { id: "depreciation", name: "Depreciation", reference: "ASC 360-10", explanation: "The cost of a long-lived asset, less any residual value, is spread over the periods that benefit from it. Cintexa policy: computers, laptops and mobile phones use 25% a year, straight-line." },
  { id: "conservatism", name: "Prudence (conservatism)", reference: "ASC 450 (contingencies)", explanation: "Where there is real uncertainty, losses are recognised early and gains are not recognised until they are realised." },
  { id: "consistency", name: "Consistency", reference: "ASC 250 (accounting changes)", explanation: "The same methods are used from period to period so results can be compared." },
  { id: "materiality", name: "Materiality", reference: "FASB Concepts Statement No. 8", explanation: "Items are treated strictly only if leaving them out or misstating them could change a reader's decision." },
  { id: "going-concern", name: "Going concern", reference: "ASC 205-40", explanation: "Statements are prepared assuming the business will keep operating, so assets are spread over their useful lives rather than valued for a quick sale." },
  { id: "full-disclosure", name: "Full disclosure", reference: "ASC 235 (notes to financial statements)", explanation: "Information a reader needs to understand the statements is recorded and explained. Every entry here keeps a memo and an audit trail for that reason." },
  { id: "receivables", name: "Receivables", reference: "ASC 310; ASC 326 (expected credit losses)", explanation: "Money customers owe is an asset. Collecting it only swaps one asset (receivable) for another (cash); it does not create new revenue." },
  { id: "payables", name: "Liabilities and accruals", reference: "ASC 405; Concepts Statement No. 6", explanation: "Obligations to pay are recorded when the cost is incurred, even if the bill has not yet been paid." },
  { id: "equity", name: "Owners' equity and drawings", reference: "ASC 505", explanation: "Owner contributions raise equity; drawings and losses reduce it. Retained earnings carry accumulated profit forward." },
  { id: "inventory", name: "Inventory", reference: "ASC 330", explanation: "Inventory is held at cost (or lower where its value has fallen); the cost moves to cost of goods sold when the goods are sold." },
  { id: "foreign-currency", name: "Foreign currency", reference: "ASC 830", explanation: "Foreign amounts are translated at the exchange rate on the transaction date; differences at settlement are recognised as gains or losses." },
];

const byId = new Map(GAAP_CONCEPTS.map((c) => [c.id, c]));

/** Which concepts apply to an entry, chosen from the accounts touched. Always includes double-entry. */
export function conceptsFor(lines: GuideLineInput[], journalType?: string): GaapConcept[] {
  const ids = new Set<string>(["dual-aspect"]);
  const text = lines.map((l) => `${l.accountName} ${l.subtype || ""}`).join(" | ").toLowerCase();
  const types = new Set(lines.map((l) => l.type));
  if (types.has("revenue")) { ids.add("revenue-recognition"); ids.add("accrual"); }
  if (types.has("expense")) { ids.add("matching"); ids.add("accrual"); }
  if (/depreciation|accumulated/.test(text) || journalType === "depreciation") { ids.add("depreciation"); ids.add("matching"); ids.add("going-concern"); }
  if (lines.some((l) => l.type === "asset" && /fixed|equipment|computer|laptop|mobile|phone|furniture|server|vehicle/.test(`${l.subtype} ${l.accountName}`.toLowerCase()))) { ids.add("historical-cost"); ids.add("depreciation"); }
  if (/receivable/.test(text)) ids.add("receivables");
  if (/payable|accrued|loan|deferred|advance|unearned/.test(text)) ids.add("payables");
  if (types.has("equity")) ids.add("equity");
  if (/inventory|cost of goods|stock/.test(text)) ids.add("inventory");
  if (/foreign|fx|exchange/.test(text)) ids.add("foreign-currency");
  if (/provision|bad debt|doubtful|impair/.test(text)) ids.add("conservatism");
  ids.add("full-disclosure");
  ids.add("consistency");
  return [...ids].map((id) => byId.get(id)!).filter(Boolean);
}

export interface EntryGuide {
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
  headline: string;
  effects: LineEffect[];
  equationNote: string;
  concepts: GaapConcept[];
  /** What would change if the user flips a side or swaps an account. */
  whatIf: string[];
}

export function buildEntryGuide(lines: GuideLineInput[], opts: { journalType?: string; currency?: string } = {}): EntryGuide {
  const currency = opts.currency || "GHS";
  const active = lines.filter((l) => l.amount > 0);
  const totalDebit = active.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
  const totalCredit = active.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
  const effects = active.map((l) => lineEffect(l, currency));
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  let equationNote: string;
  if (!active.length) equationNote = "Pick an account and enter an amount to see what a debit or credit does to it.";
  else if (!balanced) equationNote = `Debits ${formatCurrency(totalDebit, currency)} and credits ${formatCurrency(totalCredit, currency)} differ by ${formatCurrency(Math.abs(totalDebit - totalCredit), currency)}. A journal cannot post until both sides are equal.`;
  else {
    const d = deltas(active);
    equationNote = `Balanced. Assets ${signed(d.asset, currency)}, liabilities ${signed(d.liability, currency)}, equity ${signed(d.equity + d.revenue - d.expense, currency)} (revenue and expenses flow into equity through profit), so Assets = Liabilities + Equity still holds.`;
  }

  const whatIf: string[] = [];
  for (const e of effects.slice(0, 4)) {
    const flipped = e.direction === "increases" ? "decrease" : "increase";
    whatIf.push(`If ${e.accountName} were ${e.side === "debit" ? "credited" : "debited"} instead, it would ${flipped} rather than ${e.direction === "increases" ? "increase" : "decrease"}.`);
  }

  return {
    balanced,
    totalDebit,
    totalCredit,
    headline: effects.length ? effects.map((e) => `${e.side === "debit" ? "Dr" : "Cr"} ${e.accountName} ${e.direction === "increases" ? "↑" : "↓"}`).join("  ·  ") : "No lines yet",
    effects,
    equationNote,
    concepts: conceptsFor(active, opts.journalType),
    whatIf,
  };
}

/** Net change in each account class, in minor units (contra accounts counted with their reversed sign). */
export function deltas(lines: GuideLineInput[]): Record<GuideAccountType, number> {
  const out: Record<GuideAccountType, number> = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
  for (const l of lines) {
    const e = lineEffect(l);
    out[l.type] += e.direction === "increases" ? l.amount : -l.amount;
  }
  return out;
}

const signed = (n: number, currency: string) => (n === 0 ? "unchanged" : `${n > 0 ? "up" : "down"} ${formatCurrency(Math.abs(n), currency)}`);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Short reference card, independent of any entry. */
export const DOUBLE_ENTRY_CHEATSHEET: Array<{ type: GuideAccountType; normal: Side; debit: string; credit: string }> = (Object.keys(EFFECT_TABLE) as GuideAccountType[]).map((t) => ({
  type: t,
  normal: EFFECT_TABLE[t].normal,
  debit: EFFECT_TABLE[t].debit,
  credit: EFFECT_TABLE[t].credit,
}));
