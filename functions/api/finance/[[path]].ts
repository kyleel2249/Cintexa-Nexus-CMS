/**
 * CINTEXA Finance — double-entry accounting API (/api/finance/*)
 * Zero third-party API keys. Integer minor units. Balanced journals only.
 * Persist via DIARY_DB/FI_DB-style binding FIN_DB when configured; else isolate memory
 * (production should bind D1 — memory is not authoritative across isolates).
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
    ["1000", "Cash", "asset", "cash"],
    ["1010", "Bank", "asset", "bank"],
    ["1100", "Accounts Receivable", "asset", "ar"],
    ["1500", "Equipment", "asset", "fixed"],
    ["1600", "Accumulated Depreciation", "asset", "contra"],
    ["2000", "Accounts Payable", "liability", "ap"],
    ["2100", "Taxes Payable", "liability", "tax"],
    ["2200", "Deferred Revenue", "liability"],
    ["3000", "Owner Capital", "equity"],
    ["3100", "Retained Earnings", "equity"],
    ["4000", "Website Development Revenue", "revenue"],
    ["4010", "Software Development Revenue", "revenue"],
    ["4020", "Business Automation Revenue", "revenue"],
    ["4030", "Consulting Revenue", "revenue"],
    ["4040", "Technical Support Revenue", "revenue"],
    ["4050", "Training Revenue", "revenue"],
    ["4090", "Other Service Revenue", "revenue"],
    ["5000", "Salaries and Wages", "expense"],
    ["5100", "Contractor Payments", "expense"],
    ["5200", "Software Subscriptions", "expense"],
    ["5300", "Hosting and Infrastructure", "expense"],
    ["5400", "Marketing", "expense"],
    ["5500", "Office Expenses", "expense"],
    ["5600", "Bank Charges", "expense"],
    ["5700", "Depreciation Expense", "expense"],
    ["5900", "Other Operating Expenses", "expense"],
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

function pnl(from?: string, to?: string) {
  ensureCoa();
  let revenue = 0, expense = 0;
  for (const a of store.accounts.filter((x) => x.active)) {
    if (a.type !== "revenue" && a.type !== "expense") continue;
    let bal = 0;
    for (const j of store.journals) {
      if (j.status !== "posted") continue;
      if (from && j.entryDate < from) continue;
      if (to && j.entryDate > to) continue;
      for (const l of j.lines) {
        if (l.accountCode !== a.code) continue;
        if (a.type === "expense") bal += l.debit - l.credit;
        else bal += l.credit - l.debit;
      }
    }
    if (a.type === "revenue") revenue += bal;
    else expense += bal;
  }
  return {
    revenue,
    expense,
    netProfit: revenue - expense,
    from: from || null,
    to: to || null,
    currency: "GHS",
    note: "From posted journals only. Not cash position.",
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

type Env = { FIN_DB?: D1Database };

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  ensureCoa();

  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");
  const url = new URL(request.url);

  if (path === "" || path === "dashboard") {
    const tb = trialBalance();
    const p = pnl();
    const bs = balanceSheet();
    const ar = accountBalance("1100");
    const cash = accountBalance("1000") + accountBalance("1010");
    return json({
      currency: "GHS",
      revenue: p.revenue,
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
      apiKeysRequired: false,
      storage: context.env.FIN_DB ? "d1" : "isolate-memory",
      engine: "cintexa-finance-double-entry-v1",
    });
  }

  if (path === "meta") {
    return json({
      name: "CINTEXA Finance",
      version: "1.0.0",
      apiKeysRequired: false,
      firebase: false,
      doubleEntry: true,
      baseCurrency: "GHS",
      storage: context.env.FIN_DB ? "d1" : "isolate-memory",
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
    return json({ journal: { ...j, totals: t } }, 201);
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
    const ar = byCode("1100")!;
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
    const bank = byCode(String(body.bankAccountCode || "1010")) || byCode("1000")!;
    const ar = byCode("1100")!;
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
        const ar = byCode("1100")!;
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

  return json({ error: "Not found", path }, 404);
};
