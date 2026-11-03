/**
 * CINTEXA Finance — Automatic Accounting Documentation Engine
 *
 * Pure TypeScript. Deterministic templates + Chart of Accounts rules.
 * No external AI API keys required.
 *
 * Generates:
 *  - Transaction description / journal memo
 *  - Per-line debit/credit notes
 *  - Account explanations
 *  - Financial impact summary
 *  - Treatment recommendations & alerts
 *  - Documentation completeness score
 *
 * All output is traceable to selected accounts, amounts and journal type.
 */

import { formatCurrency, formatMinor } from "./money";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountRef {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
}

export interface DraftLineInput {
  key?: string;
  account: AccountRef | null;
  memo?: string;
  debit: number; // minor units (or form units consistent with API)
  credit: number;
}

export interface JournalContext {
  journalType?: string;
  entryDate?: string;
  currency?: string;
  description?: string; // user-entered or previously generated
  lines: DraftLineInput[];
  /** When true, preserve user-edited description/memos unless empty */
  preserveUserEdits?: boolean;
}

export type AlertSeverity = "info" | "caution" | "critical";

export interface AccountingAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  observation: string;
  recommendation: string;
  reason: string;
  potentialImpact?: string;
}

export interface LineDocumentation {
  key?: string;
  accountCode: string;
  accountName: string;
  side: "debit" | "credit";
  amount: number;
  autoNote: string;
  userMemo?: string;
}

export interface FinancialImpact {
  assets: string;
  liabilities: string;
  equity: string;
  revenue: string;
  expenses: string;
  profit: string;
  cash: string;
  summary: string;
}

export interface CompletenessItem {
  id: string;
  label: string;
  status: "complete" | "partial" | "missing";
  detail?: string;
}

