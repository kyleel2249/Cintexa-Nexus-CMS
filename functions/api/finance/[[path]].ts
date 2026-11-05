/**
 * CINTEXA Finance — double-entry accounting API (/api/finance/*)
 * Zero third-party API keys. Integer minor units. Balanced journals only.
 * Authoritative store: context.env.FIN_DB (Cloudflare D1).
 * Isolate memory is only used when FIN_ALLOW_MEMORY=1 for local/dev — never production.
 */

import { ensureNexusSchema, resolveDb, type D1Like } from "../../_lib/nexus-db.ts";
import { enqueue, processEvent } from "../../_lib/nexus-sync.ts";


type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  currency: string;
  active: boolean;
}

interface JournalLine {
  id: string;
  accountId: string;
  accountCode: string;
  memo?: string;
  debit: number;
  credit: number;
  /** Foreign-currency leg (minor units of fcCurrency). Functional amount stays in debit/credit. */
  fcCurrency?: string;
  fcAmount?: number;
  /** Functional units per 1 foreign unit × 1,000,000 (integer, no float drift) */
  rateMicro?: number;
  /** "reval" = unrealized FX revaluation adjustment (no foreign amount) */
  fxKind?: "reval";
}

interface Journal {
  id: string;
  number: string;
  journalType: string;
  entryDate: string;
  postingDate?: string;
  description: string;
  sourceModule?: string;
  sourceId?: string;
  currency: string;
  status: "draft" | "posted" | "reversed";
  lines: JournalLine[];
  createdAt: string;
  postedAt?: string;
  reversedBy?: string;
}

interface Invoice {
  id: string;
  number: string;
  customerName: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  amountMinor: number;
  amountPaidMinor: number;
  status: string;
  sourceModule?: string;
  sourceId?: string;
  journalId?: string;
  createdAt: string;
}

interface Payment {
  id: string;
  invoiceId?: string;
  customerName: string;
  paymentDate: string;
  amountMinor: number;
  currency: string;
  method?: string;
  journalId?: string;
  sourceModule?: string;
  sourceId?: string;
  createdAt: string;
}


