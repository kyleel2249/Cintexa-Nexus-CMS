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

interface Audit {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  detail?: string;
  createdAt: string;
}

interface Store {
  accounts: Account[];
  journals: Journal[];
  invoices: Invoice[];
  payments: Payment[];
  audit: Audit[];
  journalSeq: number;
  invoiceSeq: number;
  seededCoa: boolean;
}

const store: Store = {
  accounts: [],
  journals: [],
  invoices: [],
  payments: [],
  audit: [],
  journalSeq: 1,
  invoiceSeq: 1,
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

function accountBalance(code: string, asOf?: string): number {
  let bal = 0;
  const acc = byCode(code);
  if (!acc) return 0;
  for (const j of store.journals) {
    if (j.status !== "posted") continue;
    if (asOf && j.entryDate > asOf) continue;
    for (const l of j.lines) {
      if (l.accountCode !== code) continue;
      if (acc.type === "asset" || acc.type === "expense") bal += l.debit - l.credit;
      else bal += l.credit - l.debit;
    }
  }
  return bal;
}

function trialBalance(asOf?: string) {
  ensureCoa();
  const rows = store.accounts.filter((a) => a.active).map((a) => {
    const bal = accountBalance(a.code, asOf);
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
  const p = pnl(undefined, asOf || undefined);
  equity += p.netProfit;
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

function postJournal(j: Journal) {
  const t = lineTotals(j.lines);
  if (!t.balanced) throw new Error(`Unbalanced journal: debit ${t.debit} credit ${t.credit} difference ${t.difference}`);
  if (!j.lines.length) throw new Error("Journal has no lines");
  j.status = "posted";
  j.postedAt = new Date().toISOString();
  j.postingDate = j.postingDate || j.entryDate;
  audit("journal", j.id, "posted", j.number);
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
      `INSERT INTO fin_journals (id, number, journal_type, entry_date, posting_date, description, source_module, source_id, currency, status, created_at, posted_at, reversed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      j.id, j.number, j.journalType, j.entryDate, j.postingDate || null, j.description,
      j.sourceModule || null, j.sourceId || null, j.currency, j.status, j.createdAt, j.postedAt || null, j.reversedBy || null,
    ),
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
    `INSERT INTO fin_invoices (id, number, customer_id, customer_name, issue_date, due_date, currency, amount_minor, amount_paid_minor, status, source_module, source_id, journal_id, created_at)
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
    `INSERT INTO fin_payments (id, invoice_id, customer_name, payment_date, amount_minor, currency, method, journal_id, source_module, source_id, created_at)
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

async function d1Audit(db: D1Database, entityType: string, entityId: string, action: string, detail?: string) {
  await db.prepare(
    "INSERT INTO fin_audit (id, entity_type, entity_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), entityType, entityId, action, detail || null, new Date().toISOString()).run();
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
    return json({ journal: j });
  }

  if (path.startsWith("journals/") && path.endsWith("/reverse") && request.method === "POST") {
    const id = path.split("/")[1];
    const j = store.journals.find((x) => x.id === id);
    if (!j) return json({ error: "Not found" }, 404);
    if (j.status !== "posted") return json({ error: "Only posted journals can be reversed" }, 400);
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
    return json({ original: j, reversal: rev });
  }

  if (path === "trial-balance") {
    return json(trialBalance(url.searchParams.get("asOf") || undefined));
  }
  if (path === "pnl") {
    return json(pnl(url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined));
  }
  if (path === "balance-sheet") {
    return json(balanceSheet(url.searchParams.get("asOf") || undefined));
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
    const j: Journal = {
      id: crypto.randomUUID(),
      number: `JE-${String(store.journalSeq++).padStart(5, "0")}`,
      journalType: "sales",
      entryDate: issueDate,
      description: `Invoice ${inv.number} — ${customerName}`,
      sourceModule: inv.sourceModule,
      sourceId: inv.id,
      currency: inv.currency,
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, memo: inv.number, debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: rev.id, accountCode: rev.code, memo: inv.number, debit: 0, credit: amount },
      ],
      createdAt: new Date().toISOString(),
    };
    postJournal(j);
    store.journals.push(j);
    inv.journalId = j.id;
    store.invoices.push(inv);
    audit("invoice", inv.id, "created_posted", inv.number);
    await persistInvoice(inv);
    if (inv.journalId) { const jj = store.journals.find((x) => x.id === inv.journalId); if (jj) await persistJournal(jj); }
    await persistInvoice(inv);
    if (inv.journalId) {
      const jj = store.journals.find((x) => x.id === inv.journalId);
      if (jj) await persistJournal(jj);
    }

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
      description: `Payment from ${customerName}${inv ? ` for ${inv.number}` : ""}`,
      sourceModule: pay.sourceModule,
      sourceId: pay.id,
      currency: pay.currency,
      status: "draft",
      lines: [
        { id: crypto.randomUUID(), accountId: bank.id, accountCode: bank.code, memo: "Receipt", debit: amount, credit: 0 },
        { id: crypto.randomUUID(), accountId: ar.id, accountCode: ar.code, memo: inv?.number || "AR", debit: 0, credit: amount },
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
    return json({ journal: j, gross, discount, net, method: "net" }, 201);
  }

  return json({ error: "Not found", path }, 404);
};