export interface DocumentationResult {
  transactionDescription: string;
  journalMemo: string;
  lineNotes: LineDocumentation[];
  accountExplanations: { code: string; name: string; explanation: string }[];
  financialImpact: FinancialImpact;
  treatment: {
    classification: string;
    recommendedDebit?: string;
    recommendedCredit?: string;
    principle: string;
    alternatives?: string;
  };
  alerts: AccountingAlert[];
  completeness: CompletenessItem[];
  completenessScore: number; // 0–100
  generatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Account explanation library (context-sensitive)                             */
/* -------------------------------------------------------------------------- */

const ACCOUNT_EXPLANATIONS: Record<string, string> = {
  "1010": "Cash on Hand represents physical currency held by the business for immediate use.",
  "1020": "Petty Cash is a small cash fund maintained for minor day-to-day disbursements.",
  "1030": "Bank Accounts represent funds held with financial institutions, available for settlement of obligations.",
  "1040": "Mobile Money Accounts represent electronic wallet balances used for payments and receipts.",
  "1050": "Accounts Receivable represents amounts owed to the business by customers for goods or services already supplied but not yet paid for.",
  "1070": "Employee Advances are amounts paid to employees that will be recovered from future salaries or reimbursements.",
  "1080": "Prepaid Expenses represent payments made in advance for goods or services whose economic benefits will be consumed in future accounting periods.",
  "1090": "Inventory represents goods held for sale or for use in the production of goods for sale.",
  "1210": "Computers and Laptops are tangible fixed assets expected to provide economic benefits over multiple accounting periods.",
  "1220": "Servers and Networking Equipment are capital assets supporting the organisation's IT infrastructure.",
  "1230": "Office Equipment comprises tangible assets used in day-to-day operations and capitalised under the applicable policy.",
  "1240": "Furniture and Fixtures are long-lived tangible assets used in the business premises.",
  "1280": "Accumulated Depreciation records the total depreciation recognised against depreciable fixed assets since they became available for use.",
  "2010": "Accounts Payable represents outstanding obligations owed to suppliers and other creditors for goods or services received.",
  "2030": "Accrued Expenses are liabilities for costs incurred but not yet invoiced or paid at the reporting date.",
  "2040": "Salaries Payable represents unpaid employee remuneration earned at the reporting date.",
  "2100": "Customer Advances are amounts received from customers before goods or services are delivered.",
  "2110": "Deferred Revenue represents consideration received in advance that will be recognised as revenue in future periods as performance obligations are satisfied.",
  "2140": "Short-term Loans are borrowings due for repayment within twelve months.",
  "2150": "Long-term Loans are borrowings with a maturity exceeding twelve months.",
  "3010": "Share Capital represents the nominal value of equity instruments issued to owners.",
  "3030": "Owner Contributions are additional capital introduced by owners that increases equity.",
  "3040": "Retained Earnings represents accumulated profits and losses retained in the business after relevant distributions and adjustments.",
  "3060": "Owner Drawings represent distributions of capital or profits to owners, reducing equity.",
};

const TYPE_EXPLANATIONS: Record<AccountType, string> = {
  asset: "Asset accounts represent resources controlled by the entity from which future economic benefits are expected.",
  liability: "Liability accounts represent present obligations arising from past events, the settlement of which is expected to result in an outflow of resources.",
  equity: "Equity accounts represent the residual interest in the assets of the entity after deducting all liabilities.",
  revenue: "Revenue accounts record income arising in the course of ordinary activities, increasing profit and equity.",
  expense: "Expense accounts record costs incurred in generating revenue or maintaining the business, reducing profit and equity.",
};

function accountExplanation(acc: AccountRef): string {
  return (
    ACCOUNT_EXPLANATIONS[acc.code] ||
    `${acc.name} (${acc.code}) is a ${acc.type} account${acc.subtype ? ` (${acc.subtype})` : ""}. ${TYPE_EXPLANATIONS[acc.type]}`
  );
}

/* -------------------------------------------------------------------------- */
/* Line note generation                                                        */
/* -------------------------------------------------------------------------- */

function lineNote(acc: AccountRef, side: "debit" | "credit", amount: number, currency: string): string {
  const amt = formatCurrency(amount, currency);
  const name = acc.name;
  const sub = (acc.subtype || "").toLowerCase();

  if (side === "debit") {
    if (acc.type === "asset") {
      if (sub === "cash" || sub === "bank") return `Increase in ${name} arising from receipt of funds (${amt}).`;
      if (sub === "ar") return `Increase in amounts receivable from customers (${amt}).`;
      if (sub === "fixed") return `Recognition of the cost of ${name}, capitalised as a tangible fixed asset (${amt}).`;
      if (sub === "contra") return `Reduction in the carrying amount of related assets via ${name} (${amt}).`;
      return `Increase in the asset ${name} (${amt}).`;
    }
    if (acc.type === "expense") {
      if (sub.includes("discount_allowed")) return `Recognition of discount allowed to customers, reducing realised revenue (${amt}).`;
      return `Recognition of ${name} as an operating or other expense for the period (${amt}).`;
    }
    if (acc.type === "liability") return `Reduction of the liability ${name} through settlement or reclassification (${amt}).`;
    if (acc.type === "equity") return `Reduction in equity via ${name} (${amt}).`;
    if (acc.type === "revenue") return `Reduction or reversal of previously recognised ${name} (${amt}).`;
  } else {
    // credit
    if (acc.type === "asset") {
      if (sub === "cash" || sub === "bank") return `Decrease in ${name} arising from payment of funds (${amt}).`;
      if (sub === "ar") return `Reduction in customer receivables following collection or adjustment (${amt}).`;
      if (sub === "contra") return `Increase in ${name}, reducing the net book value of related fixed assets (${amt}).`;
      return `Decrease in the asset ${name} (${amt}).`;
    }
    if (acc.type === "liability") return `Increase in the liability ${name}, recognising an obligation of ${amt}.`;
    if (acc.type === "equity") return `Increase in equity via ${name} (${amt}).`;
    if (acc.type === "revenue") {
      if (sub.includes("discount_received")) return `Recognition of discount received from suppliers, reducing cost (${amt}).`;
      return `Recognition of ${name} arising from the delivery of goods or services (${amt}).`;
    }
    if (acc.type === "expense") return `Reduction or reversal of ${name} (${amt}).`;
  }
  return `${side === "debit" ? "Debit" : "Credit"} to ${name} for ${amt}.`;
}

/* -------------------------------------------------------------------------- */
/* Journal memo / description                                                  */
/* -------------------------------------------------------------------------- */

function inferClassification(lines: DraftLineInput[], journalType?: string): string {
  const active = lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  const types = new Set(active.map((l) => l.account!.type));
  const subtypes = active.map((l) => (l.account!.subtype || "").toLowerCase());

  if (journalType === "depreciation" || subtypes.some((s) => s === "contra")) return "depreciation";
  if (journalType === "payroll") return "payroll";
  if (journalType === "sales" || (types.has("revenue") && subtypes.some((s) => s === "ar"))) return "sales_invoice";
  if (journalType === "purchase" || (types.has("expense") && subtypes.some((s) => s === "ap"))) return "purchase";
  if (journalType === "cash_receipt" || (subtypes.some((s) => s === "cash" || s === "bank") && subtypes.some((s) => s === "ar")))
    return "customer_receipt";
  if (journalType === "cash_payment" || (subtypes.some((s) => s === "cash" || s === "bank") && subtypes.some((s) => s === "ap")))
    return "supplier_payment";
  if (types.has("asset") && subtypes.some((s) => s === "fixed") && subtypes.some((s) => s === "cash" || s === "bank" || s === "ap"))
    return "asset_acquisition";
  if (types.has("expense") && subtypes.some((s) => s === "cash" || s === "bank")) return "cash_expense";
  if (types.has("revenue")) return "revenue_recognition";
  if (types.has("liability") && subtypes.some((s) => s === "cash" || s === "bank")) return "loan_or_liability_movement";
  if (types.has("equity")) return "equity_movement";
  return journalType || "general";
}

function buildMemo(classification: string, lines: DraftLineInput[], currency: string, entryDate?: string): string {
  const active = lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  const total = active.reduce((s, l) => s + Math.max(l.debit, l.credit), 0);
  const amt = formatCurrency(total / Math.max(1, active.filter((l) => l.debit > 0).length || 1), currency);
  // Prefer sum of debits
  const debitSum = active.reduce((s, l) => s + l.debit, 0);
  const displayAmt = formatCurrency(debitSum, currency);
  const dateBit = entryDate ? ` dated ${entryDate}` : "";

  const names = active.map((l) => l.account!.name);
  const debitNames = active.filter((l) => l.debit > 0).map((l) => l.account!.name);
  const creditNames = active.filter((l) => l.credit > 0).map((l) => l.account!.name);

  switch (classification) {
    case "depreciation":
      return `Recognition of periodic depreciation expense relating to the consumption of economic benefits of fixed assets${dateBit}. Amount: ${displayAmt}.`;
    case "payroll":
      return `Recognition of payroll costs and related obligations for the applicable period${dateBit}. Amount: ${displayAmt}.`;
    case "sales_invoice":
      return `Recognition of revenue and the related customer receivable arising from the supply of goods or services${dateBit}. Amount: ${displayAmt}.`;
    case "purchase":
      return `Recognition of a purchase transaction and the related supplier obligation${dateBit}. Amount: ${displayAmt}.`;
    case "customer_receipt":
      return `Receipt of payment from a customer in settlement of an outstanding receivable${dateBit}. Amount: ${displayAmt}.`;
    case "supplier_payment":
      return `Payment to a supplier in settlement of an outstanding payable${dateBit}. Amount: ${displayAmt}.`;
    case "asset_acquisition":
      return `Acquisition of business equipment or other fixed assets for operational use, capitalised in accordance with the applicable accounting policy${dateBit}. Cost: ${displayAmt}.`;
    case "cash_expense":
      return `Payment of operating expenses for the applicable accounting period${dateBit}. Amount: ${displayAmt}. Accounts: ${debitNames.join(", ")} / ${creditNames.join(", ")}.`;
    case "revenue_recognition":
      return `Recognition of revenue arising from ordinary activities${dateBit}. Amount: ${displayAmt}.`;
    case "loan_or_liability_movement":
      return `Movement in borrowings or other liabilities with corresponding cash or other accounts${dateBit}. Amount: ${displayAmt}.`;
    case "equity_movement":
      return `Equity movement involving ${names.join(" and ")}${dateBit}. Amount: ${displayAmt}.`;
    default:
      return `General journal entry${dateBit} affecting ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}. Debits equal credits at ${displayAmt}.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Financial impact                                                            */
/* -------------------------------------------------------------------------- */

function buildImpact(lines: DraftLineInput[], currency: string): FinancialImpact {
  let assetDelta = 0,
    liabilityDelta = 0,
    equityDelta = 0,
    revenueDelta = 0,
    expenseDelta = 0,
    cashDelta = 0;

  for (const l of lines) {
    if (!l.account) continue;
    const net = l.debit - l.credit; // positive = debit side increase for assets/expenses
    const a = l.account;
    const sub = (a.subtype || "").toLowerCase();
    if (a.type === "asset") {
      if (sub === "contra") assetDelta -= net;
      else assetDelta += net;
      if (sub === "cash" || sub === "bank") cashDelta += net;
    } else if (a.type === "liability") liabilityDelta -= net; // credit increases liability
    else if (a.type === "equity") equityDelta -= net;
    else if (a.type === "revenue") revenueDelta -= net; // credit increases revenue
    else if (a.type === "expense") expenseDelta += net;
  }

  const profitDelta = revenueDelta - expenseDelta;
  const fmt = (n: number) => {
    if (n === 0) return "No change";
    const sign = n > 0 ? "Increase" : "Decrease";
    return `${sign} of ${formatCurrency(Math.abs(n), currency)}`;
  };

  const parts: string[] = [];
  if (cashDelta !== 0) parts.push(`Cash ${cashDelta > 0 ? "increases" : "decreases"} by ${formatCurrency(Math.abs(cashDelta), currency)}`);
  if (assetDelta !== 0 && assetDelta !== cashDelta)
    parts.push(`Net assets ${assetDelta > 0 ? "increase" : "decrease"} by ${formatCurrency(Math.abs(assetDelta), currency)}`);
  if (liabilityDelta !== 0)
    parts.push(`Liabilities ${liabilityDelta > 0 ? "increase" : "decrease"} by ${formatCurrency(Math.abs(liabilityDelta), currency)}`);
  if (revenueDelta !== 0) parts.push(`Revenue ${revenueDelta > 0 ? "increases" : "decreases"} by ${formatCurrency(Math.abs(revenueDelta), currency)}`);
  if (expenseDelta !== 0) parts.push(`Expenses ${expenseDelta > 0 ? "increase" : "decrease"} by ${formatCurrency(Math.abs(expenseDelta), currency)}`);
  if (profitDelta !== 0)
    parts.push(`Accounting profit ${profitDelta > 0 ? "increases" : "decreases"} by ${formatCurrency(Math.abs(profitDelta), currency)}`);
  if (parts.length === 0) parts.push("No measurable statement impact detected from the current lines.");

  return {
    assets: fmt(assetDelta),
    liabilities: fmt(liabilityDelta),
    equity: fmt(equityDelta + profitDelta),
    revenue: fmt(revenueDelta),
    expenses: fmt(expenseDelta),
    profit: fmt(profitDelta),
    cash: fmt(cashDelta),
    summary: parts.join(". ") + ".",
  };
}

/* -------------------------------------------------------------------------- */
/* Alerts & recommendations                                                    */
/* -------------------------------------------------------------------------- */

function buildAlerts(ctx: JournalContext, classification: string): AccountingAlert[] {
  const alerts: AccountingAlert[] = [];
  const currency = ctx.currency || "GHS";
  const active = ctx.lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  const debitSum = active.reduce((s, l) => s + l.debit, 0);
  const creditSum = active.reduce((s, l) => s + l.credit, 0);

  if (active.length > 0 && debitSum !== creditSum) {
    alerts.push({
      id: "unbalanced",
      severity: "critical",
      title: "Journal is not balanced",
      observation: `Total debits (${formatMinor(debitSum, currency)}) do not equal total credits (${formatMinor(creditSum, currency)}).`,
      recommendation: "Adjust line amounts so that debits equal credits before posting.",
      reason: "Double-entry accounting requires every journal to balance.",
      potentialImpact: "An unbalanced journal cannot be posted and would break the trial balance.",
    });
  }

  if (active.length === 0) {
    alerts.push({
      id: "empty",
      severity: "info",
      title: "No complete lines yet",
      observation: "Select accounts and enter debit or credit amounts to receive documentation and recommendations.",
      recommendation: "Add at least two lines that balance.",
      reason: "A journal requires balanced debit and credit sides.",
    });
  }

  // Capitalisation heuristic: large expense + office equipment keywords
  for (const l of active) {
    if (!l.account) continue;
    const name = l.account.name.toLowerCase();
    const isExpense = l.account.type === "expense";
    const looksLikeAsset =
      /laptop|computer|server|equipment|furniture|vehicle|software licence|capital/i.test(name) ||
      (l.account.subtype || "").toLowerCase() === "fixed";
    if (isExpense && l.debit >= 500000) {
      // GHS 5,000+ minor
      alerts.push({
        id: `capex-check-${l.account.code}`,
        severity: "caution",
        title: "Possible capital expenditure",
        observation: `The line debits expense account ${l.account.code} ${l.account.name} for ${formatCurrency(l.debit, currency)}.`,
        recommendation:
          "If the item is expected to provide benefits over multiple periods and meets the organisation's capitalisation threshold, consider a Fixed Asset account (e.g. 1210–1240) instead of an expense.",
        reason: "Correct classification improves depreciation recognition and statement accuracy.",
        potentialImpact: "Misclassifying capital items as expenses understates assets and distorts profit in the acquisition period.",
      });
    }
    if (looksLikeAsset && isExpense) {
      alerts.push({
        id: `asset-as-expense-${l.account.code}`,
        severity: "caution",
        title: "Asset-like description on an expense account",
        observation: `Account ${l.account.name} is classified as an expense but the name suggests a long-lived item.`,
        recommendation: "Confirm the capitalisation policy. Prefer a fixed-asset account when the policy threshold is met.",
        reason: "Substance over form — economic benefits spanning multiple periods usually indicate an asset.",
      });
    }
  }

  // Revenue vs cash confusion
  const hasRevenue = active.some((l) => l.account?.type === "revenue");
  const hasCash = active.some((l) => ["cash", "bank"].includes((l.account?.subtype || "").toLowerCase()));
  const hasAR = active.some((l) => (l.account?.subtype || "").toLowerCase() === "ar");
  if (hasRevenue && hasCash && !hasAR && classification === "revenue_recognition") {
    alerts.push({
      id: "cash-basis-revenue",
      severity: "info",
      title: "Cash-basis style revenue entry",
      observation: "Revenue is recognised directly against cash/bank without an Accounts Receivable line.",
      recommendation: "This is acceptable for cash sales. For credit sales, debit Accounts Receivable (1050) and credit Revenue, then record the receipt separately.",
      reason: "Separating recognition and collection improves AR control and ageing analysis.",
    });
  }

  if (!ctx.description?.trim() && active.length >= 2 && debitSum === creditSum) {
    alerts.push({
      id: "missing-description",
      severity: "caution",
      title: "Transaction description is empty",
      observation: "A balanced journal is ready but has no overall description.",
      recommendation: "Accept the auto-generated memo or enter a custom description before posting.",
      reason: "Adequate documentation supports audit trails and future analysis.",
    });
  }

  return alerts;
}

/* -------------------------------------------------------------------------- */
/* Completeness score                                                          */
/* -------------------------------------------------------------------------- */

function buildCompleteness(ctx: JournalContext, result: Omit<DocumentationResult, "completeness" | "completenessScore" | "generatedAt">): {
  items: CompletenessItem[];
  score: number;
} {
  const active = ctx.lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  const debitSum = active.reduce((s, l) => s + l.debit, 0);
  const creditSum = active.reduce((s, l) => s + l.credit, 0);
  const balanced = active.length >= 2 && debitSum === creditSum && debitSum > 0;

  const items: CompletenessItem[] = [
    {
      id: "description",
      label: "Transaction description",
      status: (ctx.description || result.transactionDescription || "").trim() ? "complete" : "missing",
    },
    {
      id: "memo",
      label: "Journal memo",
      status: result.journalMemo.trim() ? "complete" : "missing",
    },
    {
      id: "line-notes",
      label: "Debit & credit line explanations",
      status:
        result.lineNotes.length >= 2 && result.lineNotes.every((n) => n.autoNote)
          ? "complete"
          : result.lineNotes.length > 0
            ? "partial"
            : "missing",
    },
    {
      id: "balanced",
      label: "Balanced journal (debits = credits)",
      status: balanced ? "complete" : active.length > 0 ? "partial" : "missing",
      detail: balanced ? undefined : `Difference: ${formatMinor(Math.abs(debitSum - creditSum), ctx.currency || "GHS")}`,
    },
    {
      id: "treatment",
      label: "Accounting treatment identified",
      status: result.treatment.classification && result.treatment.classification !== "general" ? "complete" : "partial",
    },
    {
      id: "impact",
      label: "Financial impact assessed",
      status: result.financialImpact.summary ? "complete" : "missing",
    },
    {
      id: "accounts",
      label: "Accounts selected on all lines",
      status: active.length >= 2 && active.every((l) => l.account) ? "complete" : "partial",
    },
  ];

  const weights = { complete: 1, partial: 0.5, missing: 0 };
  const score = Math.round((items.reduce((s, i) => s + weights[i.status], 0) / items.length) * 100);
  return { items, score };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export function generateDocumentation(ctx: JournalContext): DocumentationResult {
  const currency = ctx.currency || "GHS";
  const active = ctx.lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  const classification = inferClassification(ctx.lines, ctx.journalType);

  const lineNotes: LineDocumentation[] = active.map((l) => {
    const side: "debit" | "credit" = l.debit > 0 ? "debit" : "credit";
    const amount = l.debit > 0 ? l.debit : l.credit;
    return {
      key: l.key,
      accountCode: l.account!.code,
      accountName: l.account!.name,
      side,
      amount,
      autoNote: lineNote(l.account!, side, amount, currency),
      userMemo: l.memo,
    };
  });

  const autoMemo = buildMemo(classification, ctx.lines, currency, ctx.entryDate);
  const transactionDescription =
    ctx.preserveUserEdits && ctx.description?.trim() ? ctx.description.trim() : autoMemo;

  const accountExplanations = Array.from(
    new Map(
      active
        .filter((l) => l.account)
        .map((l) => [l.account!.code, { code: l.account!.code, name: l.account!.name, explanation: accountExplanation(l.account!) }]),
    ).values(),
  );

  const financialImpact = buildImpact(ctx.lines, currency);
  const alerts = buildAlerts(ctx, classification);

  const treatment = {
    classification,
    principle:
      classification === "asset_acquisition"
        ? "Capitalise assets that meet the capitalisation policy; expense items below the threshold or with short benefit periods."
        : classification === "depreciation"
          ? "Allocate the depreciable amount of an asset on a systematic basis over its useful life."
          : classification === "customer_receipt"
            ? "Collection of a receivable does not create new revenue if revenue was recognised at invoicing."
            : "Record transactions according to their economic substance using the approved Chart of Accounts.",
    recommendedDebit: lineNotes.find((n) => n.side === "debit")?.accountName,
    recommendedCredit: lineNotes.find((n) => n.side === "credit")?.accountName,
    alternatives:
      classification === "cash_expense"
        ? "If the payment is a prepayment, debit Prepaid Expenses (1080) and release to expense over the benefit period."
        : undefined,
  };

  const base = {
    transactionDescription,
    journalMemo: autoMemo,
    lineNotes,
    accountExplanations,
    financialImpact,
    treatment,
    alerts,
  };

  const { items, score } = buildCompleteness(ctx, base);

  return {
    ...base,
    completeness: items,
    completenessScore: score,
    generatedAt: new Date().toISOString(),
  };
}

/** Quick account explanation for hover / side panel when selecting an account */
export function explainAccount(account: AccountRef): string {
  return accountExplanation(account);
}