interface FixedAsset {
  id: string;
  assetNumber: string;
  name: string;
  category: "computer" | "laptop" | "server" | "office_equipment" | "furniture" | "other";
  acquisitionDate: string;
  inServiceDate: string;
  costMinor: number;
  residualMinor: number;
  /** basis points — computers/laptops mandatory 2500 = 25% */
  depreciationRateBps: number;
  method: "straight_line";
  accumulatedMinor: number;
  status: "active" | "disposed" | "fully_depreciated";
  location?: string;
  custodian?: string;
  disposalDate?: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

interface DepreciationRun {
  id: string;
  assetId: string;
  periodYm: string;
  amountMinor: number;
  journalId?: string;
  createdAt: string;
}

interface AccountingPeriod {
  id: string;
  periodYm: string; // YYYY-MM
  status: "open" | "closed";
  label?: string;
  closedAt?: string;
  closedBy?: string;
  closeReason?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface Audit {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  detail?: string;
  createdAt: string;
}

interface Policy { id: string; key: string; value: string; effectiveFrom: string; reason: string; setBy: string; createdAt: string }
interface YearClose {
  id: string; fiscalYear: number; startDate: string; endDate: string; status: "closed" | "reopened";
  netResultMinor: number; drawingsMinor: number; journalId?: string; reversalJournalId?: string;
  closedAt: string; closedBy: string; reason: string; reopenedAt?: string; reopenReason?: string;
}

interface Store {
  docs: Record<string, Record<string, any>>;
  policies: Policy[];
  yearCloses: YearClose[];
  accounts: Account[];
  journals: Journal[];
  invoices: Invoice[];
  payments: Payment[];
  fixedAssets: FixedAsset[];
  depreciationRuns: DepreciationRun[];
  periods: AccountingPeriod[];
  audit: Audit[];
  journalSeq: number;
  invoiceSeq: number;
  assetSeq: number;
  seededCoa: boolean;
}

const store: Store = {
  docs: {},
  policies: [],
  yearCloses: [],
  accounts: [],
  journals: [],
  invoices: [],
  payments: [],
  fixedAssets: [],
  depreciationRuns: [],
  periods: [],
  audit: [],
  journalSeq: 1,
  invoiceSeq: 1,
  assetSeq: 1,
  seededCoa: false,
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function readJson(request: Request): Promise<any> {
  try {
    const t = await request.text();
    return t?.trim() ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

function audit(entityType: string, entityId: string, action: string, detail?: string) {
  store.audit.push({
    id: crypto.randomUUID(),
    entityType,
    entityId,
    action,
    detail,
    createdAt: new Date().toISOString(),
  });
}

/** Standard CINTEXA template COA — structure only, zero balances */
function ensureCoa() {
  if (store.seededCoa && store.accounts.length) return;
  const rows: [string, string, AccountType, string?][] = [
    ["1010", "Cash on Hand", "asset", "cash"],
    ["1020", "Petty Cash", "asset", "cash"],
    ["1030", "Bank Accounts", "asset", "bank"],
    ["1040", "Mobile Money Accounts", "asset", "cash"],
    ["1050", "Accounts Receivable", "asset", "ar"],
    ["1070", "Employee Advances", "asset"],
    ["1080", "Prepaid Expenses", "asset"],
    ["1090", "Inventory", "asset"],
    ["1120", "Work in Progress", "asset"],
    ["1130", "Unbilled Contract Assets", "asset"],
    ["1140", "Recoverable Input Tax", "asset", "tax"],
    ["1150", "Withholding Tax Receivable", "asset", "tax"],
    ["1210", "Computers and Laptops", "asset", "fixed"],
    ["1220", "Servers and Networking Equipment", "asset", "fixed"],
    ["1230", "Office Equipment", "asset", "fixed"],
    ["1240", "Furniture and Fixtures", "asset", "fixed"],
    ["1270", "Capitalized Software Assets", "asset", "fixed"],
    ["1280", "Accumulated Depreciation", "asset", "contra"],
    ["1281", "Accumulated Depreciation — Computers and Laptops", "asset", "contra"],
    ["1282", "Accumulated Depreciation — Office Equipment", "asset", "contra"],
    ["1310", "Acquired Software", "asset", "intangible"],
    ["2010", "Accounts Payable", "liability", "ap"],
    ["2030", "Accrued Expenses", "liability"],
    ["2040", "Salaries Payable", "liability", "payroll"],
    ["2060", "Payroll Tax Payable", "liability", "tax"],
    ["2080", "Output Tax Payable", "liability", "tax"],
    ["2090", "Withholding Tax Payable", "liability", "tax"],
    ["2100", "Customer Advances", "liability"],
    ["2110", "Deferred Revenue", "liability"],
    ["2120", "Unearned Subscription Revenue", "liability"],
    ["2140", "Short-term Loans", "liability"],
    ["2150", "Long-term Loans", "liability"],
    ["3010", "Share Capital", "equity"],
    ["3030", "Owner Contributions", "equity"],
    ["3040", "Retained Earnings", "equity"],
    ["3050", "Current Year Earnings", "equity"],
    ["3060", "Owner Drawings", "equity"],
    ["4010", "Website Design Revenue", "revenue"],
    ["4020", "Website Development Revenue", "revenue"],
    ["4030", "Custom Software Development Revenue", "revenue"],
    ["4040", "Software Engineering Revenue", "revenue"],
    ["4050", "Software Implementation Revenue", "revenue"],
    ["4060", "Software Licensing Revenue", "revenue"],
    ["4070", "SaaS Subscription Revenue", "revenue"],
    ["4080", "Software Renewal Revenue", "revenue"],
    ["4090", "Software Maintenance Revenue", "revenue"],
    ["4100", "IT Consulting Revenue", "revenue"],
    ["4110", "Technical Support Revenue", "revenue"],
    ["4120", "IT Training Revenue", "revenue"],
    ["4130", "Workflow Automation Revenue", "revenue"],
    ["4140", "Digital Transformation Services Revenue", "revenue"],
    ["4150", "Hosting and Infrastructure Revenue", "revenue"],
    ["4160", "Hardware Sales Revenue", "revenue"],
    ["4190", "Other Technology Services Revenue", "revenue"],
    ["4200", "Interest Income", "revenue"],
    ["4210", "Foreign Exchange Gain", "revenue"],
    ["5010", "Direct Developer Salaries", "expense", "cos"],
    ["5020", "Freelance Developer Costs", "expense", "cos"],
    ["5030", "Software Development Subcontracting", "expense", "cos"],
    ["5040", "Project-specific Hosting Costs", "expense", "cos"],
    ["5100", "Technical Delivery Costs", "expense", "cos"],
    ["6010", "Employee Salaries", "expense"],
    ["6060", "Office Rent", "expense"],
    ["6080", "Internet and Telecommunications", "expense"],
    ["6090", "Cloud Hosting", "expense"],
    ["6130", "Domain Registration", "expense"],
    ["6140", "SSL Certificates", "expense"],
    ["6150", "Software Subscriptions", "expense"],
    ["6200", "Marketing and Advertising", "expense"],
    ["6220", "Professional Services", "expense"],
    ["6290", "Bank Charges", "expense"],
    ["6300", "Payment Processing Fees", "expense"],
    ["6310", "Depreciation Expense", "expense"],
    ["6311", "Depreciation Expense — Computer Equipment", "expense"],
    ["6380", "Bad Debt Expense", "expense"],
    ["6390", "Foreign Exchange Loss", "expense"],
    ["6400", "Miscellaneous Operating Expenses", "expense"],
    ["7010", "Interest Expense", "expense"],
    ["7080", "Income Tax Expense", "expense"],
    ["8010", "Output VAT Control", "liability", "tax"],
    ["8020", "Input VAT Control", "asset", "tax"],
    // Discount Allowed — revenue contra (debit normal)
    ["4320", "Discount Allowed", "expense", "discount_allowed"],
    ["4321", "Early Payment Discount Allowed", "expense", "discount_allowed"],
    ["4322", "Promotional Discount Allowed", "expense", "discount_allowed"],
    ["4323", "Volume Discount Allowed", "expense", "discount_allowed"],
    ["4324", "Negotiated Discount Allowed", "expense", "discount_allowed"],
    ["4325", "Customer Loyalty Discount Allowed", "expense", "discount_allowed"],
    ["4326", "Contractual Discount Allowed", "expense", "discount_allowed"],
    ["4329", "Other Discounts Allowed", "expense", "discount_allowed"],
    // Discount Received — cost/expense reduction (credit normal) stored as revenue-type for credit-normal presentation
    ["5160", "Discount Received", "revenue", "discount_received"],
    ["5161", "Early Payment Discount Received", "revenue", "discount_received"],
    ["5162", "Purchase Volume Discount Received", "revenue", "discount_received"],
    ["5163", "Negotiated Discount Received", "revenue", "discount_received"],
    ["5164", "Contractual Discount Received", "revenue", "discount_received"],
    ["5165", "Supplier Promotional Discount Received", "revenue", "discount_received"],
    ["5169", "Other Discounts Received", "revenue", "discount_received"],
    // Other Professional Services Revenue
    ["4230", "Other Professional Services Revenue", "revenue"],
    ["4231", "Business Consulting Revenue", "revenue"],
    ["4232", "Management Consulting Revenue", "revenue"],
    ["4233", "Financial Consulting Revenue", "revenue"],
    ["4234", "Accounting and Bookkeeping Services Revenue", "revenue"],
    ["4235", "Business Advisory Revenue", "revenue"],
    ["4236", "Project Management Consulting Revenue", "revenue"],
    ["4237", "Research and Analysis Services Revenue", "revenue"],
    ["4238", "Documentation and Technical Writing Revenue", "revenue"],
    ["4239", "Professional Training and Development Revenue", "revenue"],
    ["4240", "Administrative Support Services Revenue", "revenue"],
    ["4245", "Other Specialist Professional Services Revenue", "revenue"],
    // Other Professional Services Expenses
    ["6410", "Other Professional Services Expenses", "expense"],
    ["6411", "Legal and Advisory Services", "expense"],
    ["6412", "External Accounting Services", "expense"],
    ["6413", "External Bookkeeping Services", "expense"],
    ["6414", "Business Consulting Expenses", "expense"],
    ["6417", "Audit and Assurance Services", "expense"],
    ["6418", "Tax Advisory Services", "expense"],
    ["6421", "Independent Contractor Services", "expense"],
    ["6426", "Other Specialist Consultancy Expenses", "expense"],
    // Accounting-engine accounts (FX, inventory, payroll)
    ["4211", "Unrealized Foreign Exchange Gain", "revenue", "fx_unrealized"],
    ["6391", "Unrealized Foreign Exchange Loss", "expense", "fx_unrealized"],
    ["5200", "Cost of Goods Sold", "expense", "cos"],
    ["5210", "Inventory Losses and Write-downs", "expense", "cos"],
    ["6011", "Employer Pension Expense", "expense"],
    ["2061", "Pension Contributions Payable", "liability", "payroll"],
    ["2062", "Other Payroll Deductions Payable", "liability", "payroll"],

    ];
  for (const [code, name, type, subtype] of rows) {
    if (store.accounts.some((a) => a.code === code)) continue;
    store.accounts.push({
      id: crypto.randomUUID(),
      code,
      name,
      type,
      subtype,
      currency: "GHS",
      active: true,
    });
  }
  store.seededCoa = true;
}

function byCode(code: string) {
  return store.accounts.find((a) => a.code === code && a.active);
}

function lineTotals(lines: { debit: number; credit: number }[]) {
  let d = 0, c = 0;
  for (const l of lines) {
    d += Math.round(Number(l.debit) || 0);
    c += Math.round(Number(l.credit) || 0);
  }
  return { debit: d, credit: c, balanced: d === c, difference: d - c };
}

/** Year-end closing journals only move temporary accounts into equity; they are not period activity. */
function isClosingJournal(j: { journalType: string }) {
  return j.journalType === "closing";
}

function accountBalance(code: string, asOf?: string, preClosing: boolean | string = false): number {
  let bal = 0;
  const acc = byCode(code);
  if (!acc) return 0;
  for (const j of store.journals) {
    if (j.status !== "posted") continue;
    if (preClosing && isClosingJournal(j) && (preClosing === true || j.entryDate >= preClosing)) continue;
    if (asOf && j.entryDate > asOf) continue;
    for (const l of j.lines) {
      if (l.accountCode !== code) continue;
      if (acc.type === "asset" || acc.type === "expense") bal += l.debit - l.credit;
      else bal += l.credit - l.debit;
    }
  }
  return bal;
}

function trialBalance(asOf?: string, preClosing = false) {
  ensureCoa();
  const rows = store.accounts.filter((a) => a.active).map((a) => {
    const bal = accountBalance(a.code, asOf, preClosing);
    const debit = bal > 0 && (a.type === "asset" || a.type === "expense") ? bal
      : bal < 0 && !(a.type === "asset" || a.type === "expense") ? -bal
      : bal > 0 && !(a.type === "asset" || a.type === "expense") ? 0
      : bal < 0 && (a.type === "asset" || a.type === "expense") ? 0
      : 0;
    // Present natural balance side
    let dr = 0, cr = 0;
    if (a.type === "asset" || a.type === "expense") {
      if (bal >= 0) dr = bal; else cr = -bal;
    } else {
      if (bal >= 0) cr = bal; else dr = -bal;
    }
    return { code: a.code, name: a.name, type: a.type, debit: dr, credit: cr, balance: bal };
  }).filter((r) => r.debit !== 0 || r.credit !== 0);
  const totD = rows.reduce((s, r) => s + r.debit, 0);
  const totC = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit: totD, totalCredit: totC, balanced: totD === totC, asOf: asOf || null, currency: "GHS" };
}

function accountPeriodBalance(code: string, from?: string, to?: string): number {
  const acc = byCode(code);
  if (!acc) return 0;
  let bal = 0;
  for (const j of store.journals) {
    if (j.status !== "posted") continue;
    if (isClosingJournal(j)) continue; // period activity excludes closing entries
    if (from && j.entryDate < from) continue;
    if (to && j.entryDate > to) continue;
    for (const l of j.lines) {
      if (l.accountCode !== code) continue;
      if (acc.type === "asset" || acc.type === "expense") bal += l.debit - l.credit;
      else bal += l.credit - l.debit;
    }
  }
  return bal;
}

function pnl(from?: string, to?: string) {
  ensureCoa();
  let grossRevenue = 0;
  let discountAllowed = 0;
  let discountReceived = 0;
  let expense = 0;
  for (const a of store.accounts.filter((x) => x.active)) {
    if (a.type !== "revenue" && a.type !== "expense") continue;
    const bal = accountPeriodBalance(a.code, from, to);
    if (a.subtype === "discount_allowed") {
      discountAllowed += bal; // expense-type debit balance
      continue;
    }
    if (a.subtype === "discount_received") {
      discountReceived += bal; // revenue-type credit balance
      continue;
    }
    if (a.type === "revenue") grossRevenue += bal;
    else expense += bal;
  }
  const netRevenue = grossRevenue - discountAllowed;
  const netExpense = expense - discountReceived;
  return {
    grossRevenue,
    discountAllowed,
    netRevenue,
    discountReceived,
    expense,
    netExpense,
    revenue: netRevenue,
    netProfit: netRevenue - expense + discountReceived,
    from: from || null,
    to: to || null,
    currency: "GHS",
    note: "Gross revenue less Discount Allowed; Discount Received reduces related cost/expense. Posted journals only.",
  };
}

function balanceSheet(asOf?: string) {
  ensureCoa();
  let assets = 0, liabilities = 0, equity = 0;
  for (const a of store.accounts.filter((x) => x.active)) {
    const bal = accountBalance(a.code, asOf);
    if (a.type === "asset") assets += bal;
    else if (a.type === "liability") liabilities += bal;
    else if (a.type === "equity") equity += bal;
  }
  // Earnings not yet closed to retained earnings = cumulative revenue-type minus expense-type balances
  // (closing journals included, so a closed year is counted once, inside Retained Earnings).
  let unclosed = 0;
  for (const a of store.accounts.filter((x) => x.active)) {
    if (a.type === "revenue") unclosed += accountBalance(a.code, asOf);
    else if (a.type === "expense") unclosed -= accountBalance(a.code, asOf);
  }
  equity += unclosed;
  return {
    assets,
    liabilities,
    equity,
    balanced: assets === liabilities + equity,
    equation: `A(${assets}) = L(${liabilities}) + E(${equity})`,
    asOf: asOf || null,
    currency: "GHS",
  };
}



function isCashAccount(a: Account) {
  return a.subtype === "cash" || a.subtype === "bank" || a.code === "1010" || a.code === "1020" || a.code === "1030" || a.code === "1040";
}

/** Cash flow from posted cash/bank movements + non-cash depreciation note. Amounts in minor units. */
function cashFlow(from?: string, to?: string) {
  ensureCoa();
  let operatingIn = 0, operatingOut = 0, investingOut = 0, financingIn = 0, financingOut = 0;
  let depreciationNonCash = 0;
  const movements: { date: string; journal: string; type: string; amountMinor: number; memo: string }[] = [];

  for (const j of store.journals) {
    if (j.status !== "posted") continue;
    if (from && j.entryDate < from) continue;
    if (to && j.entryDate > to) continue;
    let cashDelta = 0;
    for (const l of j.lines) {
      const acc = byCode(l.accountCode);
      if (!acc || !isCashAccount(acc)) continue;
      // Asset: debit increases cash
      cashDelta += (Number(l.debit) || 0) - (Number(l.credit) || 0);
    }
    if (j.journalType === "depreciation") {
      const dep = j.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      depreciationNonCash += dep;
      continue;
    }
    if (cashDelta === 0) continue;
    const abs = Math.abs(cashDelta);
    const jt = j.journalType || "general";
    if (jt === "cash_receipt" || jt === "sales" || cashDelta > 0 && (jt === "general" || jt === "receipt")) {
      if (cashDelta > 0) operatingIn += cashDelta;
      else operatingOut += abs;
    } else if (jt === "purchase" || jt === "expense" || jt === "payment") {
      if (cashDelta < 0) operatingOut += abs;
      else operatingIn += cashDelta;
    } else if (jt === "asset_purchase" || jt === "capex") {
      investingOut += abs;
    } else if (jt === "loan" || jt === "equity" || jt === "owner") {
      if (cashDelta > 0) financingIn += cashDelta;
      else financingOut += abs;
    } else {
      if (cashDelta > 0) operatingIn += cashDelta;
      else operatingOut += abs;
    }
    movements.push({
      date: j.entryDate,
      journal: j.number,
      type: jt,
      amountMinor: cashDelta,
      memo: j.description || "",
    });
  }

  const netOperating = operatingIn - operatingOut;
  const netInvesting = -investingOut;
  const netFinancing = financingIn - financingOut;
  const netChange = netOperating + netInvesting + netFinancing;

  // Opening / closing cash
  const cashCodes = store.accounts.filter((a) => a.active && isCashAccount(a)).map((a) => a.code);
  let openingCash = 0, closingCash = 0;
  for (const code of cashCodes) {
    if (from) {
      // balance just before from
      const dayBefore = from;
      openingCash += accountBalance(code, /* asOf exclusive: use day before */ (() => {
        const d = new Date(from + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })());
    } else {
      openingCash = 0;
    }
    closingCash += accountBalance(code, to || undefined);
  }
  if (!from) openingCash = closingCash - netChange;

  return {
    from: from || null,
    to: to || null,
    currency: "GHS",
    operating: { inflowsMinor: operatingIn, outflowsMinor: operatingOut, netMinor: netOperating },
    investing: { outflowsMinor: investingOut, netMinor: netInvesting },
    financing: { inflowsMinor: financingIn, outflowsMinor: financingOut, netMinor: netFinancing },
    netChangeMinor: netChange,
    openingCashMinor: openingCash,
    closingCashMinor: closingCash,
    nonCash: { depreciationMinor: depreciationNonCash },
    movements: movements.slice(0, 200),
    method: "direct_from_cash_bank_lines",
    note: "Classified by journal type. Depreciation is non-cash (excluded from cash totals). Amounts are minor units.",
  };
}

function arAging(asOf?: string) {
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const items: any[] = [];
  for (const inv of store.invoices) {
    if (inv.status === "void" || inv.status === "cancelled") continue;
    const bal = inv.amountMinor - inv.amountPaidMinor;
    if (bal <= 0) continue;
    const issue = inv.issueDate || inv.createdAt.slice(0, 10);
    const days = Math.max(0, Math.floor((Date.parse(asOfDate) - Date.parse(issue)) / 86400000));
    let bucket = "current";
    if (days <= 0) bucket = "current";
    else if (days <= 30) bucket = "d1_30";
    else if (days <= 60) bucket = "d31_60";
    else if (days <= 90) bucket = "d61_90";
    else bucket = "d90_plus";
    (buckets as any)[bucket] += bal;
    items.push({
      number: inv.number,
      customerName: inv.customerName,
      issueDate: issue,
      dueDate: inv.dueDate,
      balanceMinor: bal,
      daysOutstanding: days,
      bucket,
      status: inv.status,
    });
  }
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  return { asOf: asOfDate, currency: "GHS", buckets, totalMinor: total, items };
}

function depreciationSchedule() {
  return {
    currency: "GHS",
    policy: "Computers/laptops: 25% p.a. straight-line accounting depreciation (not Ghana tax capital allowance).",
    items: store.fixedAssets.map((a) => {
      const base = a.costMinor - a.residualMinor;
      const annual = Math.round((base * a.depreciationRateBps) / 10000);
      const monthly = Math.round(annual / 12);
      return {
        assetNumber: a.assetNumber,
        name: a.name,
        category: a.category,
        acquisitionDate: a.acquisitionDate,
        inServiceDate: a.inServiceDate,
        costMinor: a.costMinor,
        residualMinor: a.residualMinor,
        ratePct: a.depreciationRateBps / 100,
        annualDepreciationMinor: annual,
        monthlyDepreciationMinor: monthly,
        accumulatedMinor: a.accumulatedMinor,
        netBookValueMinor: Math.max(0, a.costMinor - a.residualMinor - a.accumulatedMinor),
        status: a.status,
      };
    }),
  };
}

/** Statement of changes in equity — simplified from equity account movements + P&L. */
function equityStatement(from?: string, to?: string) {
  ensureCoa();
  const equityAccounts = store.accounts.filter((a) => a.active && a.type === "equity");
  const opening: Record<string, number> = {};
  const closing: Record<string, number> = {};
  for (const a of equityAccounts) {
    if (from) {
      const d = new Date(from + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      opening[a.code] = accountBalance(a.code, d.toISOString().slice(0, 10));
    } else opening[a.code] = 0;
    closing[a.code] = accountBalance(a.code, to || undefined);
  }
  const p = pnl(from, to);
  return {
    from: from || null,
    to: to || null,
    currency: "GHS",
    opening,
    closing,
    netProfitMinor: p.netProfit,
    note: "Simplified equity roll-forward. Current year earnings reflected via P&L; does not auto-close to retained earnings.",
  };
}

function isComputerCategory(cat: string) {
  return cat === "computer" || cat === "laptop";
}

/** Accounting policy: computers & laptops default 25% SL. Other categories use configured rate. */
function policyRateBps(category: FixedAsset["category"], requested?: number): number {
  if (isComputerCategory(category)) return 2500; // mandatory 25% accounting depreciation (not Ghana tax CA)
  if (requested != null && Number.isFinite(requested) && requested >= 0) return Math.round(requested);
  return 1000; // 10% default for non-computer assets if unspecified
}

function assetNbv(a: FixedAsset) {
  return Math.max(0, a.costMinor - a.residualMinor - a.accumulatedMinor);
}

function depreciableRemaining(a: FixedAsset) {
  return Math.max(0, a.costMinor - a.residualMinor - a.accumulatedMinor);
}

/** Monthly straight-line charge in minor units (integer). */
function monthlyDepreciationMinor(a: FixedAsset): number {
  const base = a.costMinor - a.residualMinor;
  if (base <= 0) return 0;
  const annual = Math.round((base * a.depreciationRateBps) / 10000);
  return Math.max(0, Math.round(annual / 12));
}

function periodYm(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function integrityReport() {
  const issues: { code: string; message: string; ref?: string }[] = [];
  for (const j of store.journals) {
    const d = j.lines.reduce((s, l) => s + l.debit, 0);
    const c = j.lines.reduce((s, l) => s + l.credit, 0);
    if (d !== c) issues.push({ code: "UNBALANCED_JOURNAL", message: `Journal ${j.number} debit ${d} != credit ${c}`, ref: j.id });
    if (j.status === "posted" && j.lines.length < 2) issues.push({ code: "THIN_JOURNAL", message: `Posted journal ${j.number} has fewer than 2 lines`, ref: j.id });
  }
  for (const a of store.fixedAssets) {
    if (a.accumulatedMinor > a.costMinor - a.residualMinor) {
      issues.push({ code: "OVER_DEPRECIATED", message: `Asset ${a.assetNumber} accumulated exceeds depreciable amount`, ref: a.id });
    }
    if (isComputerCategory(a.category) && a.depreciationRateBps !== 2500 && a.status === "active") {
      issues.push({ code: "POLICY_RATE", message: `Asset ${a.assetNumber} computer/laptop must use 25% (2500 bps)`, ref: a.id });
    }
  }
  const tb = trialBalance();
  if (!tb.balanced) {
    issues.push({ code: "TB_OUT_OF_BALANCE", message: `Trial balance out of balance Dr ${tb.totalDebit} Cr ${tb.totalCredit}` });
  }
  for (const p of store.periods) {
    if (p.status === "closed") {
      const posts = store.journals.filter((j) => j.status === "posted" && periodYmFromDate(j.entryDate) === p.periodYm);
      // informational only — presence of closed period is not an error
    }
  }
  const closedCount = store.periods.filter((p) => p.status === "closed").length;
  return { ok: issues.length === 0, issues, journalCount: store.journals.length, assetCount: store.fixedAssets.length, closedPeriods: closedCount };

}

function periodYmFromDate(dateStr: string): string {
  const d = String(dateStr || "").slice(0, 10);
  if (d.length >= 7) return d.slice(0, 7);
  return periodYm();
}

function findPeriod(periodYm: string): AccountingPeriod | undefined {
  return store.periods.find((p) => p.periodYm === periodYm);
}

function isPeriodClosed(dateStr: string): boolean {
  const ym = periodYmFromDate(dateStr);
  const p = findPeriod(ym);
  return Boolean(p && p.status === "closed");
}

/** Ensure period exists (open by default) when first referenced. */
function ensurePeriod(periodYm: string): AccountingPeriod {
  let p = findPeriod(periodYm);
  if (p) return p;
  p = {
    id: crypto.randomUUID(),
    periodYm,
    status: "open",
    label: periodYm,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.periods.push(p);
  return p;
}

function assertPeriodOpenForPosting(entryDate: string) {
  const ym = periodYmFromDate(entryDate);
  const p = ensurePeriod(ym);
  if (p.status === "closed") {
    throw new Error(
      `Accounting period ${ym} is closed. Reopen the period with authorization before posting, or use an open period date.`,
    );
  }
}

const DEDUP_TYPES = new Set(["closing", "depreciation", "fx_revaluation", "payroll", "payroll_payment", "restatement"]);

function postJournal(j: Journal, opts: { bypassPeriodLock?: boolean } = {}) {
  const t = lineTotals(j.lines);
  if (!t.balanced) throw new Error(`Unbalanced journal: debit ${t.debit} credit ${t.credit} difference ${t.difference}`);
  if (!j.lines.length) throw new Error("Journal has no lines");
  // Duplicate-posting guard: one live posted journal per (type, source module, source id)
  if (j.sourceModule && j.sourceId && DEDUP_TYPES.has(j.journalType)) {
    // depreciation is unique per asset AND month; closing per fiscal year. Other types (e.g. part payments) legitimately repeat.
    const keyOf = (x: { journalType: string; entryDate: string }) => (x.journalType === "depreciation" ? periodYmFromDate(x.entryDate) : "");
    const dup = store.journals.find((x) => x.id !== j.id && x.status === "posted" && !x.reversedBy && x.journalType === j.journalType
      && x.sourceModule === j.sourceModule && x.sourceId === j.sourceId && keyOf(x) === keyOf(j));
    if (dup) throw new Error(`DUPLICATE_POSTING: ${dup.number} already posted for ${j.sourceModule}/${j.sourceId}`);
  }
  if (!opts.bypassPeriodLock) assertPeriodOpenForPosting(j.entryDate || j.postingDate || new Date().toISOString().slice(0, 10));
  j.status = "posted";
  j.postedAt = new Date().toISOString();
  j.postingDate = j.postingDate || j.entryDate;
  audit("journal", j.id, "posted", j.number);
}


// ───────────────────────── Accounting Policy & Rules Engine ─────────────────────────
// One authority for effective-dated accounting policies. Modules ask the engine; they never hard-code treatments.
const POLICY_DEFAULTS: Record<string, { value: string; kind: "enum" | "int" | "code"; allowed?: string[]; min?: number; max?: number; doc: string }> = {
  framework: { value: "IFRS_FOR_SMES", kind: "enum", allowed: ["IFRS", "IFRS_FOR_SMES"], doc: "Reporting framework selected for the entity" },
  functionalCurrency: { value: "GHS", kind: "code", doc: "Functional/presentation currency" },
  fiscalYearEndMonth: { value: "12", kind: "int", min: 1, max: 12, doc: "Month in which the fiscal year ends" },
  retainedEarningsCode: { value: "3040", kind: "code", doc: "Account receiving closed profit or loss" },
  drawingsCode: { value: "3060", kind: "code", doc: "Owner drawings account closed to retained earnings at year end" },
  inventoryMethod: { value: "WEIGHTED_AVERAGE", kind: "enum", allowed: ["FIFO", "WEIGHTED_AVERAGE", "SPECIFIC"], doc: "Inventory valuation (consumed by the inventory module when built)" },
  materialityBps: { value: "500", kind: "int", min: 0, max: 10000, doc: "Quantitative materiality as basis points of revenue (restatement assessment)" },
};

/** Policy in force on a date: latest effectiveFrom <= date, else the documented default. */
function policyAt(key: string, date: string): string {
  const d = String(date).slice(0, 10);
  let hit: Policy | undefined;
  for (const p of store.policies) {
    if (p.key !== key || p.effectiveFrom > d) continue;
    if (!hit || p.effectiveFrom > hit.effectiveFrom || (p.effectiveFrom === hit.effectiveFrom && p.createdAt > hit.createdAt)) hit = p;
  }
  return hit ? hit.value : POLICY_DEFAULTS[key]!.value;
}

function validatePolicy(key: string, value: string): string | null {
  const def = POLICY_DEFAULTS[key];
  if (!def) return `Unknown policy key. Allowed: ${Object.keys(POLICY_DEFAULTS).join(", ")}`;
  if (def.kind === "enum" && !def.allowed!.includes(value)) return `Value must be one of ${def.allowed!.join(", ")}`;
  if (def.kind === "int") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < (def.min ?? 0) || n > (def.max ?? 1e9)) return `Value must be an integer ${def.min}..${def.max}`;
  }
  if (def.kind === "code" && !/^[A-Za-z0-9_-]{2,12}$/.test(value)) return "Value must be a short code";
  return null;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Fiscal year `fy` ends in fiscalYearEndMonth of year `fy`; it starts the day after the previous year's end. */
function fiscalRange(fy: number, endMonth: number) {
  const endDate = lastDayOfMonth(fy, endMonth);
  const prev = new Date(lastDayOfMonth(fy - 1, endMonth) + "T00:00:00Z");
  prev.setUTCDate(prev.getUTCDate() + 1);
  return { startDate: prev.toISOString().slice(0, 10), endDate };
}

function monthsBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let y = Number(startDate.slice(0, 4)), m = Number(startDate.slice(5, 7));
  const ey = Number(endDate.slice(0, 4)), em = Number(endDate.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Build the closing lines for a fiscal year from period activity (closing entries excluded → idempotent). */
function buildYearEndClosing(fy: number) {
  const endMonth = Number(policyAt("fiscalYearEndMonth", `${fy}-12-31`));
  const { startDate, endDate } = fiscalRange(fy, endMonth);
  const reCode = policyAt("retainedEarningsCode", endDate);
  const drawCode = policyAt("drawingsCode", endDate);
  const re = byCode(reCode);
  const lines: { accountCode: string; memo: string; debit: number; credit: number }[] = [];
  let net = 0; // profit positive
  for (const a of store.accounts.filter((x) => x.active && (x.type === "revenue" || x.type === "expense"))) {
    const bal = accountPeriodBalance(a.code, startDate, endDate); // natural-side balance
    if (!bal) continue;
    const creditNormal = a.type === "revenue";
    // Zero the account: revenue (credit-normal) is debited, expense (debit-normal) is credited; negatives reverse.
    const debit = creditNormal ? (bal > 0 ? bal : 0) : (bal < 0 ? -bal : 0);
    const credit = creditNormal ? (bal < 0 ? -bal : 0) : (bal > 0 ? bal : 0);
    lines.push({ accountCode: a.code, memo: `Close ${a.name} to ${reCode}`, debit, credit });
    net += creditNormal ? bal : -bal;
  }
  let drawings = 0;
  const dacc = byCode(drawCode);
  if (dacc) {
    const bal = accountPeriodBalance(drawCode, startDate, endDate); // credit-normal; drawings are a debit balance → negative
    if (bal < 0) { drawings = -bal; lines.push({ accountCode: drawCode, memo: `Close drawings to ${reCode}`, debit: 0, credit: drawings }); }
  }
  if (net > 0) lines.push({ accountCode: reCode, memo: `FY${fy} net profit transferred`, debit: 0, credit: net });
  else if (net < 0) lines.push({ accountCode: reCode, memo: `FY${fy} net loss transferred`, debit: -net, credit: 0 });
  if (drawings > 0) lines.push({ accountCode: reCode, memo: `FY${fy} drawings`, debit: drawings, credit: 0 });
  return { fy, startDate, endDate, reCode, reExists: Boolean(re), lines, netResultMinor: net, drawingsMinor: drawings, totals: lineTotals(lines) };
}

function yearEndChecks(fy: number) {
  const c = buildYearEndClosing(fy);
  const blockers: { code: string; message: string }[] = [];
  const drafts = store.journals.filter((j) => j.status === "draft" && j.entryDate >= c.startDate && j.entryDate <= c.endDate);
  if (drafts.length) blockers.push({ code: "DRAFT_JOURNALS", message: `${drafts.length} draft journal(s) in the year must be posted or deleted: ${drafts.slice(0, 5).map((d) => d.number).join(", ")}` });
  const bad = store.journals.filter((j) => !lineTotals(j.lines).balanced);
  if (bad.length) blockers.push({ code: "UNBALANCED_JOURNAL", message: `Unbalanced journals: ${bad.slice(0, 5).map((d) => d.number).join(", ")}` });
  const tb = trialBalance(c.endDate, true);
  if (!tb.balanced) blockers.push({ code: "TB_OUT_OF_BALANCE", message: `Trial balance out of balance Dr ${tb.totalDebit} Cr ${tb.totalCredit}` });
  if (!c.reExists) blockers.push({ code: "NO_RETAINED_EARNINGS_ACCOUNT", message: `Account ${c.reCode} (retained earnings) not found in the chart of accounts` });
  const existing = store.yearCloses.find((y) => y.fiscalYear === fy);
  if (existing && existing.status === "closed") blockers.push({ code: "ALREADY_CLOSED", message: `FY${fy} is already closed (journal ${existing.journalId || "none"})` });
  const prior = store.yearCloses.find((y) => y.fiscalYear === fy - 1);
  const warnings: string[] = [];
  if (!prior || prior.status !== "closed") {
    const earlier = store.journals.some((j) => j.status === "posted" && !isClosingJournal(j) && j.entryDate < c.startDate);
    if (earlier) warnings.push(`FY${fy - 1} has activity but is not closed; close it first so opening retained earnings are correct.`);
  }
  // FX: monetary foreign balances must be revalued to the closing rate before the year can close
  const fxPlan = fxRevaluationPlan(c.endDate.slice(0, 7));
  if (fxPlan.missingRates.length) blockers.push({ code: "FX_RATE_MISSING", message: `Approved closing rate missing for ${fxPlan.missingRates.join(", ")} at ${c.endDate}` });
  else if (fxPlan.lines.length) blockers.push({ code: "FX_REVALUATION_PENDING", message: `Period-end FX revaluation for ${c.endDate.slice(0, 7)} has not been posted (POST fx/revalue)` });
  // Inventory: subledger must equal the general ledger
  const invMoves = docsOf("invMoves");
  if (invMoves.length) {
    if (invMoves.some((m) => m.date > c.endDate)) warnings.push("Inventory has movements after year end; subledger/GL reconciliation was not checked at the year-end date.");
    else {
      const sub = docsOf("invItems").reduce((t, i) => t + invOnHand(i.id).costMinor, 0);
      const gl = accountBalance("1090", c.endDate);
      if (sub !== gl) blockers.push({ code: "INVENTORY_NOT_RECONCILED", message: `Inventory subledger ${sub} differs from general ledger ${gl}` });
    }
  }
  // Payroll: no unapproved runs inside the year; unpaid approved runs are disclosed
  const runs = docsOf("payrollRuns").filter((r) => r.status !== "void" && r.periodYm >= c.startDate.slice(0, 7) && r.periodYm <= c.endDate.slice(0, 7));
  const uncalc = runs.filter((r) => r.status === "calculated");
  if (uncalc.length) blockers.push({ code: "PAYROLL_UNAPPROVED", message: `Payroll runs not approved: ${uncalc.map((r) => r.periodYm).join(", ")}` });
  const unpaid = runs.filter((r) => r.status === "approved");
  if (unpaid.length) warnings.push(`Approved payroll not yet paid (carried as Net Salaries Payable): ${unpaid.map((r) => r.periodYm).join(", ")}`);
  warnings.push("Not automated and therefore NOT verified by this check: bank reconciliation, tax accounts, leases/financial instruments.");
  return { closing: c, blockers, warnings, canClose: blockers.length === 0 };
}

// ───────────────────────── Accounting engine: FX · Inventory · Payroll · Restatements ─────────────────────────
// All amounts are integer MINOR units. Rates are integers scaled by 1,000,000 (rateMicro) — no float drift.
const RATE_SCALE = 1_000_000;
const docsOf = (kind: string): any[] => Object.values(store.docs[kind] || {});
const mulDiv = (a: number, b: number, c: number) => Math.round((a * b) / c);

class EngineError extends Error {
  status: number; code: string;
  constructor(message: string, code = "ENGINE_ERROR", status = 409) { super(message); this.code = code; this.status = status; }
}

function toRateMicro(rate: unknown): number {
  const n = Math.round(Number(rate) * RATE_SCALE);
  if (!Number.isFinite(n) || n <= 0) throw new EngineError("rate must be a positive number (max 6 decimals)", "BAD_RATE", 400);
  return n;
}

/** Approved rate of `type` for a currency, latest on/before `asOf`. */
function fxRateAt(currency: string, asOf: string, type = "closing"): { rateMicro: number; rateDate: string; source: string } | null {
  let best: any = null;
  for (const r of docsOf("fxRates")) {
    if (r.currency !== currency || r.type !== type || r.status !== "approved" || r.rateDate > asOf) continue;
    if (!best || r.rateDate > best.rateDate || (r.rateDate === best.rateDate && r.createdAt > best.createdAt)) best = r;
  }
  return best ? { rateMicro: best.rateMicro, rateDate: best.rateDate, source: best.source } : null;
}

/** Only monetary items are revalued; inventory, fixed assets, prepayments, deferred revenue are non-monetary. */
function isMonetaryFx(a: Account) {
  if (a.type === "asset") return a.subtype === "cash" || a.subtype === "bank" || a.subtype === "ar" || a.code === "1070";
  if (a.type === "liability") return a.subtype === "ap" || ["2030", "2140", "2150"].includes(a.code);
  return false;
}

interface FxPosition { code: string; name: string; type: AccountType; currency: string; netFc: number; histMinor: number; revalMinor: number }

/** Open foreign-currency positions by monetary account & currency. Natural sign (assets +debit, liabilities +credit). */
function fxPositions(asOf?: string): FxPosition[] {
  const out = new Map<string, FxPosition>();
  for (const j of store.journals) {
    if (j.status !== "posted" || (asOf && j.entryDate > asOf)) continue;
    for (const l of j.lines) {
      if (!l.fcCurrency) continue;
      const a = byCode(l.accountCode);
      if (!a || !isMonetaryFx(a)) continue;
      const sign = a.type === "asset" ? 1 : -1;
      const k = `${a.code}|${l.fcCurrency}`;
      let r = out.get(k);
      if (!r) { r = { code: a.code, name: a.name, type: a.type, currency: l.fcCurrency, netFc: 0, histMinor: 0, revalMinor: 0 }; out.set(k, r); }
      const net = sign * (l.debit - l.credit);
      if (l.fxKind === "reval") r.revalMinor += net;
      else { r.histMinor += net; r.netFc += sign * (l.debit > 0 ? 1 : -1) * (l.fcAmount || 0); }
    }
  }
  return [...out.values()].filter((p) => p.netFc !== 0 || p.histMinor !== 0 || p.revalMinor !== 0);
}

type NewLine = { accountCode: string; memo?: string; debit: number; credit: number; fcCurrency?: string; fcAmount?: number; rateMicro?: number; fxKind?: "reval" };

function fxRevaluationPlan(periodYm: string) {
  const [y, m] = periodYm.split("-").map(Number) as [number, number];
  const end = lastDayOfMonth(y, m);
  const lines: NewLine[] = [];
  const detail: any[] = [];
  const missingRates: string[] = [];
  for (const pos of fxPositions(end)) {
    const rate = fxRateAt(pos.currency, end, "closing");
    if (!rate) { if (!missingRates.includes(pos.currency)) missingRates.push(pos.currency); continue; }
    const carrying = pos.histMinor + pos.revalMinor;
    const revalued = mulDiv(pos.netFc, rate.rateMicro, RATE_SCALE);
    const diff = revalued - carrying; // natural-sign difference
    detail.push({ account: pos.code, currency: pos.currency, foreignBalance: pos.netFc, closingRateMicro: rate.rateMicro, rateDate: rate.rateDate, rateSource: rate.source, carrying, revalued, difference: diff });
    if (!diff) continue;
    const acc = { fcCurrency: pos.currency, fcAmount: 0, rateMicro: rate.rateMicro, fxKind: "reval" as const };
    const up = Math.abs(diff);
    const gain = pos.type === "asset" ? diff > 0 : diff < 0; // asset up / liability down = gain
    const accDebit = pos.type === "asset" ? diff > 0 : diff < 0; // account side that increases/decreases balance
    lines.push({ accountCode: pos.code, memo: `FX reval ${pos.currency} @ ${rate.rateMicro / RATE_SCALE}`, debit: accDebit ? up : 0, credit: accDebit ? 0 : up, ...acc });
    lines.push({ accountCode: gain ? "4211" : "6391", memo: `Unrealized FX ${gain ? "gain" : "loss"} ${pos.currency}`, debit: gain ? 0 : up, credit: gain ? up : 0 });
  }
  return { periodYm, entryDate: end, lines, detail, missingRates, method: "cumulative: each revaluation adjusts the carrying amount (cost + prior revaluations) to the closing rate, so prior unrealized amounts are reversed implicitly and never double counted" };
}

function fxSettlementLines(accountCode: string, currency: string, fcAmount: number, settleRateMicro: number, date: string, counterCode: string): NewLine[] {
  const acc = byCode(accountCode);
  if (!acc || !isMonetaryFx(acc)) throw new EngineError(`${accountCode} is not a monetary foreign-currency account`, "NOT_MONETARY", 400);
  const pos = fxPositions(date).find((p) => p.code === accountCode && p.currency === currency);
  if (!pos || pos.netFc <= 0) throw new EngineError(`No open ${currency} balance on ${accountCode} at ${date}`, "NO_OPEN_POSITION");
  if (fcAmount <= 0 || fcAmount > pos.netFc) throw new EngineError(`fcAmount must be 1..${pos.netFc}`, "BAD_AMOUNT", 400);
  const full = fcAmount === pos.netFc;
  const hist = full ? pos.histMinor : mulDiv(pos.histMinor, fcAmount, pos.netFc);
  const rp = full ? pos.revalMinor : mulDiv(pos.revalMinor, fcAmount, pos.netFc);
  const proceeds = mulDiv(fcAmount, settleRateMicro, RATE_SCALE);
  const isAsset = acc.type === "asset";
  const fc = { fcCurrency: currency, rateMicro: settleRateMicro };
  const lines: NewLine[] = [];
  // derecognise carrying amount (natural decrease: asset credit / liability debit); negative amounts flip side
  const dec = (amt: number, extra: Partial<NewLine>): NewLine => {
    const debitSide = isAsset ? amt < 0 : amt > 0;
    return { accountCode, debit: debitSide ? Math.abs(amt) : 0, credit: debitSide ? 0 : Math.abs(amt), ...extra };
  };
  if (hist) lines.push(dec(hist, { memo: `Settle ${currency} ${fcAmount}`, ...fc, fcAmount }));
  if (rp) lines.push(dec(rp, { memo: "Derecognise prior unrealized revaluation", fcCurrency: currency, fcAmount: 0, rateMicro: settleRateMicro, fxKind: "reval" }));
  if (isAsset) lines.push({ accountCode: counterCode, memo: `Receipt ${currency} ${fcAmount}`, debit: proceeds, credit: 0 });
  else lines.push({ accountCode: counterCode, memo: `Payment ${currency} ${fcAmount}`, debit: 0, credit: proceeds });
  const realized = isAsset ? proceeds - hist : hist - proceeds; // positive = gain (total vs original cost)
  if (realized > 0) lines.push({ accountCode: "4210", memo: `Realized FX gain ${currency}`, debit: 0, credit: realized });
  else if (realized < 0) lines.push({ accountCode: "6390", memo: `Realized FX loss ${currency}`, debit: -realized, credit: 0 });
  // reverse the unrealized amount previously recognised on the settled portion
  if (rp) {
    const prevGain = isAsset ? rp > 0 : rp < 0;
    const amt = Math.abs(rp);
    lines.push({ accountCode: prevGain ? "4211" : "6391", memo: "Reverse prior unrealized FX", debit: prevGain ? amt : 0, credit: prevGain ? 0 : amt });
  }
  return lines;
}

// ── Inventory ──
function invLayersOf(itemId: string): any[] {
  return docsOf("invLayers").filter((l) => l.itemId === itemId && l.remainingQty > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}
function invOnHand(itemId: string) {
  const ls = invLayersOf(itemId);
  return { qty: ls.reduce((t, l) => t + l.remainingQty, 0), costMinor: ls.reduce((t, l) => t + l.remainingCostMinor, 0), layers: ls };
}

/** Cost `qty` units out of stock per method. Returns consumption and the layers to persist. */
function invConsume(itemId: string, qty: number, method: string, layerId?: string) {
  const oh = invOnHand(itemId);
  if (qty <= 0 || !Number.isInteger(qty)) throw new EngineError("qty must be a positive integer", "BAD_QTY", 400);
  if (qty > oh.qty) throw new EngineError(`Insufficient stock: on hand ${oh.qty}, requested ${qty} (negative inventory is not allowed)`, "INSUFFICIENT_STOCK");
  const consumed: { layerId: string; qty: number; costMinor: number }[] = [];
  const take = (l: any, q: number, cost: number) => { l.remainingQty -= q; l.remainingCostMinor -= cost; consumed.push({ layerId: l.id, qty: q, costMinor: cost }); };
  if (method === "FIFO") {
    let need = qty;
    for (const l of oh.layers) {
      if (!need) break;
      const q = Math.min(need, l.remainingQty);
      take(l, q, q === l.remainingQty ? l.remainingCostMinor : mulDiv(l.remainingCostMinor, q, l.remainingQty));
      need -= q;
    }
  } else if (method === "SPECIFIC") {
    const l = oh.layers.find((x) => x.id === layerId);
    if (!l) throw new EngineError("layerId required for SPECIFIC identification", "LAYER_REQUIRED", 400);
    if (qty > l.remainingQty) throw new EngineError(`Layer has only ${l.remainingQty} units`, "INSUFFICIENT_STOCK");
    take(l, qty, qty === l.remainingQty ? l.remainingCostMinor : mulDiv(l.remainingCostMinor, qty, l.remainingQty));
  } else { // WEIGHTED_AVERAGE — pro-rata across layers at the average unit cost
    const total = qty === oh.qty ? oh.costMinor : mulDiv(oh.costMinor, qty, oh.qty);
    let qAlloc = 0, cAlloc = 0;
    oh.layers.forEach((l, i) => {
      const last = i === oh.layers.length - 1;
      const q = last ? qty - qAlloc : Math.min(l.remainingQty, mulDiv(qty, l.remainingQty, oh.qty));
      const c = last ? total - cAlloc : mulDiv(total, q, qty);
      qAlloc += q; cAlloc += c;
      if (q > 0 || c > 0) take(l, q, c);
    });
  }
  return { costMinor: consumed.reduce((t, c) => t + c.costMinor, 0), consumed, touched: consumed.map((c) => store.docs["invLayers"]![c.layerId]) };
}

// ── Payroll ──
interface PayeBand { upToMinor: number | null; rateBps: number }
function payeOn(taxable: number, bands: PayeBand[]): number {
  let tax = 0, lower = 0;
  for (const b of bands) {
    const upper = b.upToMinor == null ? Infinity : b.upToMinor;
    if (taxable > lower) tax += ((Math.min(taxable, upper) - lower) * b.rateBps) / 10000;
    lower = upper;
    if (taxable <= upper) break;
  }
  return Math.round(tax);
}
function payrollRuleAt(date: string) {
  let best: any = null;
  for (const r of docsOf("payrollRules")) if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}
/**
 * Payroll line for one employee under one effective-dated rule. All rule fields beyond the PAYE bands and the two
 * pension rates are optional, so a country without them (or a rule that omits them) simply skips that treatment.
 *  - pension base clamped to the insurable-earnings floor/cap (pensionBaseMinMinor / pensionBaseMaxMinor)
 *  - bonus: concessional flat rate up to a share of annual basic (year-to-date aware), excess taxed as ordinary income
 *  - overtime: junior-staff concession (low rate up to a share of basic, higher rate above), else ordinary income
 *  - non-residents: flat rate on chargeable income, separate flat rate on bonus/overtime
 */
function payrollCalc(rule: any, emp: any, adj: any, ytdBonusConcessionMinor = 0) {
  const basic = Math.round(emp.basicMinor || 0);
  const allowances = Object.values(emp.allowances || {}).reduce((t: number, v: any) => t + Math.round(Number(v) || 0), 0);
  const overtime = Math.round(adj?.overtimeMinor || 0), bonus = Math.round(adj?.bonusMinor || 0), commission = Math.round(adj?.commissionMinor || 0);
  const other = Math.round(adj?.otherDeductionsMinor || 0);
  const gross = basic + allowances + overtime + bonus + commission;
  const enrolled = emp.pensionEnrolled !== false;
  let base = rule.pensionBase === "gross" ? gross : basic;
  if (rule.pensionBaseMaxMinor != null) base = Math.min(base, rule.pensionBaseMaxMinor);
  if (rule.pensionBaseMinMinor != null) base = Math.max(base, rule.pensionBaseMinMinor);
  const employeePension = enrolled ? mulDiv(base, rule.employeePensionBps, 10000) : 0;
  const employerPension = enrolled ? mulDiv(base, rule.employerPensionBps, 10000) : 0;
  const relief = rule.pensionDeductibleForPaye === false ? 0 : employeePension;
  const nonResident = emp.nonResident === true && rule.nonResidentFlatBps != null;

  let ordinary = basic + allowances + commission;
  let bonusConcession = 0, bonusTax = 0, overtimeTax = 0, taxable: number, paye: number;
  if (nonResident) {
    taxable = Math.max(0, ordinary - relief);
    paye = mulDiv(taxable, rule.nonResidentFlatBps, 10000) + mulDiv(bonus + overtime, rule.nonResidentBonusOvertimeBps ?? rule.nonResidentFlatBps, 10000);
  } else {
    if (bonus > 0 && rule.bonusConcessionBps != null) {
      const cap = mulDiv(basic * 12, rule.bonusCapBps ?? 0, 10000);
      bonusConcession = Math.min(bonus, Math.max(0, cap - ytdBonusConcessionMinor));
      bonusTax = mulDiv(bonusConcession, rule.bonusConcessionBps, 10000);
      ordinary += bonus - bonusConcession;           // excess bonus is ordinary income
    } else ordinary += bonus;
    const juniorOvertime = overtime > 0 && emp.juniorStaff === true && rule.overtimeLowBps != null
      && (basic + allowances) * 12 <= (rule.overtimeJuniorIncomeLimitMinor ?? 0);
    if (juniorOvertime) {
      const lowBand = mulDiv(basic, rule.overtimeBasicThresholdBps ?? 5000, 10000);
      overtimeTax = mulDiv(Math.min(overtime, lowBand), rule.overtimeLowBps, 10000) + mulDiv(Math.max(0, overtime - lowBand), rule.overtimeHighBps ?? rule.overtimeLowBps, 10000);
    } else ordinary += overtime;
    taxable = Math.max(0, ordinary - relief);
    paye = payeOn(taxable, rule.payeBands) + bonusTax + overtimeTax;
  }
  const net = gross - employeePension - paye - other;
  return { employeeId: emp.id, name: emp.name, basic, allowances, overtime, bonus, commission, gross, insurableBase: base, employeePension, employerPension, taxable, bonusConcession, bonusTax, overtimeTax, paye, otherDeductions: other, net };
}

// ── Restatement statements ──
function fyBalances(startDate: string, endDate: string) {
  const cum = new Map<string, number>(), act = new Map<string, number>();
  for (const a of store.accounts.filter((x) => x.active)) {
    const c = accountBalance(a.code, endDate, startDate); // excludes the FY's own closing entry
    if (c) cum.set(a.code, c);
    if (a.type === "revenue" || a.type === "expense") { const v = accountPeriodBalance(a.code, startDate, endDate); if (v) act.set(a.code, v); }
  }
  return { cum, act };
}
function statementsOf(cum: Map<string, number>, act: Map<string, number>) {
  let assets = 0, liabilities = 0, eqAcc = 0, revC = 0, expC = 0, revenue = 0, expense = 0;
  for (const a of store.accounts) {
    const c = cum.get(a.code) || 0;
    if (a.type === "asset") assets += c; else if (a.type === "liability") liabilities += c; else if (a.type === "equity") eqAcc += c;
    else if (a.type === "revenue") revC += c; else expC += c;
    const v = act.get(a.code) || 0;
    if (a.type === "revenue") revenue += v; else if (a.type === "expense") expense += v;
  }
  const equity = eqAcc + revC - expC;
  return { revenue, expense, netProfit: revenue - expense, assets, liabilities, equity, balanced: assets === liabilities + equity };
}
function applyAdjustments(maps: { cum: Map<string, number>; act: Map<string, number> }, adj: { accountCode: string; debit: number; credit: number }[]) {
  const cum = new Map(maps.cum), act = new Map(maps.act);
  for (const l of adj) {
    const a = byCode(l.accountCode)!;
    const d = a.type === "asset" || a.type === "expense" ? l.debit - l.credit : l.credit - l.debit;
    cum.set(a.code, (cum.get(a.code) || 0) + d);
    if (a.type === "revenue" || a.type === "expense") act.set(a.code, (act.get(a.code) || 0) + d);
  }
  return { cum, act };
}

// ── Statutory presets (DATA, not logic). Each rule is effective-dated and cites its source. ──
// Ghana, verified 2026-11-05 against the GRA PAYE page and the SSNIT public notice of 13 Jan 2026.
const PAYROLL_PRESETS = [
  {
    key: "ghana-2026",
    country: "GH",
    label: "Ghana 2026 (GRA PAYE · SSNIT)",
    verifiedOn: "2026-11-05",
    reviewBy: "2026-12-31",
    caution: "Ghana's Budget Statement (November) can change bands and the SSNIT insurable-earnings limits from January. Confirm the figures before each year's first payroll.",
    sources: [
      "https://gra.gov.gh/domestic-tax/tax-types/paye/ — monthly bands effective 1 Sep 2026 (Income Tax (Amendment) Act 2026, Act 1178); SSNIT 5.5% of basic deductible; bonus, overtime and non-resident rules",
      "https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf — insurable earnings GHS 587.80 to GHS 69,000 per month from 1 Jan 2026",
      "SSNIT contribution split 5.5% employee / 13% employer of basic salary (SSNIT guidance as summarised by payroll references)",
    ],
    common: {
      employeePensionBps: 550, employerPensionBps: 1300, pensionBase: "basic", pensionDeductibleForPaye: true,
      pensionBaseMinMinor: 58780, pensionBaseMaxMinor: 6900000,
      bonusConcessionBps: 500, bonusCapBps: 1500,
      overtimeLowBps: 500, overtimeHighBps: 1000, overtimeBasicThresholdBps: 5000, overtimeJuniorIncomeLimitMinor: 1800000,
      nonResidentFlatBps: 2500, nonResidentBonusOvertimeBps: 2000,
    },
    rules: [
      {
        effectiveFrom: "2026-01-01",
        source: "monthly PAYE bands in force 1 Jan–31 Aug 2026 (first band GHS 490/month per GRA's statement of the previous rate); remaining bands are the annual scale 5,880 / 1,320 / 1,560 / 38,000 / 192,000 / 366,240 ÷ 12 from published payroll references — confirm against the GRA schedule if you pay prior months",
        // cumulative monthly upper limits in pesewas
        payeBands: [
          { upToMinor: 49000, rateBps: 0 }, { upToMinor: 60000, rateBps: 500 }, { upToMinor: 73000, rateBps: 1000 },
          { upToMinor: 389667, rateBps: 1750 }, { upToMinor: 1989667, rateBps: 2500 }, { upToMinor: 5041667, rateBps: 3000 }, { upToMinor: null, rateBps: 3500 },
        ],
      },
      {
        effectiveFrom: "2026-09-01",
        source: "GRA monthly PAYE table, Year of Assessment 2026, effective 1 Sep 2026 (588 / next 80 / next 100 / next 2,900 / next 16,000 / next 30,332 / above 50,000)",
        payeBands: [
          { upToMinor: 58800, rateBps: 0 }, { upToMinor: 66800, rateBps: 500 }, { upToMinor: 76800, rateBps: 1000 },
          { upToMinor: 366800, rateBps: 1750 }, { upToMinor: 1966800, rateBps: 2500 }, { upToMinor: 5000000, rateBps: 3000 }, { upToMinor: null, rateBps: 3500 },
        ],
      },
    ],
  },
] as const;

type Env = {
  FIN_DB?: D1Database;
  NEXUS_DB?: D1Database;
  FIN_ALLOW_MEMORY?: string;
};

type DbMode = "d1" | "memory";

function dbMode(env: Env): DbMode {
  if (env.FIN_DB) return "d1";
  return "memory";
}

function requireDb(env: Env): { mode: DbMode; db?: D1Database; error?: string } {
  if (env.FIN_DB) return { mode: "d1", db: env.FIN_DB };
  if (env.FIN_ALLOW_MEMORY === "1") return { mode: "memory" };
  return {
    mode: "memory",
    error:
      "FIN_DB D1 binding is not configured. Bind cintexa-finance-db as FIN_DB in wrangler.toml / Pages settings. Set FIN_ALLOW_MEMORY=1 only for local development.",
  };
}


const FINANCE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS fin_accounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    subtype TEXT,
    currency TEXT NOT NULL DEFAULT 'GHS',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_journals (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    journal_type TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    posting_date TEXT,
    description TEXT,
    source_module TEXT,
    source_id TEXT,
    currency TEXT NOT NULL DEFAULT 'GHS',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    posted_at TEXT,
    reversed_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS fin_journal_lines (
    id TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    account_code TEXT NOT NULL,
    memo TEXT,
    debit INTEGER NOT NULL DEFAULT 0,
    credit INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fin_lines_journal ON fin_journal_lines(journal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fin_lines_account ON fin_journal_lines(account_code)`,
  `CREATE TABLE IF NOT EXISTS fin_customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    source_module TEXT,
    source_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_invoices (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    customer_id TEXT,
    customer_name TEXT,
    issue_date TEXT NOT NULL,
    due_date TEXT,
    currency TEXT NOT NULL DEFAULT 'GHS',
    amount_minor INTEGER NOT NULL,
    amount_paid_minor INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    source_module TEXT,
    source_id TEXT,
    journal_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT,
    customer_name TEXT,
    payment_date TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GHS',
    method TEXT,
    journal_id TEXT,
    source_module TEXT,
    source_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_audit (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_fixed_assets (
    id TEXT PRIMARY KEY,
    asset_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    acquisition_date TEXT NOT NULL,
    in_service_date TEXT NOT NULL,
    cost_minor INTEGER NOT NULL,
    residual_minor INTEGER NOT NULL DEFAULT 0,
    depreciation_rate_bps INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'straight_line',
    useful_life_months INTEGER,
    accumulated_minor INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    location TEXT,
    custodian TEXT,
    disposal_date TEXT,
    currency TEXT NOT NULL DEFAULT 'GHS',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_depreciation_runs (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    period_ym TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    journal_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (asset_id, period_ym)
  )`,
  `CREATE TABLE IF NOT EXISTS fin_docs (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  )`,
  `CREATE TABLE IF NOT EXISTS fin_policies (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    reason TEXT NOT NULL,
    set_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fin_year_closes (
    id TEXT PRIMARY KEY,
    fiscal_year INTEGER NOT NULL UNIQUE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL,
    net_result_minor INTEGER NOT NULL,
    drawings_minor INTEGER NOT NULL DEFAULT 0,
    journal_id TEXT,
    reversal_journal_id TEXT,
    closed_at TEXT NOT NULL,
    closed_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    reopened_at TEXT,
    reopen_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS fin_periods (
    id TEXT PRIMARY KEY,
    period_ym TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'open',
    label TEXT,
    closed_at TEXT,
    closed_by TEXT,
    close_reason TEXT,
    reopened_at TEXT,
    reopened_by TEXT,
    reopen_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

async function ensureSchema(db: D1Database): Promise<void> {
  for (const sql of FINANCE_SCHEMA_SQL) {
    await db.prepare(sql).run();
  }
  // Foreign-currency leg on journal lines (additive migration; existing rows unaffected)
  try {
    await db.prepare("SELECT fc_currency FROM fin_journal_lines LIMIT 1").first();
  } catch {
    for (const col of ["fc_currency TEXT", "fc_amount INTEGER", "rate_micro INTEGER", "fx_kind TEXT"]) {
      try { await db.prepare(`ALTER TABLE fin_journal_lines ADD COLUMN ${col}`).run(); } catch { /* already added */ }
    }
  }
}

async function d1EnsureCoa(db: D1Database) {
  await ensureSchema(db);
  const row = await db.prepare("SELECT COUNT(*) AS c FROM fin_accounts").first<{ c: number }>();
  if (row && row.c > 0) return;
  // Seed from memory template after ensureCoa() fills store.accounts
  ensureCoa();
  const now = new Date().toISOString();
  const stmts = store.accounts.map((a) =>
    db.prepare(
      "INSERT OR IGNORE INTO fin_accounts (id, code, name, type, subtype, currency, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(a.id, a.code, a.name, a.type, a.subtype || null, a.currency, a.active ? 1 : 0, now),
  );
  // batch in chunks of 25
  for (let i = 0; i < stmts.length; i += 25) {
    await db.batch(stmts.slice(i, i + 25));
  }
}

async function d1LoadAccounts(db: D1Database): Promise<Account[]> {
  await d1EnsureCoa(db);
  const { results } = await db.prepare("SELECT * FROM fin_accounts ORDER BY code").all();
  return (results || []).map((r: any) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    subtype: r.subtype || undefined,
    currency: r.currency || "GHS",
    active: Number(r.active) === 1,
  }));
}

async function d1InsertJournal(db: D1Database, j: Journal) {
  await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO fin_journals (id, number, journal_type, entry_date, posting_date, description, source_module, source_id, currency, status, created_at, posted_at, reversed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      j.id, j.number, j.journalType, j.entryDate, j.postingDate || null, j.description,
      j.sourceModule || null, j.sourceId || null, j.currency, j.status, j.createdAt, j.postedAt || null, j.reversedBy || null,
    ),
    db.prepare(`DELETE FROM fin_journal_lines WHERE journal_id = ?`).bind(j.id),
    ...j.lines.map((l) =>
      db.prepare(
        `INSERT INTO fin_journal_lines (id, journal_id, account_id, account_code, memo, debit, credit, fc_currency, fc_amount, rate_micro, fx_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(l.id, j.id, l.accountId, l.accountCode, l.memo || null, l.debit, l.credit, l.fcCurrency || null, l.fcAmount ?? null, l.rateMicro ?? null, l.fxKind || null),
    ),
  ]);
}

async function d1ListJournals(db: D1Database): Promise<Journal[]> {
  const { results: journals } = await db.prepare("SELECT * FROM fin_journals ORDER BY created_at DESC").all();
  const out: Journal[] = [];
  for (const r of journals || []) {
    const { results: lines } = await db.prepare("SELECT * FROM fin_journal_lines WHERE journal_id = ?").bind(r.id).all();
    out.push({
      id: r.id as string,
      number: r.number as string,
      journalType: r.journal_type as string,
      entryDate: r.entry_date as string,
      postingDate: (r.posting_date as string) || undefined,
      description: (r.description as string) || "",
      sourceModule: (r.source_module as string) || undefined,
      sourceId: (r.source_id as string) || undefined,
      currency: (r.currency as string) || "GHS",
      status: r.status as Journal["status"],
      lines: (lines || []).map((l: any) => ({
        id: l.id,
        accountId: l.account_id,
        accountCode: l.account_code,
        memo: l.memo || undefined,
        debit: Number(l.debit),
        credit: Number(l.credit),
        fcCurrency: l.fc_currency || undefined,
        fcAmount: l.fc_amount == null ? undefined : Number(l.fc_amount),
        rateMicro: l.rate_micro == null ? undefined : Number(l.rate_micro),
        fxKind: l.fx_kind || undefined,
      })),
      createdAt: r.created_at as string,
      postedAt: (r.posted_at as string) || undefined,
      reversedBy: (r.reversed_by as string) || undefined,
    });
  }
  return out;
}

async function d1InsertInvoice(db: D1Database, inv: Invoice) {
  await db.prepare(
    `INSERT OR REPLACE INTO fin_invoices (id, number, customer_id, customer_name, issue_date, due_date, currency, amount_minor, amount_paid_minor, status, source_module, source_id, journal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    inv.id, inv.number, null, inv.customerName, inv.issueDate, inv.dueDate || null, inv.currency,
    inv.amountMinor, inv.amountPaidMinor, inv.status, inv.sourceModule || null, inv.sourceId || null, inv.journalId || null, inv.createdAt,
  ).run();
}

async function d1ListInvoices(db: D1Database): Promise<Invoice[]> {
  const { results } = await db.prepare("SELECT * FROM fin_invoices ORDER BY created_at DESC").all();
  return (results || []).map((r: any) => ({
    id: r.id,
    number: r.number,
    customerName: r.customer_name,
    issueDate: r.issue_date,
    dueDate: r.due_date || undefined,
    currency: r.currency,
    amountMinor: Number(r.amount_minor),
    amountPaidMinor: Number(r.amount_paid_minor),
    status: r.status,
    sourceModule: r.source_module || undefined,
    sourceId: r.source_id || undefined,
    journalId: r.journal_id || undefined,
    createdAt: r.created_at,
  }));
}

async function d1InsertPayment(db: D1Database, pay: Payment) {
  await db.prepare(
    `INSERT OR REPLACE INTO fin_payments (id, invoice_id, customer_name, payment_date, amount_minor, currency, method, journal_id, source_module, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    pay.id, pay.invoiceId || null, pay.customerName, pay.paymentDate, pay.amountMinor, pay.currency,
    pay.method || null, pay.journalId || null, pay.sourceModule || null, pay.sourceId || null, pay.createdAt,
  ).run();
}

async function d1ListPayments(db: D1Database): Promise<Payment[]> {
  const { results } = await db.prepare("SELECT * FROM fin_payments ORDER BY created_at DESC").all();
  return (results || []).map((r: any) => ({
    id: r.id,
    invoiceId: r.invoice_id || undefined,
    customerName: r.customer_name,
    paymentDate: r.payment_date,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    method: r.method || undefined,
    journalId: r.journal_id || undefined,
    sourceModule: r.source_module || undefined,
    sourceId: r.source_id || undefined,
    createdAt: r.created_at,
  }));
}

async function d1ApplyInvoicePaid(db: D1Database, inv: Invoice) {
  await db.prepare("UPDATE fin_invoices SET amount_paid_minor = ?, status = ? WHERE id = ?")
    .bind(inv.amountPaidMinor, inv.status, inv.id).run();
}

async function d1Audit(db: D1Database, entityType: string, entityId: string, action: string, detail?: string) {
  await db.prepare(
    "INSERT INTO fin_audit (id, entity_type, entity_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), entityType, entityId, action, detail || null, new Date().toISOString()).run();
}

async function d1UpsertAsset(db: D1Database, a: FixedAsset) {
  await db.prepare(
    `INSERT OR REPLACE INTO fin_fixed_assets (id, asset_number, name, category, acquisition_date, in_service_date, cost_minor, residual_minor, depreciation_rate_bps, method, useful_life_months, accumulated_minor, status, location, custodian, disposal_date, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(a.id, a.assetNumber, a.name, a.category, a.acquisitionDate, a.inServiceDate, a.costMinor, a.residualMinor, a.depreciationRateBps, a.method,
    a.accumulatedMinor, a.status, a.location || null, a.custodian || null, a.disposalDate || null, a.currency, a.createdAt, a.updatedAt).run();
}

async function d1UpsertDepRun(db: D1Database, r: DepreciationRun) {
  await db.prepare(
    "INSERT OR REPLACE INTO fin_depreciation_runs (id, asset_id, period_ym, amount_minor, journal_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(r.id, r.assetId, r.periodYm, r.amountMinor, r.journalId || null, r.createdAt).run();
}

async function d1UpsertPeriod(db: D1Database, p: AccountingPeriod) {
  await db.prepare(
    `INSERT OR REPLACE INTO fin_periods (id, period_ym, status, label, closed_at, closed_by, close_reason, reopened_at, reopened_by, reopen_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(p.id, p.periodYm, p.status, p.label || p.periodYm, p.closedAt || null, p.closedBy || null, p.closeReason || null,
    p.reopenedAt || null, p.reopenedBy || null, p.reopenReason || null, p.createdAt, p.updatedAt).run();
}

async function d1UpsertYearClose(db: D1Database, y: YearClose) {
  await db.prepare(
    `INSERT OR REPLACE INTO fin_year_closes (id, fiscal_year, start_date, end_date, status, net_result_minor, drawings_minor, journal_id, reversal_journal_id, closed_at, closed_by, reason, reopened_at, reopen_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(y.id, y.fiscalYear, y.startDate, y.endDate, y.status, y.netResultMinor, y.drawingsMinor, y.journalId || null,
    y.reversalJournalId || null, y.closedAt, y.closedBy, y.reason, y.reopenedAt || null, y.reopenReason || null).run();
}

async function d1NextSeq(db: D1Database, kind: "journal" | "invoice"): Promise<number> {
  const table = kind === "journal" ? "fin_journals" : "fin_invoices";
  const col = kind === "journal" ? "number" : "number";
  const prefix = kind === "journal" ? "JE-" : "INV-";
  const row = await db.prepare(`SELECT ${col} AS n FROM ${table} ORDER BY created_at DESC LIMIT 1`).first<{ n: string }>();
  if (!row?.n) return 1;
  const m = String(row.n).replace(prefix, "");
  const num = parseInt(m, 10);
  return Number.isFinite(num) ? num + 1 : 1;
}

async function hydrateFromD1(db: D1Database) {
  store.accounts = await d1LoadAccounts(db);
  store.journals = await d1ListJournals(db);
  store.invoices = await d1ListInvoices(db);
  store.payments = await d1ListPayments(db);
  store.seededCoa = false;
  {
    // Template accounts added after the database was first seeded must exist in D1 too.
    const have = new Set(store.accounts.map((a) => a.code));
    ensureCoa();
    const added = store.accounts.filter((a) => !have.has(a.code));
    for (const a of added) {
      await db.prepare("INSERT OR IGNORE INTO fin_accounts (id, code, name, type, subtype, currency, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
        .bind(a.id, a.code, a.name, a.type, a.subtype || null, a.currency, new Date().toISOString()).run();
    }
    if (added.length) store.accounts = await d1LoadAccounts(db);
  }
  store.seededCoa = true;
  store.docs = {};
  for (const r of ((await db.prepare("SELECT kind, id, json FROM fin_docs").all()).results || []) as any[]) {
    (store.docs[r.kind] ||= {})[r.id] = JSON.parse(r.json);
  }
  // Periods, policies and year closes must survive across requests (they were previously isolate-memory only).
  store.periods = ((await db.prepare("SELECT * FROM fin_periods").all()).results || []).map((r: any) => ({
    id: r.id, periodYm: r.period_ym, status: r.status, label: r.label || undefined, closedAt: r.closed_at || undefined,
    closedBy: r.closed_by || undefined, closeReason: r.close_reason || undefined, reopenedAt: r.reopened_at || undefined,
    reopenedBy: r.reopened_by || undefined, reopenReason: r.reopen_reason || undefined, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
  store.policies = ((await db.prepare("SELECT * FROM fin_policies ORDER BY effective_from, created_at").all()).results || []).map((r: any) => ({
    id: r.id, key: r.key, value: r.value, effectiveFrom: r.effective_from, reason: r.reason, setBy: r.set_by, createdAt: r.created_at,
  }));
  store.yearCloses = ((await db.prepare("SELECT * FROM fin_year_closes").all()).results || []).map((r: any) => ({
    id: r.id, fiscalYear: r.fiscal_year, startDate: r.start_date, endDate: r.end_date, status: r.status,
    netResultMinor: r.net_result_minor, drawingsMinor: r.drawings_minor, journalId: r.journal_id || undefined,
    reversalJournalId: r.reversal_journal_id || undefined, closedAt: r.closed_at, closedBy: r.closed_by, reason: r.reason,
    reopenedAt: r.reopened_at || undefined, reopenReason: r.reopen_reason || undefined,
  }));
  store.fixedAssets = ((await db.prepare("SELECT * FROM fin_fixed_assets ORDER BY asset_number").all()).results || []).map((r: any) => ({
    id: r.id, assetNumber: r.asset_number, name: r.name, category: r.category, acquisitionDate: r.acquisition_date, inServiceDate: r.in_service_date,
    costMinor: r.cost_minor, residualMinor: r.residual_minor, depreciationRateBps: r.depreciation_rate_bps, method: "straight_line" as const,
    accumulatedMinor: r.accumulated_minor, status: r.status, location: r.location || undefined, custodian: r.custodian || undefined,
    disposalDate: r.disposal_date || undefined, currency: r.currency, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
  store.depreciationRuns = ((await db.prepare("SELECT * FROM fin_depreciation_runs").all()).results || []).map((r: any) => ({
    id: r.id, assetId: r.asset_id, periodYm: r.period_ym, amountMinor: r.amount_minor, journalId: r.journal_id || undefined, createdAt: r.created_at,
  }));
  store.assetSeq = store.fixedAssets.reduce((m, a) => Math.max(m, parseInt(a.assetNumber.replace("FA-", ""), 10) || 0), 0) + 1;
  const jn = await d1NextSeq(db, "journal");
  const inv = await d1NextSeq(db, "invoice");
  store.journalSeq = jn;
  store.invoiceSeq = inv;
}


function invoiceCreatedEvent(inv: Invoice): Record<string, unknown> {
  return {
    eventType: "INVOICE_CREATED",
    sourceModule: "finance",
    entityType: "invoice",
    entityId: inv.id,
    idempotencyKey: `invoice:${inv.id}`,
    effectiveDate: inv.issueDate,
    related: inv.sourceId ? [{ module: inv.sourceModule || "unknown", entityType: "source", entityId: inv.sourceId }] : [],
    payload: {
      title: `Invoice issued ${inv.number}`,
      category: "Finance",
      activityDate: inv.issueDate,
      description: `Invoice ${inv.number} to ${inv.customerName} for ${inv.amountMinor} minor units ${inv.currency}. Source: ${inv.sourceModule || "finance"}`,
      clientName: inv.customerName,
      successStatus: "pending",
      number: inv.number,
      customerName: inv.customerName,
      amountMinor: inv.amountMinor,
      currency: inv.currency,
    },
  };
}

function paymentReceivedEvent(pay: Payment, inv?: Invoice, discountMinor = 0): Record<string, unknown> {
  return {
    eventType: "PAYMENT_RECEIVED",
    sourceModule: "finance",
    entityType: "payment",
    entityId: pay.id,
    idempotencyKey: `payment:${pay.id}`,
    effectiveDate: pay.paymentDate,
    related: inv ? [{ module: "finance", entityType: "invoice", entityId: inv.id }] : [],
    payload: {
      title: `Payment received from ${pay.customerName}`,
      category: "Finance",
      activityDate: pay.paymentDate,
      description: `Payment of ${pay.amountMinor} minor units ${pay.currency} from ${pay.customerName}${inv ? ` against invoice ${inv.number}` : ""}${discountMinor ? ` (settlement discount ${discountMinor})` : ""}.`,
      clientName: pay.customerName,
      successStatus: inv && inv.status === "paid" ? "success" : "partial",
      amountMinor: pay.amountMinor,
      currency: pay.currency,
      invoiceId: inv?.id ?? null,
      invoiceStatus: inv?.status ?? null,
    },
  };
}

/**
 * Publishes a business event to the Nexus sync outbox in the same D1 database. The event row is written directly (no network
 * hop that can be dropped), then processed. A failure is logged and never fails the finance transaction that already committed.
 */
async function publishSync(env: Env, event: Record<string, unknown>): Promise<void> {
  try {
    const db = resolveDb(env as unknown as { NEXUS_DB?: D1Like; FIN_DB?: D1Like });
    if (!db) return;
    await ensureNexusSchema(db);
    const r = await enqueue(db, event);
    if (r.ok && !r.duplicate) await processEvent(db, r.event.id);
  } catch (e) {
    console.error("nexus sync publish failed", e);
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const access = requireDb(env);
  const storageMode = access.mode;
  // Hydrate from D1 when bound so reads/writes share one store view for calculation helpers
  let schemaError: string | null = null;
  if (access.db) {
    try {
      await ensureSchema(access.db);
      await hydrateFromD1(access.db);
    } catch (e: any) {
      schemaError = String(e?.message || e);
      // Soft-fail: still serve dashboard/meta with in-memory COA so UI is not dead
      ensureCoa();
      console.error("FIN_DB hydrate failed, using memory fallback for this request", schemaError);
    }
  } else {
    ensureCoa();
  }

  if (access.error && request.method !== "GET" && request.method !== "OPTIONS" && request.method !== "HEAD") {
    // Allow GET meta/dashboard to report misconfiguration; block mutations
    const url0 = new URL(request.url);
    if (!url0.pathname.endsWith("/meta") && !url0.pathname.endsWith("/dashboard") && url0.pathname.replace(/\/$/, "") !== "/api/finance") {
      return json({ error: access.error, code: "FIN_DB_REQUIRED" }, 503);
    }
  }

  async function persistJournal(j: Journal) {
    if (access.db) {
      await d1InsertJournal(access.db, j);
      await d1Audit(access.db, "journal", j.id, j.status, j.number);
    }
  }
  async function persistInvoice(inv: Invoice, action = "created") {
    if (access.db) {
      await d1InsertInvoice(access.db, inv);
      await d1Audit(access.db, "invoice", inv.id, action, inv.number);
    }
  }
  async function persistPayment(pay: Payment) {
    if (access.db) {
      await d1InsertPayment(access.db, pay);
      await d1Audit(access.db, "payment", pay.id, "created", String(pay.amountMinor));
    }
  }


  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");
  const url = new URL(request.url);

  if (path === "health") {
    const connected = Boolean(env.FIN_DB) && !schemaError;
    return json({
      success: connected || Boolean(env.FIN_ALLOW_MEMORY === "1"),
      service: "CINTEXA Finance",
      api: "operational",
      database: {
        provider: "Cloudflare D1",
        binding: "FIN_DB",
        configured: Boolean(env.FIN_DB),
        connected,
        schema: schemaError ? "error" : (env.FIN_DB ? "ready" : "not-bound"),
        schemaError: schemaError || null,
        mode: storageMode,
      },
      hint: env.FIN_DB
        ? (schemaError ? "Schema bootstrap failed — check FIN_DB permissions" : null)
        : "Bind FIN_DB in Cloudflare Pages → Settings → Functions → D1 bindings",
    }, connected || env.FIN_ALLOW_MEMORY === "1" ? 200 : 503);
  }

  if (path === "" || path === "dashboard") {
    const tb = trialBalance();
    const p = pnl();
    const bs = balanceSheet();
    const ar = accountBalance("1050");
    const cash = accountBalance("1010") + accountBalance("1020") + accountBalance("1030") + accountBalance("1040");
    return json({
      currency: "GHS",
      revenue: p.revenue,
      grossRevenue: p.grossRevenue,
      discountAllowed: p.discountAllowed,
      discountReceived: p.discountReceived,
      expense: p.expense,
      netProfit: p.netProfit,
      assets: bs.assets,
      liabilities: bs.liabilities,
      equity: bs.equity,
      cash,
      accountsReceivable: ar,
      trialBalanceBalanced: tb.balanced,
      journalCount: store.journals.filter((j) => j.status === "posted").length,
      invoiceCount: store.invoices.length,
      openInvoices: store.invoices.filter((i) => i.status !== "paid" && i.status !== "void").length,
      storage: storageMode === "d1" ? "d1" : (env.FIN_ALLOW_MEMORY === "1" ? "isolate-memory-dev" : "isolate-memory"),
      d1Configured: Boolean(env.FIN_DB),
      schemaError: schemaError || null,
      engine: "cintexa-finance-double-entry-v1",
    });
  }

  if (path === "meta") {
    return json({
      name: "CINTEXA Finance",
      version: "1.0.0",
      doubleEntry: true,
      baseCurrency: "GHS",
      storage: storageMode === "d1" ? "d1" : (env.FIN_ALLOW_MEMORY === "1" ? "isolate-memory-dev" : "isolate-memory"),
      d1Configured: Boolean(env.FIN_DB),
      warning: context.env.FIN_DB ? null : "Bind FIN_DB (D1) for persistence across isolates",
    });
  }

  if (path === "accounts" && request.method === "GET") {
    return json({ items: store.accounts.filter((a) => a.active), currency: "GHS" });
  }

  if (path === "journals" && request.method === "GET") {
    return json({
      items: store.journals.map((j) => ({
        ...j,
        totals: lineTotals(j.lines),
      })),
    });
  }

  if (path === "journals" && request.method === "POST") {
    const body = await readJson(request);
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines: JournalLine[] = [];
    for (const l of linesIn) {
      const code = String(l.accountCode || "");
      const acc = byCode(code);
      if (!acc) return json({ error: `Unknown account ${code}` }, 400);
      let debit = Math.round(Number(l.debit) || 0);
      let credit = Math.round(Number(l.credit) || 0);
      if (debit < 0 || credit < 0) return json({ error: "Amounts must be non-negative" }, 400);
      if (debit > 0 && credit > 0) return json({ error: "Line cannot have both debit and credit" }, 400);
      let fcCurrency: string | undefined, fcAmount: number | undefined, rateMicro: number | undefined;
      if (l.fcCurrency) {
        // Foreign-currency leg: functional amount = fcAmount × rate (rate scaled ×1,000,000)
        fcCurrency = String(l.fcCurrency).toUpperCase();
        fcAmount = Math.round(Number(l.fcAmount) || 0);
        try { rateMicro = l.rateMicro != null ? Math.round(Number(l.rateMicro)) : toRateMicro(l.rate); } catch (e: any) { return json({ error: e.message }, 400); }
        if (!/^[A-Z]{3}$/.test(fcCurrency) || fcAmount <= 0 || !(rateMicro! > 0)) return json({ error: "fcCurrency, fcAmount > 0 and rate required for a foreign-currency line" }, 400);
        const fn = mulDiv(fcAmount, rateMicro!, RATE_SCALE);
        if (!debit && !credit) { if (String(l.side) === "credit") credit = fn; else debit = fn; }
        else if (Math.abs((debit || credit) - fn) > 1) return json({ error: `Functional amount ${debit || credit} does not equal fcAmount × rate (${fn})` }, 400);
      }
      lines.push({
        id: crypto.randomUUID(),
        accountId: acc.id,
        accountCode: acc.code,
        memo: l.memo ? String(l.memo).slice(0, 300) : undefined,
        debit,
        credit,
        fcCurrency, fcAmount, rateMicro,
      });
    }
    const t = lineTotals(lines);
    if (!t.balanced) {
      return json({ error: "Journal must balance", ...t }, 400);
    }
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: String(body.journalType || "general"),
      entryDate: String(body.entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      description: String(body.description || "").slice(0, 500),
      sourceModule: body.sourceModule ? String(body.sourceModule) : undefined,
      sourceId: body.sourceId ? String(body.sourceId) : undefined,
      currency: String(body.currency || "GHS"),
      status: "draft",
      lines,
      createdAt: new Date().toISOString(),
    };
    if (body.post === true) {
      try {
        postJournal(j);
      } catch (e: any) {
        return json({ error: e.message }, 400);
      }
    }
    store.journals.push(j);
    audit("journal", j.id, j.status === "posted" ? "created_posted" : "created_draft", j.number);
    await persistJournal(j);
    return json({ journal: { ...j, totals: t }, storage: storageMode }, 201);
  }

  if (path.startsWith("journals/") && path.endsWith("/post") && request.method === "POST") {
    const id = path.split("/")[1];
    const j = store.journals.find((x) => x.id === id);
    if (!j) return json({ error: "Not found" }, 404);
    if (j.status === "posted") return json({ error: "Already posted" }, 400);
    try {
      postJournal(j);
    } catch (e: any) {
      return json({ error: e.message }, 400);
    }
    await persistJournal(j);
    return json({ journal: j });
  }

  if (path.startsWith("journals/") && path.endsWith("/reverse") && request.method === "POST") {
    const id = path.split("/")[1];
    const j = store.journals.find((x) => x.id === id);
    if (!j) return json({ error: "Not found" }, 404);
    if (j.status !== "posted") return json({ error: "Only posted journals can be reversed" }, 400);
    if (isClosingJournal(j)) return json({ error: "Year-end closing journals are reversed only through POST year-end/reopen", code: "USE_YEAR_END_REOPEN" }, 409);
    const rev: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "reversal",
      entryDate: new Date().toISOString().slice(0, 10),
      description: `Reversal of ${j.number}`,
      sourceModule: "finance",
      sourceId: j.id,
      currency: j.currency,
      status: "draft",
      lines: j.lines.map((l) => ({
        id: crypto.randomUUID(),
        accountId: l.accountId,
        accountCode: l.accountCode,
        memo: `Reversal: ${l.memo || ""}`,
        debit: l.credit,
        credit: l.debit,
      })),
      createdAt: new Date().toISOString(),
    };
    postJournal(rev);
    store.journals.push(rev);
    j.reversedBy = rev.id;
    audit("journal", j.id, "reversed", rev.number);
    await persistJournal(rev);
    await persistJournal(j);
    return json({ original: j, reversal: rev });
  }

  if (path === "trial-balance") {
    return json(trialBalance(url.searchParams.get("asOf") || undefined, url.searchParams.get("preClosing") === "1"));
  }
  if (path === "pnl") {
    return json(pnl(url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined));
  }
  if (path === "balance-sheet") {
    return json(balanceSheet(url.searchParams.get("asOf") || undefined));
  }
  if (path === "cash-flow") {
    return json(cashFlow(url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined));
  }
  if (path === "ar-aging") {
    return json(arAging(url.searchParams.get("asOf") || undefined));
  }
  if (path === "depreciation-schedule") {
    return json(depreciationSchedule());
  }
  if (path === "equity-statement") {
    return json(equityStatement(url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined));
  }

  // Recognize portion of prepaid expense → expense (accrual)
  if (path === "adjustments/prepaid" && request.method === "POST") {
    const body = await readJson(request);
    const amount = Math.round(Number(body.amountMinor) || 0);
    if (amount <= 0) return json({ error: "amountMinor must be positive" }, 400);
    ensureCoa();
    const expCode = String(body.expenseAccountCode || "6400");
    const prepaid = byCode("1080")!;
    const exp = byCode(expCode) || byCode("6400")!;
    const entryDate = String(body.entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "adjustment",
      entryDate,
      description: String(body.description || "Prepaid expense recognition").slice(0, 500),
      sourceModule: "finance",
      currency: String(body.currency || "GHS"),
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: exp.id, accountCode: exp.code, memo: "Prepaid recognition", debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: prepaid.id, accountCode: prepaid.code, memo: "Prepaid release", debit: 0, credit: amount },
      ],
      createdAt: new Date().toISOString(),
    };
    try { postJournal(j); } catch (e: any) { return json({ error: e.message }, 400); }
    store.journals.push(j);
    await persistJournal(j);
    audit("journal", j.id, "prepaid_recognition", j.number);
    return json({ journal: j }, 201);
  }

  // Recognize deferred revenue → revenue (when earned)
  if (path === "adjustments/deferred-revenue" && request.method === "POST") {
    const body = await readJson(request);
    const amount = Math.round(Number(body.amountMinor) || 0);
    if (amount <= 0) return json({ error: "amountMinor must be positive" }, 400);
    ensureCoa();
    const revCode = String(body.revenueAccountCode || "4070");
    const deferred = byCode("2110") || byCode("2120")!;
    const rev = byCode(revCode) || byCode("4070")!;
    const entryDate = String(body.entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "adjustment",
      entryDate,
      description: String(body.description || "Deferred revenue recognition").slice(0, 500),
      sourceModule: "finance",
      currency: String(body.currency || "GHS"),
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: deferred.id, accountCode: deferred.code, memo: "Deferred release", debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: rev.id, accountCode: rev.code, memo: "Revenue earned", debit: 0, credit: amount },
      ],
      createdAt: new Date().toISOString(),
    };
    try { postJournal(j); } catch (e: any) { return json({ error: e.message }, 400); }
    store.journals.push(j);
    await persistJournal(j);
    audit("journal", j.id, "deferred_revenue_recognition", j.number);
    return json({ journal: j }, 201);
  }

  // Accrue expense (Dr Expense / Cr Accrued Expenses)
  if (path === "adjustments/accrue-expense" && request.method === "POST") {
    const body = await readJson(request);
    const amount = Math.round(Number(body.amountMinor) || 0);
    if (amount <= 0) return json({ error: "amountMinor must be positive" }, 400);
    ensureCoa();
    const expCode = String(body.expenseAccountCode || "6400");
    const exp = byCode(expCode) || byCode("6400")!;
    const accrued = byCode("2030")!;
    const entryDate = String(body.entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "adjustment",
      entryDate,
      description: String(body.description || "Accrued expense").slice(0, 500),
      sourceModule: "finance",
      currency: String(body.currency || "GHS"),
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: exp.id, accountCode: exp.code, memo: "Accrual", debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: accrued.id, accountCode: accrued.code, memo: "Accrued liability", debit: 0, credit: amount },
      ],
      createdAt: new Date().toISOString(),
    };
    try { postJournal(j); } catch (e: any) { return json({ error: e.message }, 400); }
    store.journals.push(j);
    await persistJournal(j);
    audit("journal", j.id, "accrue_expense", j.number);
    return json({ journal: j }, 201);
  }

  // Invoice from sales (or manual) — creates AR + revenue journal
  if (path === "invoices" && request.method === "GET") {
    return json({
      items: store.invoices.map((i) => ({
        ...i,
        balanceMinor: i.amountMinor - i.amountPaidMinor,
      })),
    });
  }

  if (path === "invoices" && request.method === "POST") {
    const body = await readJson(request);
    const amount = Math.round(Number(body.amountMinor));
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amountMinor must be positive integer" }, 400);
    const customerName = String(body.customerName || "Customer").slice(0, 200);
    const issueDate = String(body.issueDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const revenueCode = String(body.revenueAccountCode || "4090");
    const rev = byCode(revenueCode) || byCode("4090")!;
    const ar = byCode("1050")!;
    const inv: Invoice = {
      id: crypto.randomUUID(),
      number: `INV-${String(store.invoiceSeq++).padStart(5, "0")}`,
      customerName,
      issueDate,
      dueDate: body.dueDate ? String(body.dueDate).slice(0, 10) : undefined,
      currency: String(body.currency || "GHS"),
      amountMinor: amount,
      amountPaidMinor: 0,
      status: "open",
      sourceModule: body.sourceModule ? String(body.sourceModule) : "finance",
      sourceId: body.sourceId ? String(body.sourceId) : undefined,
      createdAt: new Date().toISOString(),
    };
    // Idempotency by source
    if (inv.sourceId && store.invoices.some((x) => x.sourceModule === inv.sourceModule && x.sourceId === inv.sourceId)) {
      const existing = store.invoices.find((x) => x.sourceModule === inv.sourceModule && x.sourceId === inv.sourceId)!;
      return json({ invoice: existing, duplicate: true });
    }
    const invDesc = body.description
      ? String(body.description).slice(0, 500)
      : `Invoice ${inv.number} — ${customerName}: recognition of revenue and accounts receivable.`;
    const arMemo = body.arMemo ? String(body.arMemo).slice(0, 300) : inv.number;
    const revMemo = body.revenueMemo ? String(body.revenueMemo).slice(0, 300) : inv.number;
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "sales",
      entryDate: issueDate,
      description: invDesc,
      sourceModule: inv.sourceModule,
      sourceId: inv.id,
      currency: inv.currency,
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, memo: arMemo, debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: rev.id, accountCode: rev.code, memo: revMemo, debit: 0, credit: amount },
      ],
      createdAt: new Date().toISOString(),
    };
    postJournal(j);
    store.journals.push(j);
    inv.journalId = j.id;
    store.invoices.push(inv);
    audit("invoice", inv.id, "created_posted", inv.number);
    // journal first, then invoice (upserts are idempotent)
    if (inv.journalId) { const jj = store.journals.find((x) => x.id === inv.journalId); if (jj) await persistJournal(jj); }
    await persistInvoice(inv);

    await publishSync(env, invoiceCreatedEvent(inv));

    return json({ invoice: inv, journal: j }, 201);
  }

  if (path === "payments" && request.method === "GET") {
    return json({ items: store.payments });
  }

  if (path === "payments" && request.method === "POST") {
    const body = await readJson(request);
    const amount = Math.round(Number(body.amountMinor));
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amountMinor must be positive" }, 400);
    const invoiceId = body.invoiceId ? String(body.invoiceId) : undefined;
    let inv = invoiceId ? store.invoices.find((i) => i.id === invoiceId) : undefined;
    if (invoiceId && !inv) return json({ error: "Invoice not found" }, 404);
    if (inv) {
      const remaining = inv.amountMinor - inv.amountPaidMinor;
      if (amount > remaining) return json({ error: "Payment exceeds invoice balance", remaining }, 400);
    }
    if (body.sourceId && store.payments.some((p) => p.sourceModule === body.sourceModule && p.sourceId === body.sourceId)) {
      const existing = store.payments.find((p) => p.sourceModule === body.sourceModule && p.sourceId === body.sourceId)!;
      return json({ payment: existing, duplicate: true });
    }
    const bank = byCode(String(body.bankAccountCode || "1010")) || byCode("1010")!;
    const ar = byCode("1050")!;
    const paymentDate = String(body.paymentDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const customerName = String(body.customerName || inv?.customerName || "Customer");
    const pay: Payment = {
      id: crypto.randomUUID(),
      invoiceId: inv?.id,
      customerName,
      paymentDate,
      amountMinor: amount,
      currency: String(body.currency || inv?.currency || "GHS"),
      method: body.method ? String(body.method) : undefined,
      sourceModule: body.sourceModule ? String(body.sourceModule) : "finance",
      sourceId: body.sourceId ? String(body.sourceId) : undefined,
      createdAt: new Date().toISOString(),
    };
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "cash_receipt",
      entryDate: paymentDate,
      description: body.description
        ? String(body.description).slice(0, 500)
        : `Payment from ${customerName}${inv ? ` for ${inv.number}` : ""}: cash increases, receivable decreases.`,
      sourceModule: pay.sourceModule,
      sourceId: pay.id,
      currency: pay.currency,
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: bank.id, accountCode: bank.code, memo: body.bankMemo ? String(body.bankMemo).slice(0, 300) : "Receipt", debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, memo: body.arMemo ? String(body.arMemo).slice(0, 300) : (inv?.number || "AR"), debit: 0, credit: amount },
      ],
      createdAt: new Date().toISOString(),
    };
    postJournal(j);
    store.journals.push(j);
    pay.journalId = j.id;
    store.payments.push(pay);
    await persistPayment(pay);
    if (pay.journalId) { const jj = store.journals.find((x) => x.id === pay.journalId); if (jj) await persistJournal(jj); }
    if (inv) {
      inv.amountPaidMinor += amount;
      inv.status = inv.amountPaidMinor >= inv.amountMinor ? "paid" : "partial";
      if (access.db) await d1ApplyInvoicePaid(access.db, inv);
    }
    audit("payment", pay.id, "created_posted", String(amount));
    await publishSync(env, paymentReceivedEvent(pay, inv));
    return json({ payment: pay, journal: j, invoice: inv }, 201);
  }

  // Sales bridge: create invoice from sales order payload
  if (path === "from-sales/invoice" && request.method === "POST") {
    const body = await readJson(request);
    return json(
      await (async () => {
        // reuse invoice logic via internal call pattern
        const amount = Math.round(Number(body.amountMinor ?? body.totalMinor ?? 0));
        if (amount <= 0) return { error: "amount required" };
        // Call same path logic inline
        const customerName = String(body.customerName || body.accountName || "Customer");
        const sourceId = String(body.orderId || body.sourceId || crypto.randomUUID());
        const existing = store.invoices.find((x) => x.sourceModule === "sales" && x.sourceId === sourceId);
        if (existing) return { invoice: existing, duplicate: true };
        // Delegate by constructing request body fields - inline
        const issueDate = String(body.issueDate || new Date().toISOString().slice(0, 10));
        const revenueCode = String(body.revenueAccountCode || "4000");
        const rev = byCode(revenueCode) || byCode("4090")!;
        const ar = byCode("1050")!;
        const inv: Invoice = {
          id: crypto.randomUUID(),
          number: `INV-${String(store.invoiceSeq++).padStart(5, "0")}`,
          customerName,
          issueDate,
          currency: String(body.currency || "GHS"),
          amountMinor: amount,
          amountPaidMinor: 0,
          status: "open",
          sourceModule: "sales",
          sourceId,
          createdAt: new Date().toISOString(),
        };
        const j: Journal = {
          id: crypto.randomUUID(),
          number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
          journalType: "sales",
          entryDate: issueDate,
          description: `Sales invoice ${inv.number}`,
          sourceModule: "sales",
          sourceId: inv.id,
          currency: inv.currency,
          status: "draft",
          lines: [
            { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, debit: amount, credit: 0 },
            { id: crypto.randomUUID(), accountId: rev.id, accountCode: rev.code, debit: 0, credit: amount },
          ],
          createdAt: new Date().toISOString(),
        };
        postJournal(j);
        store.journals.push(j);
        inv.journalId = j.id;
        store.invoices.push(inv);
        audit("invoice", inv.id, "from_sales", inv.number);
        await persistJournal(j);
        await persistInvoice(inv);
        await publishSync(env, invoiceCreatedEvent(inv));
        return { invoice: inv, journal: j };
      })(),
    );
  }

  if (path === "audit" && request.method === "GET") {
    return json({ items: store.audit.slice().reverse().slice(0, 100) });
  }

  if (path === "ledger" && request.method === "GET") {
    const code = url.searchParams.get("account");
    if (!code) return json({ error: "account query required" }, 400);
    const lines: any[] = [];
    for (const j of store.journals) {
      if (j.status !== "posted") continue;
      for (const l of j.lines) {
        if (l.accountCode !== code) continue;
        lines.push({
          journalNumber: j.number,
          date: j.entryDate,
          description: j.description,
          debit: l.debit,
          credit: l.credit,
          journalId: j.id,
          sourceModule: j.sourceModule,
          sourceId: j.sourceId,
        });
      }
    }
    return json({ account: code, balance: accountBalance(code), lines, currency: "GHS" });
  }


  if (path === "accounts/search" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const type = url.searchParams.get("type") || "";
    const includeInactive = url.searchParams.get("inactive") === "1";
    let items = store.accounts.filter((a) => includeInactive || a.active);
    if (type) items = items.filter((a) => a.type === type);
    if (q) {
      items = items.filter((a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.subtype || "").toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)
      );
    }
    items = items.slice(0, 50).map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      currency: a.currency,
      active: a.active,
      normalBalance: a.type === "asset" || a.type === "expense" ? "debit" : "credit",
      label: `${a.code} — ${a.name} — ${a.type}`,
    }));
    return json({ items, q });
  }

  if (path === "accounts" && request.method === "POST") {
    const body = await readJson(request);
    const code = String(body.code || "").trim();
    const name = String(body.name || "").trim();
    const type = String(body.type || "").trim() as AccountType;
    if (!code || !name || !["asset","liability","equity","revenue","expense"].includes(type)) {
      return json({ error: "code, name, type required" }, 400);
    }
    if (store.accounts.some((a) => a.code === code)) return json({ error: "Duplicate account code" }, 409);
    const acc: Account = {
      id: crypto.randomUUID(),
      code,
      name,
      type,
      subtype: body.subtype ? String(body.subtype) : undefined,
      currency: String(body.currency || "GHS"),
      active: true,
    };
    store.accounts.push(acc);
    audit("account", acc.id, "created", code);
    return json({ account: acc }, 201);
  }

  if (path.startsWith("accounts/") && path.endsWith("/deactivate") && request.method === "POST") {
    const id = path.split("/")[1];
    const acc = store.accounts.find((a) => a.id === id || a.code === id);
    if (!acc) return json({ error: "Not found" }, 404);
    acc.active = false;
    audit("account", acc.id, "deactivated", acc.code);
    return json({ account: acc });
  }


  // Invoice with Discount Allowed at issuance: Dr AR (net) + Dr Discount Allowed / Cr Revenue (gross)
  if (path === "invoices/with-discount" && request.method === "POST") {
    const body = await readJson(request);
    const gross = Math.round(Number(body.grossMinor ?? body.amountMinor));
    const discount = Math.round(Number(body.discountMinor) || 0);
    if (!Number.isFinite(gross) || gross <= 0) return json({ error: "grossMinor required" }, 400);
    if (discount < 0 || discount >= gross) return json({ error: "discount must be >= 0 and < gross" }, 400);
    const net = gross - discount;
    const customerName = String(body.customerName || "Customer").slice(0, 200);
    const issueDate = String(body.issueDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const revenueCode = String(body.revenueAccountCode || "4230");
    const discountCode = String(body.discountAccountCode || "4320");
    const rev = byCode(revenueCode) || byCode("4190")!;
    const disc = byCode(discountCode) || byCode("4320")!;
    const ar = byCode("1050")!;
    const inv: Invoice = {
      id: crypto.randomUUID(),
      number: `INV-${String(store.invoiceSeq++).padStart(5, "0")}`,
      customerName,
      issueDate,
      currency: String(body.currency || "GHS"),
      amountMinor: net,
      amountPaidMinor: 0,
      status: "open",
      sourceModule: body.sourceModule ? String(body.sourceModule) : "finance",
      sourceId: body.sourceId ? String(body.sourceId) : undefined,
      createdAt: new Date().toISOString(),
    };
    if (inv.sourceId && store.invoices.some((x) => x.sourceModule === inv.sourceModule && x.sourceId === inv.sourceId)) {
      return json({ invoice: store.invoices.find((x) => x.sourceModule === inv.sourceModule && x.sourceId === inv.sourceId), duplicate: true });
    }
    const lines: JournalLine[] = [
      { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, memo: inv.number, debit: net, credit: 0 },
      { id: crypto.randomUUID(), accountId: rev.id, accountCode: rev.code, memo: inv.number, debit: 0, credit: gross },
    ];
    if (discount > 0) {
      lines.splice(1, 0, {
        id: crypto.randomUUID(),
        accountId: disc.id,
        accountCode: disc.code,
        memo: `Discount on ${inv.number}`,
        debit: discount,
        credit: 0,
      });
    }
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "sales",
      entryDate: issueDate,
      description: `Invoice ${inv.number} gross ${gross} discount ${discount} net ${net}`,
      sourceModule: inv.sourceModule,
      sourceId: inv.id,
      currency: inv.currency,
      status: "draft",
      lines,
      createdAt: new Date().toISOString(),
    };
    postJournal(j);
    store.journals.push(j);
    inv.journalId = j.id;
    store.invoices.push(inv);
    audit("invoice", inv.id, "created_with_discount", `${inv.number} disc=${discount}`);
    await persistJournal(j);
    await persistInvoice(inv);
    await publishSync(env, invoiceCreatedEvent(inv));
    return json({ invoice: inv, journal: j, gross, discount, net }, 201);
  }

  // Settlement discount on payment: Dr Bank + Dr Discount Allowed / Cr AR (full)
  if (path === "payments/with-discount" && request.method === "POST") {
    const body = await readJson(request);
    const invoiceId = String(body.invoiceId || "");
    const inv = store.invoices.find((i) => i.id === invoiceId);
    if (!inv) return json({ error: "Invoice not found" }, 404);
    const remaining = inv.amountMinor - inv.amountPaidMinor;
    const discount = Math.round(Number(body.discountMinor) || 0);
    const payAmount = Math.round(Number(body.amountMinor));
    if (!Number.isFinite(payAmount) || payAmount <= 0) return json({ error: "amountMinor required" }, 400);
    if (discount < 0) return json({ error: "discount invalid" }, 400);
    if (payAmount + discount !== remaining && payAmount + discount > remaining) {
      return json({ error: "payment + discount exceeds balance", remaining }, 400);
    }
    // settle remaining: payment + discount should equal remaining for full settlement
    const settle = payAmount + discount;
    if (settle > remaining) return json({ error: "over-allocation", remaining }, 400);
    const bank = byCode(String(body.bankAccountCode || "1030")) || byCode("1010")!;
    const ar = byCode("1050")!;
    const disc = byCode(String(body.discountAccountCode || "4321")) || byCode("4320")!;
    const paymentDate = String(body.paymentDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const lines: JournalLine[] = [
      { id: crypto.randomUUID(), accountId: bank.id, accountCode: bank.code, memo: "Settlement", debit: payAmount, credit: 0 },
      { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, memo: inv.number, debit: 0, credit: settle },
    ];
    if (discount > 0) {
      lines.splice(1, 0, {
        id: crypto.randomUUID(),
        accountId: disc.id,
        accountCode: disc.code,
        memo: `Settlement discount ${inv.number}`,
        debit: discount,
        credit: 0,
      });
    }
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "cash_receipt",
      entryDate: paymentDate,
      description: `Payment ${inv.number} paid ${payAmount} discount ${discount}`,
      sourceModule: "finance",
      sourceId: inv.id,
      currency: inv.currency,
      status: "draft",
      lines,
      createdAt: new Date().toISOString(),
    };
    postJournal(j);
    store.journals.push(j);
    inv.amountPaidMinor += settle;
    inv.status = inv.amountPaidMinor >= inv.amountMinor ? "paid" : "partial";
    const pay: Payment = {
      id: crypto.randomUUID(),
      invoiceId: inv.id,
      customerName: inv.customerName,
      paymentDate,
      amountMinor: payAmount,
      currency: inv.currency,
      method: body.method ? String(body.method) : undefined,
      journalId: j.id,
      createdAt: new Date().toISOString(),
    };
    store.payments.push(pay);
    audit("payment", pay.id, "settlement_discount", `disc=${discount}`);
    await persistJournal(j);
    await persistPayment(pay);
    if (access.db) await d1ApplyInvoicePaid(access.db, inv);
    await publishSync(env, paymentReceivedEvent(pay, inv, discount));
    return json({ payment: pay, journal: j, invoice: inv, discount }, 201);
  }

  // Supplier bill with discount received at recording (net expense)
  if (path === "expenses/with-discount" && request.method === "POST") {
    const body = await readJson(request);
    const gross = Math.round(Number(body.grossMinor));
    const discount = Math.round(Number(body.discountMinor) || 0);
    if (!Number.isFinite(gross) || gross <= 0) return json({ error: "grossMinor required" }, 400);
    if (discount < 0 || discount >= gross) return json({ error: "invalid discount" }, 400);
    const net = gross - discount;
    const expenseCode = String(body.expenseAccountCode || "6410");
    const exp = byCode(expenseCode) || byCode("6400")!;
    const ap = byCode("2010")!;
    const entryDate = String(body.entryDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    // Net method: expense and AP at net (discount reduces cost immediately)
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "purchase",
      entryDate,
      description: String(body.description || `Supplier bill net of discount ${discount}`).slice(0, 500),
      sourceModule: "procurement",
      currency: String(body.currency || "GHS"),
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: exp.id, accountCode: exp.code, debit: net, credit: 0 },
        { id: crypto.randomUUID(), accountId: ap.id, accountCode: ap.code, debit: 0, credit: net },
      ],
      createdAt: new Date().toISOString(),
    };
    postJournal(j);
    store.journals.push(j);
    audit("expense", j.id, "purchase_with_discount", `gross=${gross} disc=${discount} net=${net}`);
    await persistJournal(j);
    await publishSync(env, {
      eventType: "EXPENSE_RECORDED",
      sourceModule: "finance",
      entityType: "expense",
      entityId: j.id,
      idempotencyKey: `expense:${j.id}`,
      effectiveDate: entryDate,
      payload: {
        title: `Expense recorded: ${j.description}`.slice(0, 300),
        category: "Finance",
        activityDate: entryDate,
        description: `${j.description} (net ${net}, discount ${discount}, ${j.currency} minor units).`,
        amountMinor: net,
        currency: j.currency,
      },
    });
    return json({ journal: j, gross, discount, net, method: "net" }, 201);
  }

  /**
   * Controlled one-time scale: multiply amounts by 100.
   * Use ONLY when historical data was entered as major units but stored without
   * conversion (GHS 5,000 stored as 5000 → displayed as 50.00).
   *
   * POST /api/finance/admin/scale-to-minor
   * body: { confirm: "SCALE_JOURNALS_X100", dryRun?: boolean }
   * Default dryRun=true. Pass dryRun:false to apply.
   */
  if (path === "admin/scale-to-minor" && request.method === "POST") {
    const body = await readJson(request);
    const direction = String(body.direction || "up"); // "up" = x100, "down" = rollback (/100)
    if (String(body.confirm || "") !== "SCALE_JOURNALS_X100") {
      return json({
        error: "Confirmation required",
        hint: 'Pass { "confirm": "SCALE_JOURNALS_X100", "dryRun": true } first',
      }, 400);
    }
    if (direction !== "up" && direction !== "down") return json({ error: "direction must be up or down" }, 400);
    const dryRun = body.dryRun !== false;
    const factor = (n: number) => (direction === "up" ? Math.round(n * 100) : Math.round(n / 100));

    // Guard: refuse to scale up twice (would produce a 10,000x error).
    const applied = store.audit.length ? store.audit : [];
    let alreadyApplied = applied.some((a) => a.entityId === "scale-to-minor" && a.action === "applied_up");
    let alreadyRolledBack = applied.some((a) => a.entityId === "scale-to-minor" && a.action === "applied_down");
    if (access.db) {
      const rows = await access.db.prepare(
        "SELECT action FROM fin_audit WHERE entity_id = 'scale-to-minor' ORDER BY created_at DESC LIMIT 1",
      ).all();
      const last = (rows.results?.[0] as any)?.action as string | undefined;
      alreadyApplied = last === "applied_up";
      alreadyRolledBack = last === "applied_down" || !last;
    }
    if (direction === "up" && alreadyApplied) {
      return json({ error: "Already scaled up. Roll back with direction:\"down\" first.", code: "ALREADY_SCALED" }, 409);
    }
    if (direction === "down" && !alreadyApplied) {
      return json({ error: "Nothing to roll back — no applied scale-up is recorded.", code: "NOTHING_TO_ROLL_BACK" }, 409);
    }
    void alreadyRolledBack;

    const sumBefore = store.journals.reduce((s2, j) => s2 + j.lines.reduce((a, l) => a + l.debit, 0), 0);
    const report: { journals: number; lines: number; invoices: number; payments: number; debitTotalBefore: number; debitTotalAfter: number; samples: any[] } = {
      journals: 0, lines: 0, invoices: 0, payments: 0, debitTotalBefore: sumBefore, debitTotalAfter: 0, samples: [],
    };
    // Compute the result first; apply only when not a dry run.
    const plan = store.journals.map((j) => ({
      j,
      lines: j.lines.map((l) => ({ l, debit: factor(l.debit), credit: factor(l.credit) })),
    }));
    for (const { j, lines } of plan) {
      report.journals++;
      for (const x of lines) {
        report.lines++;
        report.debitTotalAfter += x.debit;
        if (report.samples.length < 5) {
          report.samples.push({ journal: j.number, account: x.l.accountCode, before: { debit: x.l.debit, credit: x.l.credit }, after: { debit: x.debit, credit: x.credit } });
        }
      }
      // A scaled journal must still balance exactly.
      const d = lines.reduce((a, x) => a + x.debit, 0);
      const c = lines.reduce((a, x) => a + x.credit, 0);
      if (d !== c) return json({ error: `Scaling would unbalance ${j.number}; nothing changed`, debit: d, credit: c }, 409);
    }
    report.invoices = store.invoices.length;
    report.payments = store.payments.length;

    if (!dryRun) {
      for (const { j, lines } of plan) {
        for (const x of lines) { x.l.debit = x.debit; x.l.credit = x.credit; }
        if (access.db) await persistJournal(j);
      }
      for (const inv of store.invoices) {
        inv.amountMinor = factor(inv.amountMinor);
        inv.amountPaidMinor = factor(inv.amountPaidMinor);
        if (access.db) await persistInvoice(inv);
      }
      for (const pay of store.payments) {
        pay.amountMinor = factor(pay.amountMinor);
        if (access.db) await persistPayment(pay);
      }
      audit("admin", "scale-to-minor", direction === "up" ? "applied_up" : "applied_down", JSON.stringify({ lines: report.lines }));
      if (access.db) await d1Audit(access.db, "admin", "scale-to-minor", direction === "up" ? "applied_up" : "applied_down", JSON.stringify({ lines: report.lines }));
    }
    return json({
      ok: true,
      dryRun,
      direction,
      report,
      note: dryRun
        ? "Dry run only — no data changed. Re-post with dryRun:false to apply."
        : direction === "up"
          ? "Applied ×100 so storage matches true minor units. Roll back with direction:\"down\" if wrong."
          : "Rolled back ÷100.",
    });
  }


  // —— Accounting integrity ——
  if (path === "integrity" && request.method === "GET") {
    return json(integrityReport());
  }

  // —— Fixed assets ——
  if (path === "assets" && request.method === "GET") {
    return json({
      items: store.fixedAssets.map((a) => ({
        ...a,
        monthlyDepreciationMinor: monthlyDepreciationMinor(a),
        annualDepreciationMinor: Math.round(((a.costMinor - a.residualMinor) * a.depreciationRateBps) / 10000),
        netBookValueMinor: assetNbv(a),
        depreciableRemainingMinor: depreciableRemaining(a),
        policyNote: isComputerCategory(a.category)
          ? "Accounting depreciation 25% SL (not Ghana tax capital allowance)"
          : "Configured accounting rate",
      })),
    });
  }

  if (path === "assets" && request.method === "POST") {
    const body = await readJson(request);
    const category = String(body.category || "laptop") as FixedAsset["category"];
    const cost = Math.round(Number(body.costMinor) || 0);
    if (cost <= 0) return json({ error: "costMinor must be positive integer (minor units)" }, 400);
    const residual = Math.max(0, Math.round(Number(body.residualMinor) || 0));
    if (residual >= cost) return json({ error: "residualMinor must be less than costMinor" }, 400);
    const rate = policyRateBps(category, body.depreciationRateBps != null ? Number(body.depreciationRateBps) : undefined);
    const a: FixedAsset = {
      id: crypto.randomUUID(),
      assetNumber: `FA-${String(store.assetSeq++).padStart(5, "0")}`,
      name: String(body.name || "Asset").slice(0, 200),
      category,
      acquisitionDate: String(body.acquisitionDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      inServiceDate: String(body.inServiceDate || body.acquisitionDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      costMinor: cost,
      residualMinor: residual,
      depreciationRateBps: rate,
      method: "straight_line",
      accumulatedMinor: 0,
      status: "active",
      location: body.location ? String(body.location).slice(0, 120) : undefined,
      custodian: body.custodian ? String(body.custodian).slice(0, 120) : undefined,
      currency: String(body.currency || "GHS"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.fixedAssets.push(a);
    audit("asset", a.id, "created", a.assetNumber);
    if (access.db) { await d1UpsertAsset(access.db, a); await d1Audit(access.db, "asset", a.id, "created", a.assetNumber); }
    return json({
      asset: {
        ...a,
        monthlyDepreciationMinor: monthlyDepreciationMinor(a),
        annualDepreciationMinor: Math.round(((a.costMinor - a.residualMinor) * a.depreciationRateBps) / 10000),
        netBookValueMinor: assetNbv(a),
      },
    }, 201);
  }

  // Run monthly depreciation for all active computer assets (idempotent per asset-period)
  if (path === "assets/depreciate" && request.method === "POST") {
    const body = await readJson(request);
    const ym = String(body.periodYm || periodYm()).slice(0, 7);
    ensureCoa();
    const expAcc = byCode("6311") || byCode("6310")!;
    const accumAcc = byCode("1281") || byCode("1280")!;
    const created: any[] = [];
    const skipped: any[] = [];
    for (const a of store.fixedAssets) {
      if (a.status !== "active") {
        skipped.push({ assetNumber: a.assetNumber, reason: "not_active" });
        continue;
      }
      if (store.depreciationRuns.some((r) => r.assetId === a.id && r.periodYm === ym)) {
        skipped.push({ assetNumber: a.assetNumber, reason: "already_posted_period" });
        continue;
      }
      let charge = monthlyDepreciationMinor(a);
      const remaining = depreciableRemaining(a);
      if (remaining <= 0) {
        a.status = "fully_depreciated";
        if (access.db) await d1UpsertAsset(access.db, a);
        skipped.push({ assetNumber: a.assetNumber, reason: "fully_depreciated" });
        continue;
      }
      if (charge > remaining) charge = remaining;
      if (charge <= 0) {
        skipped.push({ assetNumber: a.assetNumber, reason: "zero_charge" });
        continue;
      }
      const j: Journal = {
        id: crypto.randomUUID(),
        number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
        journalType: "depreciation",
        entryDate: `${ym}-28`,
        description: `Depreciation ${ym} — ${a.assetNumber} ${a.name} (${(a.depreciationRateBps / 100).toFixed(0)}% SL accounting)`,
        sourceModule: "fixed_assets",
        sourceId: a.id,
        currency: a.currency,
        status: "draft",
        lines: [
          { id: crypto.randomUUID(), accountId: expAcc.id, accountCode: expAcc.code, memo: a.assetNumber, debit: charge, credit: 0 },
          { id: crypto.randomUUID(), accountId: accumAcc.id, accountCode: accumAcc.code, memo: a.assetNumber, debit: 0, credit: charge },
        ],
        createdAt: new Date().toISOString(),
      };
      postJournal(j);
      store.journals.push(j);
      a.accumulatedMinor += charge;
      if (depreciableRemaining(a) <= 0) a.status = "fully_depreciated";
      a.updatedAt = new Date().toISOString();
      const run: DepreciationRun = {
        id: crypto.randomUUID(),
        assetId: a.id,
        periodYm: ym,
        amountMinor: charge,
        journalId: j.id,
        createdAt: new Date().toISOString(),
      };
      store.depreciationRuns.push(run);
      await persistJournal(j);
      if (access.db) { await d1UpsertAsset(access.db, a); await d1UpsertDepRun(access.db, run); }
      created.push({ assetNumber: a.assetNumber, amountMinor: charge, journalNumber: j.number, periodYm: ym });
      audit("asset", a.id, "depreciated", `${ym}:${charge}`);
    }
    return json({
      periodYm: ym,
      created,
      skipped,
      note: "Computers/laptops use mandatory 25% annual SL accounting depreciation. Not Ghana tax capital allowance.",
    });
  }

  /**
   * DELETE posted or draft journal — removes active accounting effect completely.
   * Body: { confirm: "DELETE_JOURNAL", reason?: string }
   * Unlinks invoices/payments that pointed at this journal (does not delete invoices automatically).
   * Audit row retained for evidence.
   */
  if (path.startsWith("journals/") && path.split("/").length === 2 && request.method === "DELETE") {
    const id = path.split("/")[1];
    const body = await readJson(request);
    if (String(body.confirm || "") !== "DELETE_JOURNAL") {
      return json({ error: "Confirmation required", hint: 'Pass { "confirm": "DELETE_JOURNAL", "reason": "..." }' }, 400);
    }
    const idx = store.journals.findIndex((x) => x.id === id);
    if (idx < 0) return json({ error: "Not found" }, 404);
    const j = store.journals[idx]!;
    if (isClosingJournal(j)) return json({ error: "Year-end closing journals cannot be deleted; use POST year-end/reopen", code: "USE_YEAR_END_REOPEN" }, 409);
    if (isPeriodClosed(j.entryDate) && String(body.force || "") !== "AFTER_REOPEN") {
      return json({
        error: `Period ${periodYmFromDate(j.entryDate)} is closed. Reopen the period before deleting, or pass force:"AFTER_REOPEN" only after reopen authorization.`,
        periodYm: periodYmFromDate(j.entryDate),
      }, 403);
    }
    const impact = {
      number: j.number,
      status: j.status,
      entryDate: j.entryDate,
      description: j.description,
      lines: j.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, memo: l.memo })),
      totals: lineTotals(j.lines),
    };
    // Unlink source references
    for (const inv of store.invoices) {
      if (inv.journalId === j.id) inv.journalId = undefined;
    }
    for (const pay of store.payments) {
      if (pay.journalId === j.id) pay.journalId = undefined;
    }
    for (const run of store.depreciationRuns) {
      if (run.journalId === j.id) run.journalId = undefined;
    }
    // If this was a depreciation journal, roll back accumulated on asset
    if (j.journalType === "depreciation" && j.sourceId) {
      const asset = store.fixedAssets.find((a) => a.id === j.sourceId);
      if (asset) {
        const depLine = j.lines.find((l) => l.debit > 0);
        if (depLine) {
          asset.accumulatedMinor = Math.max(0, asset.accumulatedMinor - depLine.debit);
          if (asset.status === "fully_depreciated" && depreciableRemaining(asset) > 0) asset.status = "active";
          asset.updatedAt = new Date().toISOString();
        }
        store.depreciationRuns = store.depreciationRuns.filter((r) => r.journalId !== j.id);
        if (access.db) {
          await d1UpsertAsset(access.db, asset);
          await access.db.prepare("DELETE FROM fin_depreciation_runs WHERE journal_id = ?").bind(j.id).run();
        }
      }
    }
    store.journals.splice(idx, 1);
    audit("journal", j.id, "deleted", `${j.number}:${String(body.reason || "").slice(0, 200)}`);
    if (access.db) {
      try {
        await access.db.prepare("DELETE FROM fin_journal_lines WHERE journal_id = ?").bind(j.id).run();
        await access.db.prepare("DELETE FROM fin_journals WHERE id = ?").bind(j.id).run();
        await d1Audit(access.db, "journal", j.id, "deleted", j.number);
      } catch (e: any) {
        console.error("journal delete d1", e?.message);
      }
    }
    return json({
      deleted: true,
      impact,
      integrity: integrityReport(),
      note: "Active ledger effect removed. Audit trail retains deletion event. Re-enter a correct journal if needed.",
    });
  }


  // —— Accounting periods (monthly close / reopen) ——
  if (path === "periods" && request.method === "GET") {
    // Ensure current + prior 11 months exist for UI
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      ensurePeriod(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    // Also ensure periods from existing journals
    for (const j of store.journals) {
      if (j.entryDate) ensurePeriod(periodYmFromDate(j.entryDate));
    }
    const items = store.periods.slice().sort((a, b) => b.periodYm.localeCompare(a.periodYm));
    return json({ items, currency: "GHS" });
  }

  if (path === "periods/close" && request.method === "POST") {
    const body = await readJson(request);
    const ym = String(body.periodYm || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return json({ error: "periodYm required as YYYY-MM" }, 400);
    if (String(body.confirm || "") !== "CLOSE_PERIOD") {
      return json({ error: "Confirmation required", hint: 'Pass { "confirm": "CLOSE_PERIOD", "periodYm": "YYYY-MM", "reason": "..." }' }, 400);
    }
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return json({ error: "reason required (min 3 chars)" }, 400);
    const actor = String(body.closedBy || body.actor || "authorized_user").slice(0, 120);
    const p = ensurePeriod(ym);
    if (p.status === "closed") return json({ error: `Period ${ym} is already closed`, period: p }, 400);
    // Soft check: warn if unbalanced journals in period (still allow close — integrity page surfaces issues)
    const periodJournals = store.journals.filter((j) => j.status === "posted" && periodYmFromDate(j.entryDate) === ym);
    p.status = "closed";
    p.closedAt = new Date().toISOString();
    p.closedBy = actor;
    p.closeReason = reason.slice(0, 500);
    p.updatedAt = new Date().toISOString();
    audit("period", p.id, "closed", `${ym}:${reason.slice(0, 120)}`);
    if (access.db) {
      try {
        await access.db.prepare(
          `INSERT OR REPLACE INTO fin_periods (id, period_ym, status, label, closed_at, closed_by, close_reason, reopened_at, reopened_by, reopen_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(p.id, p.periodYm, p.status, p.label || p.periodYm, p.closedAt, p.closedBy, p.closeReason, p.reopenedAt || null, p.reopenedBy || null, p.reopenReason || null, p.createdAt, p.updatedAt).run();
        await d1Audit(access.db, "period", p.id, "closed", ym);
      } catch (e: any) {
        console.error("period close d1", e?.message);
      }
    }
    return json({
      period: p,
      postedJournalsInPeriod: periodJournals.length,
      note: "Period closed. New posts and journal deletes for this month are blocked until reopen.",
    });
  }

  if (path === "periods/reopen" && request.method === "POST") {
    const body = await readJson(request);
    const ym = String(body.periodYm || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return json({ error: "periodYm required as YYYY-MM" }, 400);
    if (String(body.confirm || "") !== "REOPEN_PERIOD") {
      return json({ error: "Confirmation required", hint: 'Pass { "confirm": "REOPEN_PERIOD", "periodYm": "YYYY-MM", "reason": "..." }' }, 400);
    }
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return json({ error: "reason required (min 3 chars) — elevated authorization expected" }, 400);
    const actor = String(body.reopenedBy || body.actor || "authorized_user").slice(0, 120);
    const p = ensurePeriod(ym);
    if (p.status === "open") return json({ error: `Period ${ym} is already open`, period: p }, 400);
    p.status = "open";
    p.reopenedAt = new Date().toISOString();
    p.reopenedBy = actor;
    p.reopenReason = reason.slice(0, 500);
    p.updatedAt = new Date().toISOString();
    audit("period", p.id, "reopened", `${ym}:${reason.slice(0, 120)}`);
    if (access.db) {
      try {
        await access.db.prepare(
          `INSERT OR REPLACE INTO fin_periods (id, period_ym, status, label, closed_at, closed_by, close_reason, reopened_at, reopened_by, reopen_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(p.id, p.periodYm, p.status, p.label || p.periodYm, p.closedAt || null, p.closedBy || null, p.closeReason || null, p.reopenedAt, p.reopenedBy, p.reopenReason, p.createdAt, p.updatedAt).run();
        await d1Audit(access.db, "period", p.id, "reopened", ym);
      } catch (e: any) {
        console.error("period reopen d1", e?.message);
      }
    }
    return json({
      period: p,
      note: "Period reopened. Posting and authorized deletions for this month are allowed again. Prefer adjusting entries when restating issued statements.",
    });
  }

  // —— Accounting Policy & Rules Engine ——
  if (path === "policies" && request.method === "GET") {
    const asOf = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
    const inForce = Object.fromEntries(Object.keys(POLICY_DEFAULTS).map((k) => [k, { value: policyAt(k, asOf), doc: POLICY_DEFAULTS[k]!.doc }]));
    return json({ asOf, inForce, history: store.policies.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)), keys: Object.keys(POLICY_DEFAULTS) });
  }
  if (path === "policies" && request.method === "POST") {
    const body = await readJson(request);
    const key = String(body.key || "");
    const value = String(body.value ?? "");
    const err = validatePolicy(key, value);
    if (err) return json({ error: err }, 400);
    const effectiveFrom = String(body.effectiveFrom || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return json({ error: "effectiveFrom required as YYYY-MM-DD" }, 400);
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return json({ error: "reason required (min 3 chars) — policy changes must be documented" }, 400);
    // A policy cannot silently rewrite closed history: it may not take effect inside a closed period or closed fiscal year.
    if (isPeriodClosed(effectiveFrom) || store.yearCloses.some((y) => y.status === "closed" && effectiveFrom >= y.startDate && effectiveFrom <= y.endDate)) {
      return json({ error: "effectiveFrom falls in a closed period/year. Use a formal restatement for retrospective changes." }, 409);
    }
    const pol: Policy = { id: crypto.randomUUID(), key, value, effectiveFrom, reason: reason.slice(0, 500), setBy: String(body.setBy || "system").slice(0, 120), createdAt: new Date().toISOString() };
    store.policies.push(pol);
    audit("policy", pol.id, "set", `${key}=${value}@${effectiveFrom}`);
    if (access.db) {
      await access.db.prepare("INSERT INTO fin_policies (id, key, value, effective_from, reason, set_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(pol.id, pol.key, pol.value, pol.effectiveFrom, pol.reason, pol.setBy, pol.createdAt).run();
      await d1Audit(access.db, "policy", pol.id, "set", `${key}=${value}`);
    }
    return json({ policy: pol }, 201);
  }

  // —— Year-end closing → retained earnings ——
  if (path === "year-end/status" && request.method === "GET") {
    return json({ items: store.yearCloses.slice().sort((a, b) => b.fiscalYear - a.fiscalYear) });
  }
  if (path === "year-end/preview" && request.method === "GET") {
    const fy = Number(url.searchParams.get("year"));
    if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) return json({ error: "year required (e.g. ?year=2026)" }, 400);
    const r = yearEndChecks(fy);
    return json({ fiscalYear: fy, ...r, currency: "GHS", note: "Preview only — nothing posted." });
  }
  if (path === "year-end/close" && request.method === "POST") {
    const body = await readJson(request);
    const fy = Number(body.year);
    if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) return json({ error: "year required" }, 400);
    if (String(body.confirm || "") !== "CLOSE_YEAR") return json({ error: "Confirmation required", hint: 'Pass { "year": 2026, "confirm": "CLOSE_YEAR", "reason": "..." } (preview first with GET year-end/preview)' }, 400);
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return json({ error: "reason required (min 3 chars)" }, 400);
    const checks = yearEndChecks(fy);
    if (!checks.canClose) return json({ error: "Year-end validation failed; nothing posted", blockers: checks.blockers, warnings: checks.warnings }, 409);
    const c = checks.closing;
    const now = new Date().toISOString();
    let journal: Journal | undefined;
    if (c.lines.length) {
      journal = {
        id: crypto.randomUUID(),
        number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
        journalType: "closing",
        entryDate: c.endDate,
        description: `Year-end closing FY${fy}: net ${c.netResultMinor >= 0 ? "profit" : "loss"} ${Math.abs(c.netResultMinor)} to ${c.reCode}`,
        sourceModule: "year_end",
        sourceId: String(fy),
        currency: policyAt("functionalCurrency", c.endDate),
        status: "draft",
        lines: c.lines.map((l) => ({ id: crypto.randomUUID(), accountId: byCode(l.accountCode)!.id, accountCode: l.accountCode, memo: l.memo, debit: l.debit, credit: l.credit })),
        createdAt: now,
      };
      try { postJournal(journal, { bypassPeriodLock: true }); } catch (e: any) { store.journalSeq--; return json({ error: e.message }, 409); }
      store.journals.push(journal);
      audit("journal", journal.id, "created_posted", journal.number);
      await persistJournal(journal);
    }
    // Lock every month of the fiscal year
    for (const ym of monthsBetween(c.startDate, c.endDate)) {
      const per = ensurePeriod(ym);
      per.status = "closed"; per.closedAt = now; per.closedBy = "year_end"; per.closeReason = `FY${fy} year-end close`; per.updatedAt = now;
      if (access.db) await d1UpsertPeriod(access.db, per);
    }
    let yc = store.yearCloses.find((y) => y.fiscalYear === fy);
    if (!yc) { yc = { id: crypto.randomUUID(), fiscalYear: fy, startDate: c.startDate, endDate: c.endDate, status: "closed", netResultMinor: 0, drawingsMinor: 0, closedAt: now, closedBy: "", reason: "" }; store.yearCloses.push(yc); }
    Object.assign(yc, { status: "closed", netResultMinor: c.netResultMinor, drawingsMinor: c.drawingsMinor, journalId: journal?.id, reversalJournalId: undefined,
      closedAt: now, closedBy: String(body.closedBy || "system").slice(0, 120), reason: reason.slice(0, 500), reopenedAt: undefined, reopenReason: undefined });
    audit("year_end", yc.id, "closed", `FY${fy} net=${c.netResultMinor}`);
    if (access.db) { await d1UpsertYearClose(access.db, yc); await d1Audit(access.db, "year_end", yc.id, "closed", `FY${fy}`); }
    const openingTb = trialBalance(undefined);
    return json({
      yearClose: yc, journal, warnings: checks.warnings,
      postClosing: { balanced: openingTb.balanced, retainedEarnings: accountBalance(c.reCode), temporaryAccountsZero: store.accounts.filter((a) => (a.type === "revenue" || a.type === "expense") && accountBalance(a.code, c.endDate) !== 0).length === 0 },
    }, 201);
  }
  if (path === "year-end/reopen" && request.method === "POST") {
    const body = await readJson(request);
    const fy = Number(body.year);
    if (String(body.confirm || "") !== "REOPEN_YEAR") return json({ error: "Confirmation required", hint: 'Pass { "year": 2026, "confirm": "REOPEN_YEAR", "reason": "..." }' }, 400);
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return json({ error: "reason required (min 3 chars)" }, 400);
    const yc = store.yearCloses.find((y) => y.fiscalYear === fy);
    if (!yc || yc.status !== "closed") return json({ error: `FY${fy} is not closed` }, 409);
    const later = store.yearCloses.find((y) => y.fiscalYear > fy && y.status === "closed");
    if (later) return json({ error: `FY${later.fiscalYear} is closed after it; reopen the later year first` }, 409);
    const now = new Date().toISOString();
    const orig = store.journals.find((j) => j.id === yc.journalId);
    if (orig) {
      const rev: Journal = {
        id: crypto.randomUUID(), number: `JE-${String(store.journalSeq++).padStart(5, "0")}`, journalType: "closing", entryDate: orig.entryDate,
        description: `Reversal of year-end closing FY${fy}: ${reason.slice(0, 200)}`, sourceModule: "year_end", sourceId: `${fy}:reversal`, currency: orig.currency,
        status: "draft", createdAt: now,
        lines: orig.lines.map((l) => ({ ...l, id: crypto.randomUUID(), debit: l.credit, credit: l.debit })),
      };
      postJournal(rev, { bypassPeriodLock: true });
      orig.reversedBy = rev.id; // original stays posted; the posted reversal nets it to zero (same convention as journals/:id/reverse)
      store.journals.push(rev);
      yc.reversalJournalId = rev.id;
      await persistJournal(rev); await persistJournal(orig);
    }
    for (const ym of monthsBetween(yc.startDate, yc.endDate)) {
      const per = findPeriod(ym);
      if (per && per.status === "closed") { per.status = "open"; per.reopenedAt = now; per.reopenedBy = "year_end_reopen"; per.reopenReason = `FY${fy} reopened: ${reason.slice(0, 200)}`; per.updatedAt = now; if (access.db) await d1UpsertPeriod(access.db, per); }
    }
    yc.status = "reopened"; yc.reopenedAt = now; yc.reopenReason = reason.slice(0, 500);
    audit("year_end", yc.id, "reopened", `FY${fy}:${reason.slice(0, 120)}`);
    if (access.db) { await d1UpsertYearClose(access.db, yc); await d1Audit(access.db, "year_end", yc.id, "reopened", `FY${fy}`); }
    return json({ yearClose: yc, note: "Closing journal reversed and periods reopened. Correct the books, then close the year again." });
  }

  // ═════════ Accounting engine endpoints: FX · Inventory · Payroll · Restatements ═════════
  async function putDoc(kind: string, id: string, obj: any) {
    (store.docs[kind] ||= {})[id] = obj;
    if (access.db) {
      await access.db.prepare("INSERT OR REPLACE INTO fin_docs (kind, id, json, updated_at) VALUES (?, ?, ?, ?)")
        .bind(kind, id, JSON.stringify(obj), new Date().toISOString()).run();
    }
  }
  /** The single posting gateway for engine modules: balanced, period-checked, duplicate-guarded, audited, persisted. */
  async function postNewJournal(init: { journalType: string; entryDate: string; description: string; sourceModule: string; sourceId: string; lines: NewLine[] }, opts: { bypassPeriodLock?: boolean } = {}): Promise<Journal> {
    const lines: JournalLine[] = init.lines.filter((l) => l.debit || l.credit).map((l) => {
      const acc = byCode(l.accountCode);
      if (!acc) throw new EngineError(`Unknown account ${l.accountCode}`, "UNKNOWN_ACCOUNT", 400);
      return { id: crypto.randomUUID(), accountId: acc.id, accountCode: acc.code, memo: l.memo, debit: Math.round(l.debit), credit: Math.round(l.credit),
        fcCurrency: l.fcCurrency, fcAmount: l.fcAmount, rateMicro: l.rateMicro, fxKind: l.fxKind };
    });
    const j: Journal = {
      id: crypto.randomUUID(), number: `JE-${String(store.journalSeq++).padStart(5, "0")}`, journalType: init.journalType,
      entryDate: init.entryDate, description: init.description.slice(0, 500), sourceModule: init.sourceModule, sourceId: init.sourceId,
      currency: policyAt("functionalCurrency", init.entryDate), status: "draft", lines, createdAt: new Date().toISOString(),
    };
    try { postJournal(j, opts); } catch (e: any) { store.journalSeq--; throw new EngineError(e.message, String(e.message).startsWith("DUPLICATE_POSTING") ? "DUPLICATE_POSTING" : "POSTING_REJECTED"); }
    store.journals.push(j);
    audit("journal", j.id, "created_posted", j.number);
    await persistJournal(j);
    return j;
  }
  const isoDate = (v: unknown, fallback?: string) => {
    const d = String(v || fallback || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new EngineError("date required as YYYY-MM-DD", "BAD_DATE", 400);
    return d;
  };
  const needId = (v: unknown, kind: string) => {
    const d = (store.docs[kind] || {})[String(v)];
    if (!d) throw new EngineError(`${kind} not found`, "NOT_FOUND", 404);
    return d;
  };

  if (/^(fx|inventory|payroll|restatements)(\/|$)/.test(path)) {
    try {
      const seg = path.split("/");
      const M = request.method;
      const now = () => new Date().toISOString();

      // ───────── FX ─────────
      if (path === "fx/rates" && M === "GET") {
        return json({ items: docsOf("fxRates").sort((a, b) => b.rateDate.localeCompare(a.rateDate)), functionalCurrency: policyAt("functionalCurrency", now().slice(0, 10)) });
      }
      if (path === "fx/rates" && M === "POST") {
        const b = await readJson(request);
        const currency = String(b.currency || "").toUpperCase();
        const fn = policyAt("functionalCurrency", now().slice(0, 10));
        if (!/^[A-Z]{3}$/.test(currency) || currency === fn) throw new EngineError(`currency must be a 3-letter code other than ${fn}`, "BAD_CURRENCY", 400);
        const type = String(b.type || "closing");
        if (!["closing", "average", "transaction", "settlement"].includes(type)) throw new EngineError("type must be closing|average|transaction|settlement", "BAD_TYPE", 400);
        const source = String(b.source || "").trim();
        if (source.length < 2) throw new EngineError("source required (e.g. Bank of Ghana)", "SOURCE_REQUIRED", 400);
        const r = { id: crypto.randomUUID(), currency, type, rateDate: isoDate(b.rateDate), rateMicro: toRateMicro(b.rate), source: source.slice(0, 120),
          status: b.approvedBy ? "approved" : "pending", approvedBy: b.approvedBy ? String(b.approvedBy).slice(0, 120) : undefined, createdAt: now() };
        await putDoc("fxRates", r.id, r);
        audit("fx_rate", r.id, "created", `${currency} ${type} ${b.rate}`);
        return json({ rate: r, note: r.status === "pending" ? "Pending rates are NOT used for revaluation until approved (POST fx/rates/:id/approve)." : undefined }, 201);
      }
      if (seg[0] === "fx" && seg[1] === "rates" && seg[3] === "approve" && M === "POST") {
        const r = needId(seg[2], "fxRates");
        const b = await readJson(request);
        if (!b.approvedBy) throw new EngineError("approvedBy required", "APPROVER_REQUIRED", 400);
        r.status = "approved"; r.approvedBy = String(b.approvedBy).slice(0, 120);
        await putDoc("fxRates", r.id, r);
        audit("fx_rate", r.id, "approved", r.approvedBy);
        return json({ rate: r });
      }
      if (path === "fx/exposure" && M === "GET") {
        const asOf = isoDate(url.searchParams.get("asOf"), now());
        const rows = fxPositions(asOf).map((p) => {
          const rate = fxRateAt(p.currency, asOf, "closing");
          const carrying = p.histMinor + p.revalMinor;
          const revalued = rate ? mulDiv(p.netFc, rate.rateMicro, RATE_SCALE) : null;
          return { ...p, carryingMinor: carrying, closingRateMicro: rate?.rateMicro ?? null, revaluedMinor: revalued, unrealizedPendingMinor: revalued == null ? null : revalued - carrying };
        });
        return json({ asOf, items: rows, note: "Natural sign: assets +debit, liabilities +credit. unrealizedPending is the revaluation still to be booked." });
      }
      if (path === "fx/revaluation/preview" && M === "GET") {
        const ym = String(url.searchParams.get("periodYm") || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) throw new EngineError("periodYm required", "BAD_PERIOD", 400);
        const plan = fxRevaluationPlan(ym);
        return json({ ...plan, totals: lineTotals(plan.lines), note: "Preview only — nothing posted." });
      }
      if (path === "fx/revalue" && M === "POST") {
        const b = await readJson(request);
        const ym = String(b.periodYm || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) throw new EngineError("periodYm required as YYYY-MM", "BAD_PERIOD", 400);
        const plan = fxRevaluationPlan(ym);
        if (plan.missingRates.length) throw new EngineError(`Approved closing rate missing for ${plan.missingRates.join(", ")} on or before ${plan.entryDate}`, "MISSING_RATE");
        if (!plan.lines.length) return json({ posted: false, detail: plan.detail, note: "Nothing to revalue — carrying amounts already equal the closing-rate values." });
        const j = await postNewJournal({ journalType: "fx_revaluation", entryDate: plan.entryDate, description: `Period-end FX revaluation ${ym}`, sourceModule: "fx_reval", sourceId: ym, lines: plan.lines });
        return json({ posted: true, journal: j, detail: plan.detail }, 201);
      }
      if (path === "fx/settle" && M === "POST") {
        const b = await readJson(request);
        const ccy = String(b.currency || "").toUpperCase();
        const date = isoDate(b.date);
        const lines = fxSettlementLines(String(b.accountCode || ""), ccy, Math.round(Number(b.fcAmount)), toRateMicro(b.rate), date, String(b.counterAccountCode || "1030"));
        const key = b.idempotencyKey ? String(b.idempotencyKey) : undefined;
        if (key) { const ex = store.journals.find((j) => j.sourceModule === "fx_settle" && j.sourceId === key && !j.reversedBy); if (ex) return json({ journal: ex, duplicate: true }); }
        const j = await postNewJournal({ journalType: "fx_settlement", entryDate: date, description: `FX settlement ${ccy} ${b.fcAmount} on ${b.accountCode}`, sourceModule: "fx_settle", sourceId: key || crypto.randomUUID(), lines });
        return json({ journal: j }, 201);
      }
      if (path === "fx/report" && M === "GET") {
        const from = url.searchParams.get("from") || undefined, to = url.searchParams.get("to") || undefined;
        const v = (c: string) => accountPeriodBalance(c, from, to);
        const realizedGain = v("4210"), realizedLoss = v("6390"), unrGain = v("4211"), unrLoss = v("6391");
        return json({ from: from || null, to: to || null, realizedGain, realizedLoss, unrealizedGain: unrGain, unrealizedLoss: unrLoss,
          netRealized: realizedGain - realizedLoss, netUnrealized: unrGain - unrLoss, netFx: realizedGain - realizedLoss + unrGain - unrLoss, currency: policyAt("functionalCurrency", to || now().slice(0, 10)) });
      }

      // ───────── Inventory ─────────
      if (path === "inventory/items" && M === "GET") return json({ items: docsOf("invItems").map((i) => ({ ...i, onHand: (({ qty, costMinor }) => ({ qty, costMinor }))(invOnHand(i.id)) })) });
      if (path === "inventory/items" && M === "POST") {
        const b = await readJson(request);
        const sku = String(b.sku || "").trim().toUpperCase();
        if (!sku || !b.name) throw new EngineError("sku and name required", "BAD_ITEM", 400);
        if (docsOf("invItems").some((i) => i.sku === sku)) throw new EngineError(`SKU ${sku} already exists`, "DUPLICATE_SKU");
        const it = { id: crypto.randomUUID(), sku, name: String(b.name).slice(0, 200), unit: String(b.unit || "unit"), createdAt: now() };
        await putDoc("invItems", it.id, it);
        return json({ item: it }, 201);
      }
      if (path === "inventory/movements" && M === "GET") {
        const itemId = url.searchParams.get("itemId");
        return json({ items: docsOf("invMoves").filter((m) => !itemId || m.itemId === itemId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
      }
      if (path === "inventory/receive" && M === "POST") {
        const b = await readJson(request);
        const item = needId(b.itemId, "invItems");
        const qty = Math.round(Number(b.qty)), cost = Math.round(Number(b.totalCostMinor));
        if (!(qty > 0) || !(cost > 0)) throw new EngineError("qty and totalCostMinor must be positive", "BAD_AMOUNT", 400);
        const date = isoDate(b.date);
        const key = b.idempotencyKey ? String(b.idempotencyKey) : undefined;
        if (key) { const ex = docsOf("invMoves").find((m) => m.key === key); if (ex) return json({ movement: ex, duplicate: true }); }
        const credit = String(b.creditAccountCode || "2010");
        const mv: any = { id: crypto.randomUUID(), itemId: item.id, type: "receive", date, qty, costMinor: cost, key, ref: b.reference ? String(b.reference).slice(0, 120) : undefined, createdAt: now() };
        const j = await postNewJournal({ journalType: "inventory_receipt", entryDate: date, description: `Inventory receipt ${item.sku} x${qty}`, sourceModule: "inventory", sourceId: mv.id,
          lines: [{ accountCode: "1090", memo: item.sku, debit: cost, credit: 0 }, { accountCode: credit, memo: mv.ref, debit: 0, credit: cost }] });
        const layer = { id: crypto.randomUUID(), itemId: item.id, date, qty, remainingQty: qty, totalCostMinor: cost, remainingCostMinor: cost, ref: mv.ref, createdAt: now() };
        mv.journalId = j.id; mv.layerId = layer.id;
        await putDoc("invLayers", layer.id, layer); await putDoc("invMoves", mv.id, mv);
        return json({ movement: mv, layer, journal: j }, 201);
      }
      if (path === "inventory/issue" && M === "POST") {
        const b = await readJson(request);
        const item = needId(b.itemId, "invItems");
        const reason = String(b.reason || "sale");
        if (!["sale", "damage", "loss", "shrinkage"].includes(reason)) throw new EngineError("reason must be sale|damage|loss|shrinkage", "BAD_REASON", 400);
        if (reason === "sale") {
          // COGS only when the sale has met recognition conditions: control transferred (delivered) and a sale reference
          if (b.fulfilled !== true || !String(b.saleRef || "").trim())
            throw new EngineError("COGS is recognised only for fulfilled sales: pass fulfilled:true (control transferred) and saleRef", "COGS_CONDITIONS_NOT_MET");
        }
        const date = isoDate(b.date);
        const key = b.idempotencyKey ? String(b.idempotencyKey) : undefined;
        if (key) { const ex = docsOf("invMoves").find((m) => m.key === key); if (ex) return json({ movement: ex, duplicate: true }); }
        const method = policyAt("inventoryMethod", date);
        const qty = Math.round(Number(b.qty));
        const c = invConsume(item.id, qty, method, b.layerId ? String(b.layerId) : undefined);
        const mv: any = { id: crypto.randomUUID(), itemId: item.id, type: "issue", reason, date, qty, costMinor: c.costMinor, consumed: c.consumed, method, key, saleRef: b.saleRef ? String(b.saleRef) : undefined, returnedQty: 0, createdAt: now() };
        const expense = reason === "sale" ? "5200" : "5210";
        let j: Journal;
        try {
          j = await postNewJournal({ journalType: reason === "sale" ? "cogs" : "inventory_loss", entryDate: date, description: `${reason === "sale" ? "COGS" : "Inventory " + reason} ${item.sku} x${qty} (${method})`, sourceModule: "inventory", sourceId: mv.id,
            lines: [{ accountCode: expense, memo: item.sku, debit: c.costMinor, credit: 0 }, { accountCode: "1090", memo: item.sku, debit: 0, credit: c.costMinor }] });
        } catch (e) { for (const x of c.consumed) { const l = store.docs["invLayers"]![x.layerId]; l.remainingQty += x.qty; l.remainingCostMinor += x.costMinor; } throw e; }
        mv.journalId = j.id;
        for (const l of c.touched) await putDoc("invLayers", l.id, l);
        await putDoc("invMoves", mv.id, mv);
        return json({ movement: mv, journal: j, unitCostMinor: Math.round(c.costMinor / qty) }, 201);
      }
      if (path === "inventory/return" && M === "POST") {
        const b = await readJson(request);
        const mv = needId(b.movementId, "invMoves");
        if (mv.type !== "issue" || mv.reason !== "sale") throw new EngineError("Only sale issues can be returned", "BAD_MOVEMENT", 400);
        const qty = Math.round(Number(b.qty));
        if (!(qty > 0) || qty > mv.qty - mv.returnedQty) throw new EngineError(`Return qty must be 1..${mv.qty - mv.returnedQty}`, "BAD_QTY", 400);
        const date = isoDate(b.date);
        const cost = qty === mv.qty - mv.returnedQty ? mv.costMinor - (mv.returnedCostMinor || 0) : mulDiv(mv.costMinor, qty, mv.qty);
        const item = needId(mv.itemId, "invItems");
        const j = await postNewJournal({ journalType: "cogs_return", entryDate: date, description: `Sales return ${item.sku} x${qty} at original cost`, sourceModule: "inventory", sourceId: `${mv.id}:return:${crypto.randomUUID()}`,
          lines: [{ accountCode: "1090", memo: item.sku, debit: cost, credit: 0 }, { accountCode: "5200", memo: item.sku, debit: 0, credit: cost }] });
        const layer = { id: crypto.randomUUID(), itemId: mv.itemId, date, qty, remainingQty: qty, totalCostMinor: cost, remainingCostMinor: cost, ref: `return of ${mv.id}`, createdAt: now() };
        mv.returnedQty += qty; mv.returnedCostMinor = (mv.returnedCostMinor || 0) + cost;
        await putDoc("invLayers", layer.id, layer); await putDoc("invMoves", mv.id, mv);
        const rm = { id: crypto.randomUUID(), itemId: mv.itemId, type: "return", date, qty, costMinor: cost, journalId: j.id, ofMovement: mv.id, createdAt: now() };
        await putDoc("invMoves", rm.id, rm);
        return json({ movement: rm, journal: j }, 201);
      }
      if (path === "inventory/purchase-return" && M === "POST") {
        const b = await readJson(request);
        const item = needId(b.itemId, "invItems");
        const date = isoDate(b.date), qty = Math.round(Number(b.qty));
        const c = invConsume(item.id, qty, policyAt("inventoryMethod", date), b.layerId ? String(b.layerId) : undefined);
        const mv: any = { id: crypto.randomUUID(), itemId: item.id, type: "purchase_return", date, qty, costMinor: c.costMinor, consumed: c.consumed, createdAt: now() };
        let j: Journal;
        try {
          j = await postNewJournal({ journalType: "purchase_return", entryDate: date, description: `Purchase return ${item.sku} x${qty}`, sourceModule: "inventory", sourceId: mv.id,
            lines: [{ accountCode: String(b.creditAccountCode || "2010"), memo: "Supplier credit", debit: c.costMinor, credit: 0 }, { accountCode: "1090", memo: item.sku, debit: 0, credit: c.costMinor }] });
        } catch (e) { for (const x of c.consumed) { const l = store.docs["invLayers"]![x.layerId]; l.remainingQty += x.qty; l.remainingCostMinor += x.costMinor; } throw e; }
        mv.journalId = j.id;
        for (const l of c.touched) await putDoc("invLayers", l.id, l);
        await putDoc("invMoves", mv.id, mv);
        return json({ movement: mv, journal: j }, 201);
      }
      if (path === "inventory/adjust" && M === "POST") {
        const b = await readJson(request);
        const item = needId(b.itemId, "invItems");
        const date = isoDate(b.date), qty = Math.round(Number(b.qty)), unit = Math.round(Number(b.unitCostMinor));
        if (!(qty > 0) || !(unit > 0)) throw new EngineError("Stock gain needs positive qty and unitCostMinor (use inventory/issue with reason loss for decreases)", "BAD_AMOUNT", 400);
        const cost = qty * unit;
        const mv: any = { id: crypto.randomUUID(), itemId: item.id, type: "adjust", date, qty, costMinor: cost, createdAt: now() };
        const j = await postNewJournal({ journalType: "inventory_adjustment", entryDate: date, description: `Stock count gain ${item.sku} x${qty}`, sourceModule: "inventory", sourceId: mv.id,
          lines: [{ accountCode: "1090", memo: item.sku, debit: cost, credit: 0 }, { accountCode: "5210", memo: "Stock count gain", debit: 0, credit: cost }] });
        const layer = { id: crypto.randomUUID(), itemId: item.id, date, qty, remainingQty: qty, totalCostMinor: cost, remainingCostMinor: cost, ref: "stock count gain", createdAt: now() };
        mv.journalId = j.id;
        await putDoc("invLayers", layer.id, layer); await putDoc("invMoves", mv.id, mv);
        return json({ movement: mv, journal: j }, 201);
      }
      if (path === "inventory/writedown" && M === "POST") {
        const b = await readJson(request);
        const item = needId(b.itemId, "invItems");
        const date = isoDate(b.date), nrv = Math.round(Number(b.nrvUnitMinor));
        if (!(nrv >= 0)) throw new EngineError("nrvUnitMinor (net realisable value per unit) required", "BAD_AMOUNT", 400);
        let total = 0; const touched: any[] = [];
        for (const l of invLayersOf(item.id)) {
          const target = nrv * l.remainingQty;
          if (l.remainingCostMinor > target) { total += l.remainingCostMinor - target; l.remainingCostMinor = target; touched.push(l); }
        }
        if (!total) return json({ written_down: false, note: "Cost is at or below net realisable value — no write-down (prudence does not require one)." });
        const mv: any = { id: crypto.randomUUID(), itemId: item.id, type: "writedown", date, qty: 0, costMinor: total, nrvUnitMinor: nrv, createdAt: now() };
        const j = await postNewJournal({ journalType: "inventory_writedown", entryDate: date, description: `Write-down ${item.sku} to NRV ${nrv}/unit`, sourceModule: "inventory", sourceId: mv.id,
          lines: [{ accountCode: "5210", memo: item.sku, debit: total, credit: 0 }, { accountCode: "1090", memo: item.sku, debit: 0, credit: total }] });
        mv.journalId = j.id;
        for (const l of touched) await putDoc("invLayers", l.id, l);
        await putDoc("invMoves", mv.id, mv);
        return json({ written_down: true, movement: mv, journal: j }, 201);
      }
      if ((path === "inventory/valuation" || path === "inventory/reconcile") && M === "GET") {
        const rows = docsOf("invItems").map((i) => { const o = invOnHand(i.id); return { itemId: i.id, sku: i.sku, name: i.name, qty: o.qty, costMinor: o.costMinor, unitCostMinor: o.qty ? Math.round(o.costMinor / o.qty) : 0 }; });
        const sub = rows.reduce((t, r) => t + r.costMinor, 0);
        const gl = accountBalance("1090");
        return json({ method: policyAt("inventoryMethod", now().slice(0, 10)), items: rows, subledgerMinor: sub, generalLedgerMinor: gl, differenceMinor: gl - sub, reconciled: gl === sub,
          note: "Single stock location; stock transfers between locations are not implemented." });
      }

      // ───────── Payroll ─────────
      const saveRule = async (rule: any) => {
        await putDoc("payrollRules", rule.id, rule);
        audit("payroll_rule", rule.id, "set", rule.effectiveFrom);
        return json({ rule, note: "Rates are configuration, not code. Enter them from the current statutory schedule; add a new effective-dated rule when they change." }, 201);
      };
      if (path === "payroll/presets" && M === "GET") {
        return json({ items: PAYROLL_PRESETS.map((p) => ({ ...p, loaded: p.rules.every((r) => docsOf("payrollRules").some((x) => x.presetKey === `${p.key}:${r.effectiveFrom}`)) })) });
      }
      if (seg[0] === "payroll" && seg[1] === "presets" && seg[2] && M === "POST") {
        const preset = PAYROLL_PRESETS.find((p) => p.key === seg[2]);
        if (!preset) throw new EngineError("Unknown preset", "NOT_FOUND", 404);
        const created: any[] = [], skipped: string[] = [];
        for (const r of preset.rules) {
          const presetKey = `${preset.key}:${r.effectiveFrom}`;
          if (docsOf("payrollRules").some((x) => x.presetKey === presetKey)) { skipped.push(r.effectiveFrom); continue; }
          const rule = { id: crypto.randomUUID(), effectiveFrom: r.effectiveFrom, payeBands: r.payeBands, ...preset.common, source: `${preset.label} — ${r.source}`.slice(0, 600), presetKey, reviewBy: preset.reviewBy, createdAt: now() };
          await putDoc("payrollRules", rule.id, rule);
          audit("payroll_rule", rule.id, "preset_loaded", presetKey);
          created.push(rule);
        }
        return json({ created, skipped, note: skipped.length ? "Rules already loaded were left untouched." : `Loaded ${created.length} rule(s). Verify against the cited sources before your first payroll.` }, created.length ? 201 : 200);
      }
      if (path === "payroll/rules" && M === "GET") return json({ items: docsOf("payrollRules").sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) });
      if (path === "payroll/rules" && M === "POST") {
        const b = await readJson(request);
        const bands: PayeBand[] = Array.isArray(b.payeBands) ? b.payeBands.map((x: any) => ({ upToMinor: x.upToMinor == null ? null : Math.round(Number(x.upToMinor)), rateBps: Math.round(Number(x.rateBps)) })) : [];
        if (!bands.length || bands[bands.length - 1]!.upToMinor !== null || bands.some((x, i) => i < bands.length - 1 && (x.upToMinor == null || (i > 0 && x.upToMinor! <= bands[i - 1]!.upToMinor!))))
          throw new EngineError("payeBands must be ascending monthly bands ending with upToMinor:null", "BAD_BANDS", 400);
        const ee = Math.round(Number(b.employeePensionBps)), er = Math.round(Number(b.employerPensionBps));
        if (![ee, er].every((x) => Number.isInteger(x) && x >= 0 && x <= 10000)) throw new EngineError("employeePensionBps and employerPensionBps required (basis points)", "BAD_RATE", 400);
        const source = String(b.source || "").trim();
        if (source.length < 3) throw new EngineError("source required — cite the current GRA/SSNIT schedule you copied the rates from", "SOURCE_REQUIRED", 400);
        const opt = (k: string, min = 0, max = 1e12): number | undefined => {
          if (b[k] == null || b[k] === "") return undefined;
          const n = Math.round(Number(b[k]));
          if (!Number.isInteger(n) || n < min || n > max) throw new EngineError(`${k} must be an integer ${min}..${max}`, "BAD_RULE_FIELD", 400);
          return n;
        };
        const extra: Record<string, number | undefined> = {
          pensionBaseMinMinor: opt("pensionBaseMinMinor"), pensionBaseMaxMinor: opt("pensionBaseMaxMinor"),
          bonusConcessionBps: opt("bonusConcessionBps", 0, 10000), bonusCapBps: opt("bonusCapBps", 0, 10000),
          overtimeLowBps: opt("overtimeLowBps", 0, 10000), overtimeHighBps: opt("overtimeHighBps", 0, 10000), overtimeBasicThresholdBps: opt("overtimeBasicThresholdBps", 0, 100000),
          overtimeJuniorIncomeLimitMinor: opt("overtimeJuniorIncomeLimitMinor"),
          nonResidentFlatBps: opt("nonResidentFlatBps", 0, 10000), nonResidentBonusOvertimeBps: opt("nonResidentBonusOvertimeBps", 0, 10000),
        };
        if (extra.pensionBaseMinMinor != null && extra.pensionBaseMaxMinor != null && extra.pensionBaseMinMinor > extra.pensionBaseMaxMinor)
          throw new EngineError("pensionBaseMinMinor cannot exceed pensionBaseMaxMinor", "BAD_RULE_FIELD", 400);
        const reviewBy = b.reviewBy ? isoDate(b.reviewBy) : undefined;
        const rule: any = { id: crypto.randomUUID(), effectiveFrom: isoDate(b.effectiveFrom), payeBands: bands, employeePensionBps: ee, employerPensionBps: er,
          pensionBase: b.pensionBase === "gross" ? "gross" : "basic", pensionDeductibleForPaye: b.pensionDeductibleForPaye !== false, source: source.slice(0, 600), reviewBy, createdAt: now() };
        for (const [k, v] of Object.entries(extra)) if (v !== undefined) rule[k] = v;
        return await saveRule(rule);

      }
      if (path === "payroll/employees" && M === "GET") return json({ items: docsOf("employees") });
      if (path === "payroll/employees" && M === "POST") {
        const b = await readJson(request);
        const basic = Math.round(Number(b.basicMinor));
        if (!b.name || !(basic > 0)) throw new EngineError("name and basicMinor (monthly, minor units) required", "BAD_EMPLOYEE", 400);
        const e = { id: crypto.randomUUID(), name: String(b.name).slice(0, 200), basicMinor: basic, allowances: b.allowances && typeof b.allowances === "object" ? b.allowances : {}, pensionEnrolled: b.pensionEnrolled !== false,
          juniorStaff: b.juniorStaff === true, nonResident: b.nonResident === true, active: true, createdAt: now() };
        await putDoc("employees", e.id, e);
        return json({ employee: e }, 201);
      }
      if (path === "payroll/runs" && M === "GET") return json({ items: docsOf("payrollRuns").sort((a, b) => b.periodYm.localeCompare(a.periodYm)) });
      if (path === "payroll/runs" && M === "POST") {
        const b = await readJson(request);
        const ym = String(b.periodYm || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) throw new EngineError("periodYm required", "BAD_PERIOD", 400);
        const end = lastDayOfMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));
        const rule = payrollRuleAt(end);
        if (!rule) throw new EngineError(`No payroll rule effective on ${end}. Configure statutory rates first (POST payroll/rules).`, "PAYROLL_RULES_NOT_CONFIGURED");
        if (docsOf("payrollRuns").some((r) => r.periodYm === ym && r.status !== "void")) throw new EngineError(`A payroll run for ${ym} already exists`, "DUPLICATE_RUN");
        const adj: Record<string, any> = {}; for (const a of Array.isArray(b.adjustments) ? b.adjustments : []) adj[String(a.employeeId)] = a;
        const emps = docsOf("employees").filter((e) => e.active);
        if (!emps.length) throw new EngineError("No active employees", "NO_EMPLOYEES");
        const yr = ym.slice(0, 4);
        const ytdConc = (empId: string) => docsOf("payrollRuns").filter((r) => r.status !== "void" && r.periodYm.slice(0, 4) === yr && r.periodYm < ym)
          .reduce((t, r) => t + (r.lines.find((l: any) => l.employeeId === empId)?.bonusConcession || 0), 0);
        const lines = emps.map((e) => payrollCalc(rule, e, adj[e.id], ytdConc(e.id)));
        const warnings: string[] = [];
        if (rule.reviewBy && end > rule.reviewBy) warnings.push(`The statutory rule in force (effective ${rule.effectiveFrom}) was due for review by ${rule.reviewBy}. Confirm current GRA/SSNIT rates and add a new rule if they changed.`);
        const sum = (k: string) => lines.reduce((t, l: any) => t + l[k], 0);
        const run = { id: crypto.randomUUID(), periodYm: ym, status: "calculated", ruleId: rule.id, lines,
          warnings, totals: { gross: sum("gross"), employeePension: sum("employeePension"), employerPension: sum("employerPension"), paye: sum("paye"), otherDeductions: sum("otherDeductions"), net: sum("net") }, createdAt: now() };
        await putDoc("payrollRuns", run.id, run);
        audit("payroll_run", run.id, "calculated", ym);
        return json({ run }, 201);
      }
      if (seg[0] === "payroll" && seg[1] === "runs" && seg[2] && M === "GET" && !seg[3]) return json({ run: needId(seg[2], "payrollRuns") });
      if (seg[0] === "payroll" && seg[1] === "runs" && seg[3] === "approve" && M === "POST") {
        const run = needId(seg[2], "payrollRuns");
        const b = await readJson(request);
        if (run.status !== "calculated") throw new EngineError(`Run is ${run.status}; only calculated runs can be approved`, "BAD_STATE");
        if (!b.approvedBy) throw new EngineError("approvedBy required", "APPROVER_REQUIRED", 400);
        const t = run.totals;
        const j = await postNewJournal({ journalType: "payroll", entryDate: lastDayOfMonth(Number(run.periodYm.slice(0, 4)), Number(run.periodYm.slice(5, 7))), description: `Payroll ${run.periodYm}`, sourceModule: "payroll", sourceId: run.id,
          lines: [
            { accountCode: "6010", memo: "Gross salaries and wages", debit: t.gross, credit: 0 },
            { accountCode: "6011", memo: "Employer pension", debit: t.employerPension, credit: 0 },
            { accountCode: "2060", memo: "PAYE payable", debit: 0, credit: t.paye },
            { accountCode: "2061", memo: "Pension payable (employee + employer)", debit: 0, credit: t.employeePension + t.employerPension },
            { accountCode: "2062", memo: "Other deductions payable", debit: 0, credit: t.otherDeductions },
            { accountCode: "2040", memo: "Net salaries payable", debit: 0, credit: t.net },
          ] });
        run.status = "approved"; run.approvedBy = String(b.approvedBy).slice(0, 120); run.approvedAt = now(); run.journalId = j.id;
        await putDoc("payrollRuns", run.id, run);
        audit("payroll_run", run.id, "approved", run.approvedBy);
        return json({ run, journal: j });
      }
      if (seg[0] === "payroll" && seg[1] === "runs" && seg[3] === "pay" && M === "POST") {
        const run = needId(seg[2], "payrollRuns");
        const b = await readJson(request);
        if (run.status !== "approved") throw new EngineError(`Run is ${run.status}; only approved runs can be paid`, "BAD_STATE");
        const date = isoDate(b.date);
        const j = await postNewJournal({ journalType: "payroll_payment", entryDate: date, description: `Net salaries paid ${run.periodYm}`, sourceModule: "payroll_payment", sourceId: run.id,
          lines: [{ accountCode: "2040", memo: "Net salaries paid", debit: run.totals.net, credit: 0 }, { accountCode: String(b.bankCode || "1030"), memo: "Salary payment", debit: 0, credit: run.totals.net }] });
        run.status = "paid"; run.paidAt = now(); run.paymentJournalId = j.id;
        await putDoc("payrollRuns", run.id, run);
        audit("payroll_run", run.id, "paid", date);
        return json({ run, journal: j });
      }

      // ───────── Restatement packs ─────────
      if (path === "restatements" && M === "GET") return json({ items: docsOf("restatements").map((r) => ({ id: r.id, fiscalYear: r.fiscalYear, type: r.type, status: r.status, treatment: r.treatment, netProfitImpactMinor: r.impact.netProfit, createdAt: r.createdAt })) });
      if (seg[0] === "restatements" && seg[1] && !seg[2] && M === "GET") return json({ pack: needId(seg[1], "restatements") });
      if (path === "restatements" && M === "POST") {
        const b = await readJson(request);
        const fy = Number(b.fiscalYear);
        const type = String(b.type || "error");
        if (!["error", "policy_change", "estimate_change"].includes(type)) throw new EngineError("type must be error|policy_change|estimate_change", "BAD_TYPE", 400);
        const yc = store.yearCloses.find((y) => y.fiscalYear === fy);
        if (!yc || yc.status !== "closed") throw new EngineError(`FY${fy} is not closed. Correct an open year with normal journals; a restatement applies to issued (closed) years.`, "YEAR_NOT_CLOSED");
        const adjIn: any[] = Array.isArray(b.adjustments) ? b.adjustments : [];
        const adj = adjIn.map((l) => { const a = byCode(String(l.accountCode)); if (!a) throw new EngineError(`Unknown account ${l.accountCode}`, "UNKNOWN_ACCOUNT", 400); return { accountCode: a.code, memo: l.memo ? String(l.memo).slice(0, 200) : undefined, debit: Math.round(Number(l.debit) || 0), credit: Math.round(Number(l.credit) || 0) }; });
        if (!adj.length || !lineTotals(adj).balanced) throw new EngineError("Adjustments must be present and balance (debits = credits)", "UNBALANCED", 400);
        if (adj.some((l) => l.accountCode === policyAt("retainedEarningsCode", yc.endDate))) throw new EngineError("Do not adjust retained earnings directly; the engine derives the opening retained-earnings adjustment from the P&L effect", "DIRECT_RE_ADJUSTMENT", 400);
        for (const f of ["description", "rootCause"]) if (String(b[f] || "").trim().length < 3) throw new EngineError(`${f} required`, "FIELD_REQUIRED", 400);
        const original = fyBalances(yc.startDate, yc.endDate);
        const origStm = statementsOf(original.cum, original.act);
        const restatedMaps = applyAdjustments(original, adj);
        const restStm = statementsOf(restatedMaps.cum, restatedMaps.act);
        const impact = { revenue: restStm.revenue - origStm.revenue, expense: restStm.expense - origStm.expense, netProfit: restStm.netProfit - origStm.netProfit, assets: restStm.assets - origStm.assets, liabilities: restStm.liabilities - origStm.liabilities, equity: restStm.equity - origStm.equity };
        const bps = Number(policyAt("materialityBps", yc.endDate));
        const threshold = Math.max(1, mulDiv(Math.abs(origStm.revenue), bps, 10000));
        const quantitative = Math.abs(impact.netProfit) >= threshold;
        const qualitative = b.qualitativeMaterial === true;
        const material = quantitative || qualitative;
        const impracticable = b.impracticable && String(b.impracticable.reason || "").trim().length >= 5 ? { reason: String(b.impracticable.reason).slice(0, 500) } : null;
        const treatment = type === "estimate_change" ? "prospective" : impracticable ? "prospective_impracticable" : material ? "retrospective_restatement" : "current_period_correction";
        const accounts = new Map<string, { accountCode: string; name: string; originalMinor: number; restatedMinor: number }>();
        for (const l of adj) { const a = byCode(l.accountCode)!; const isPl = a.type === "revenue" || a.type === "expense"; const m = isPl ? original.act : original.cum; const r = isPl ? restatedMaps.act : restatedMaps.cum; accounts.set(a.code, { accountCode: a.code, name: a.name, originalMinor: m.get(a.code) || 0, restatedMinor: r.get(a.code) || 0 }); }
        const pack = { id: crypto.randomUUID(), fiscalYear: fy, period: { startDate: yc.startDate, endDate: yc.endDate }, type, status: "draft", treatment,
          description: String(b.description).slice(0, 1000), rootCause: String(b.rootCause).slice(0, 1000), managementExplanation: b.managementExplanation ? String(b.managementExplanation).slice(0, 2000) : undefined,
          materiality: { thresholdMinor: threshold, thresholdBps: bps, netProfitImpactMinor: impact.netProfit, quantitativelyMaterial: quantitative, qualitativelyMaterial: qualitative, material },
          impracticable, original: { ...origStm, preservedAt: now(), note: "Snapshot of the statements as issued for this year; never overwritten" }, restated: restStm, impact,
          accountImpact: [...accounts.values()], adjustments: adj,
          openingRetainedEarningsAdjustmentMinor: impact.netProfit, approvals: [] as any[], journalId: undefined as string | undefined, createdAt: now() };
        await putDoc("restatements", pack.id, pack);
        audit("restatement", pack.id, "created", `FY${fy} ${treatment}`);
        return json({ pack }, 201);
      }
      if (seg[0] === "restatements" && seg[2] === "approve" && M === "POST") {
        const pack = needId(seg[1], "restatements");
        const b = await readJson(request);
        if (pack.status === "posted") throw new EngineError("Already posted", "BAD_STATE");
        if (!b.approvedBy || String(b.comment || "").trim().length < 3) throw new EngineError("approvedBy and comment required", "APPROVER_REQUIRED", 400);
        pack.approvals.push({ approvedBy: String(b.approvedBy).slice(0, 120), comment: String(b.comment).slice(0, 500), at: now() });
        pack.status = "approved";
        await putDoc("restatements", pack.id, pack);
        audit("restatement", pack.id, "approved", String(b.approvedBy));
        return json({ pack });
      }
      if (seg[0] === "restatements" && seg[2] === "post" && M === "POST") {
        const pack = needId(seg[1], "restatements");
        const b = await readJson(request);
        if (pack.status !== "approved") throw new EngineError(`Pack is ${pack.status}; approve it before posting`, "NOT_APPROVED");
        const date = isoDate(b.entryDate, now());
        const reCode = policyAt("retainedEarningsCode", pack.period.endDate);
        let lines: NewLine[] = pack.adjustments.map((l: any) => ({ ...l }));
        if (pack.treatment === "retrospective_restatement") {
          // Prior-year P&L effects go to OPENING retained earnings in the current period; balance-sheet lines post as given.
          let plD = 0, plC = 0; const bs: NewLine[] = [];
          for (const l of lines) { const a = byCode(l.accountCode)!; if (a.type === "revenue" || a.type === "expense") { plD += l.debit; plC += l.credit; } else bs.push(l); }
          lines = [...bs]; if (plD > plC) lines.push({ accountCode: reCode, memo: `FY${pack.fiscalYear} restatement — opening retained earnings`, debit: plD - plC, credit: 0 });
          else if (plC > plD) lines.push({ accountCode: reCode, memo: `FY${pack.fiscalYear} restatement — opening retained earnings`, debit: 0, credit: plC - plD });
        }
        const j = await postNewJournal({ journalType: "restatement", entryDate: date, description: `Restatement FY${pack.fiscalYear} (${pack.treatment}): ${pack.description}`, sourceModule: "restatement", sourceId: pack.id, lines });
        pack.status = "posted"; pack.journalId = j.id; pack.postedAt = now();
        await putDoc("restatements", pack.id, pack);
        audit("restatement", pack.id, "posted", j.number);
        return json({ pack, journal: j });
      }
      return json({ error: "Not found", path }, 404);
    } catch (e: any) {
      if (e instanceof EngineError) return json({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  }

  return json({ error: "Not found", path }, 404);
};
