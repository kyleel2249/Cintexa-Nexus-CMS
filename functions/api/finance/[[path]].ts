/**
 * CINTEXA Finance — double-entry accounting API (/api/finance/*)
 * Zero third-party API keys. Integer minor units. Balanced journals only.
 * Authoritative store: context.env.FIN_DB (Cloudflare D1).
 * Isolate memory is only used when FIN_ALLOW_MEMORY=1 for local/dev — never production.
 */

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

function accountBalance(code: string, asOf?: string, preClosing = false): number {
  let bal = 0;
  const acc = byCode(code);
  if (!acc) return 0;
  for (const j of store.journals) {
    if (j.status !== "posted") continue;
    if (preClosing && isClosingJournal(j)) continue;
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

function postJournal(j: Journal, opts: { bypassPeriodLock?: boolean } = {}) {
  const t = lineTotals(j.lines);
  if (!t.balanced) throw new Error(`Unbalanced journal: debit ${t.debit} credit ${t.credit} difference ${t.difference}`);
  if (!j.lines.length) throw new Error("Journal has no lines");
  // Duplicate-posting guard: one live posted journal per (type, source module, source id)
  if (j.sourceModule && j.sourceId) {
    const dup = store.journals.find((x) => x.id !== j.id && x.status === "posted" && !x.reversedBy && x.journalType === j.journalType
      && x.sourceModule === j.sourceModule && x.sourceId === j.sourceId);
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
  warnings.push("Not yet automated and therefore NOT verified by this check: FX revaluation, inventory/COGS, payroll accruals, bank reconciliation.");
  return { closing: c, blockers, warnings, canClose: blockers.length === 0 };
}

type Env = {
  FIN_DB?: D1Database;
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
        `INSERT INTO fin_journal_lines (id, journal_id, account_id, account_code, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(l.id, j.id, l.accountId, l.accountCode, l.memo || null, l.debit, l.credit),
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
  store.seededCoa = true;
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
  const jn = await d1NextSeq(db, "journal");
  const inv = await d1NextSeq(db, "invoice");
  store.journalSeq = jn;
  store.invoiceSeq = inv;
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
  async function persistInvoice(inv: Invoice) {
    if (access.db) {
      await d1InsertInvoice(access.db, inv);
      await d1Audit(access.db, "invoice", inv.id, "created", inv.number);
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
      const debit = Math.round(Number(l.debit) || 0);
      const credit = Math.round(Number(l.credit) || 0);
      if (debit < 0 || credit < 0) return json({ error: "Amounts must be non-negative" }, 400);
      if (debit > 0 && credit > 0) return json({ error: "Line cannot have both debit and credit" }, 400);
      lines.push({
        id: crypto.randomUUID(),
        accountId: acc.id,
        accountCode: acc.code,
        memo: l.memo ? String(l.memo).slice(0, 300) : undefined,
        debit,
        credit,
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

    // Best-effort diary + sync
    const origin = url.origin;
    try {
      await fetch(`${origin}/api/diary/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Invoice issued ${inv.number}`,
          category: "Finance",
          activityDate: issueDate,
          description: `Invoice ${inv.number} to ${customerName} for ${amount} minor units ${inv.currency}. Source: ${inv.sourceModule}`,
          clientName: customerName,
          tags: ["auto-sync", "invoice", "finance"],
          successStatus: "pending",
        }),
      });
    } catch { /* optional */ }
    try {
      await fetch(`${origin}/api/sync/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: "INVOICE_CREATED",
          sourceModule: "finance",
          entityType: "invoice",
          entityId: inv.id,
          idempotencyKey: `invoice:${inv.id}`,
          payload: { number: inv.number, customerName, amountMinor: amount },
        }),
      });
    } catch { /* optional */ }

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
    if (access.db) {
      try {
        await access.db.prepare(
          `INSERT OR REPLACE INTO fin_fixed_assets (id, asset_number, name, category, acquisition_date, in_service_date, cost_minor, residual_minor, depreciation_rate_bps, method, useful_life_months, accumulated_minor, status, location, custodian, disposal_date, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        ).bind(a.id, a.assetNumber, a.name, a.category, a.acquisitionDate, a.inServiceDate, a.costMinor, a.residualMinor, a.depreciationRateBps, a.method, a.accumulatedMinor, a.status, a.location || null, a.custodian || null, a.currency, a.createdAt, a.updatedAt).run();
      } catch { /* table may not exist yet */ }
    }
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

  return json({ error: "Not found", path }, 404);
};
