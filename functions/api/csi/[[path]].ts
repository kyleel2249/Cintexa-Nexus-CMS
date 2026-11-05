/**
 * CINTEXA Corporate Strategy & Intelligence API (/api/csi/*)
 * Zero third-party API keys. Authoritative store: CSI_DB (D1). Falls back to isolate memory only when CSI_ALLOW_MEMORY=1.
 * Does not invent finance balances — dashboard pulls optional live Finance snapshot.
 */

type Id = string;

interface CorporateProfile {
  id: Id;
  legalName: string;
  tradingName: string;
  vision: string;
  mission: string;
  brandPromise: string;
  positioning: string;
  philosophy: string;
  values: string[];
  businessModel: string;
  updatedAt: string;
  version: number;
}

interface Department {
  id: Id;
  code: string;
  name: string;
  headTitle?: string;
  parentId?: string;
  budgetMinor: number;
  objectives: string;
  active: boolean;
  createdAt: string;
}

interface Objective {
  id: Id;
  code: string;
  title: string;
  description: string;
  category: "strategic" | "operational" | "financial" | "product" | "people" | "customer";
  horizon: "short" | "medium" | "long";
  departmentId?: string;
  owner: string;
  startDate: string;
  targetDate: string;
  budgetMinor: number;
  kpi: string;
  targetValue: number;
  actualValue: number;
  /** Manual override only when set with reason */
  progressOverridePct?: number | null;
  progressOverrideReason?: string;
  status: "draft" | "active" | "at_risk" | "completed" | "cancelled";
  expectedOutcome: string;
  comments: string;
  createdAt: string;
  updatedAt: string;
}

interface Product {
  id: Id;
  code: string;
  name: string;
  category: string;
  description: string;
  owner: string;
  status: "concept" | "research" | "approved" | "development" | "testing" | "released" | "active" | "maintenance" | "retired";
  version: string;
  targetMarket: string;
  pricingMinor: number;
  costMinor: number;
  revenueModel: string;
  roadmap: string;
  createdAt: string;
  updatedAt: string;
}

interface PriceBookEntry {
  id: Id;
  productId?: string;
  sku: string;
  name: string;
  tier: string;
  currency: string;
  amountMinor: number;
  effectiveFrom: string;
  effectiveTo?: string;
  notes: string;
  createdAt: string;
}

interface BudgetLine {
  id: Id;
  year: number;
  category: string;
  departmentId?: string;
  productId?: string;
  plannedMinor: number;
  actualMinor: number;
  notes: string;
}

interface Risk {
  id: Id;
  title: string;
  category: string;
  description: string;
  probability: number; // 1-5
  impact: number; // 1-5
  owner: string;
  mitigation: string;
  status: "open" | "mitigating" | "closed" | "accepted";
  reviewDate: string;
  createdAt: string;
}

interface RoadmapItem {
  id: Id;
  year: number;
  title: string;
  priorities: string;
  budgetMinor: number;
  status: "planned" | "in_progress" | "done";
  symbolicNote?: string;
  createdAt: string;
}

interface AllocationPlan {
  id: Id;
  year: number;
  operationsPct: number;
  marketingPct: number;
  personnelPct: number;
  expansionPct: number;
  reservesPct: number;
  retainedPct: number;
  availableCashMinor: number;
  notes: string;
  updatedAt: string;
}

interface Store {
  profile: CorporateProfile | null;
  departments: Department[];
  objectives: Objective[];
  products: Product[];
  prices: PriceBookEntry[];
  budgets: BudgetLine[];
  risks: Risk[];
  roadmap: RoadmapItem[];
  allocation: AllocationPlan | null;
  seeded: boolean;
}

const store: Store = {
  profile: null,
  departments: [],
  objectives: [],
  products: [],
  prices: [],
  budgets: [],
  risks: [],
  roadmap: [],
  allocation: null,
  seeded: false,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function seedIfEmpty() {
  if (store.seeded) return;
  store.seeded = true;
  if (!store.profile) {
    store.profile = {
      id: uid(),
      legalName: "CINTEXA",
      tradingName: "CINTEXA",
      vision: "Build the operational intelligence backbone for modern African and global enterprises.",
      mission: "Deliver integrated software, finance intelligence and digital services that make strategy executable.",
      brandPromise: "Strategy that runs — not slides that sit.",
      positioning: "Enterprise CMS, finance intelligence and digital delivery under one operating system.",
      philosophy: "Evidence-based decisions; optional symbolic planning notes never drive financial rules.",
      values: ["Integrity", "Precision", "Customer outcomes", "Long-term stewardship"],
      businessModel: "SaaS subscriptions, custom software, managed services, commerce fees, enterprise contracts, professional services.",
      updatedAt: now(),
      version: 1,
    };
  }
  if (!store.departments.length) {
    const deps: [string, string][] = [
      ["EXEC", "Executive Office"],
      ["FIN", "Finance"],
      ["ENG", "Engineering"],
      ["SALES", "Sales"],
      ["MKT", "Marketing"],
      ["OPS", "Operations"],
      ["CS", "Customer Success"],
    ];
    for (const [code, name] of deps) {
      store.departments.push({
        id: uid(),
        code,
        name,
        budgetMinor: 0,
        objectives: "",
        active: true,
        createdAt: now(),
      });
    }
  }
  if (!store.products.length) {
    const prods: [string, string, string][] = [
      ["NEXUS", "CINTEXA Nexus", "Platform"],
      ["FIN-INT", "CINTEXA Finance Intelligence", "Finance"],
      ["CRM", "CINTEXA CRM", "Sales"],
      ["COMMERCE", "CINTEXA Commerce", "Commerce"],
      ["INTEL", "CINTEXA Intelligence", "Analytics"],
      ["AUTO", "CINTEXA Automate", "Automation"],
      ["DIGITAL", "CINTEXA Digital", "Services"],
      ["GROWTH", "CINTEXA Growth", "Services"],
      ["INFRA", "CINTEXA Infrastructure", "Technology"],
      ["SEC", "CINTEXA Security", "Technology"],
      ["PRO", "CINTEXA Professional Services", "Services"],
    ];
    for (const [code, name, category] of prods) {
      store.products.push({
        id: uid(),
        code,
        name,
        category,
        description: `${name} product record — edit to complete catalogue detail.`,
        owner: "Product",
        status: code === "NEXUS" || code === "FIN-INT" ? "active" : "concept",
        version: "1.0",
        targetMarket: "SME and enterprise",
        pricingMinor: 0,
        costMinor: 0,
        revenueModel: "Subscription / project",
        roadmap: "",
        createdAt: now(),
        updatedAt: now(),
      });
    }
  }
  if (!store.allocation) {
    store.allocation = {
      id: uid(),
      year: new Date().getFullYear(),
      operationsPct: 30,
      marketingPct: 15,
      personnelPct: 20,
      expansionPct: 15,
      reservesPct: 10,
      retainedPct: 10,
      availableCashMinor: 0,
      notes: "Default planning percentages from corporate blueprint — editable. Cash must come from Finance, not forecasts.",
      updatedAt: now(),
    };
  }

  if (!budgetMappings.length) {
    budgetMappings.push(
      { id: uid(), budgetCategory: "Operations", financeAccountCodes: ["6100", "6200", "6300"], notes: "Default expense range", createdAt: now() },
      { id: uid(), budgetCategory: "Marketing", financeAccountCodes: ["6400", "6410"], notes: "Marketing expense codes", createdAt: now() },
      { id: uid(), budgetCategory: "Personnel", financeAccountCodes: ["6500", "6510"], notes: "Payroll-related if present", createdAt: now() },
    );
  }

  if (!store.roadmap.length) {
    for (let y = 2026; y <= 2035; y++) {
      store.roadmap.push({
        id: uid(),
        year: y,
        title: `Corporate priorities ${y}`,
        priorities: "Edit annual priorities, milestones and budgets.",
        budgetMinor: 0,
        status: y === new Date().getFullYear() ? "in_progress" : "planned",
        symbolicNote: "",
        createdAt: now(),
      });
    }
  }
}

function objectiveProgress(o: Objective): number {
  if (o.progressOverridePct != null && o.progressOverrideReason) {
    return Math.max(0, Math.min(100, o.progressOverridePct));
  }
  if (o.targetValue === 0) return o.status === "completed" ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((o.actualValue / o.targetValue) * 100)));
}

function riskScore(r: Risk) {
  return r.probability * r.impact;
}

function allocationValid(a: AllocationPlan) {
  const sum =
    a.operationsPct + a.marketingPct + a.personnelPct + a.expansionPct + a.reservesPct + a.retainedPct;
  return { sum, balanced: Math.abs(sum - 100) < 0.01 };
}


const CSI_SCHEMA = `
CREATE TABLE IF NOT EXISTS csi_profile (id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, trading_name TEXT NOT NULL, vision TEXT, mission TEXT, brand_promise TEXT, positioning TEXT, philosophy TEXT, values_json TEXT, business_model TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS csi_departments (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, head_title TEXT, parent_id TEXT, budget_minor INTEGER NOT NULL DEFAULT 0, objectives TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS csi_objectives (id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, description TEXT, category TEXT, horizon TEXT, department_id TEXT, owner TEXT, start_date TEXT, target_date TEXT, budget_minor INTEGER NOT NULL DEFAULT 0, kpi TEXT, target_value REAL NOT NULL DEFAULT 0, actual_value REAL NOT NULL DEFAULT 0, progress_override_pct REAL, progress_override_reason TEXT, status TEXT NOT NULL DEFAULT 'draft', expected_outcome TEXT, comments TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS csi_products (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT, description TEXT, owner TEXT, status TEXT NOT NULL DEFAULT 'concept', version TEXT, target_market TEXT, pricing_minor INTEGER NOT NULL DEFAULT 0, cost_minor INTEGER NOT NULL DEFAULT 0, revenue_model TEXT, roadmap TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS csi_prices (id TEXT PRIMARY KEY, product_id TEXT, sku TEXT, name TEXT NOT NULL, tier TEXT, currency TEXT NOT NULL DEFAULT 'GHS', amount_minor INTEGER NOT NULL DEFAULT 0, effective_from TEXT NOT NULL, effective_to TEXT, notes TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS csi_budgets (id TEXT PRIMARY KEY, year INTEGER NOT NULL, category TEXT NOT NULL, department_id TEXT, product_id TEXT, planned_minor INTEGER NOT NULL DEFAULT 0, actual_minor INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS csi_budget_mappings (id TEXT PRIMARY KEY, budget_category TEXT NOT NULL UNIQUE, finance_account_codes TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS csi_risks (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT, description TEXT, probability INTEGER NOT NULL DEFAULT 1, impact INTEGER NOT NULL DEFAULT 1, owner TEXT, mitigation TEXT, status TEXT NOT NULL DEFAULT 'open', review_date TEXT, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS csi_roadmap (id TEXT PRIMARY KEY, year INTEGER NOT NULL UNIQUE, title TEXT, priorities TEXT, budget_minor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'planned', symbolic_note TEXT, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS csi_allocation (id TEXT PRIMARY KEY, year INTEGER NOT NULL, operations_pct REAL NOT NULL, marketing_pct REAL NOT NULL, personnel_pct REAL NOT NULL, expansion_pct REAL NOT NULL, reserves_pct REAL NOT NULL, retained_pct REAL NOT NULL, available_cash_minor INTEGER NOT NULL DEFAULT 0, notes TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS csi_audit (id TEXT PRIMARY KEY, actor_role TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, detail TEXT, created_at TEXT NOT NULL);
`;

interface BudgetMapping {
  id: string;
  budgetCategory: string;
  financeAccountCodes: string[];
  notes: string;
  createdAt: string;
}

const budgetMappings: BudgetMapping[] = [];

async function csiEnsureSchema(db: D1Database) {
  for (const stmt of CSI_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

async function csiPersistAll(db: D1Database) {
  await csiEnsureSchema(db);
  if (store.profile) {
    const p = store.profile;
    await db.prepare(
      `INSERT OR REPLACE INTO csi_profile (id, legal_name, trading_name, vision, mission, brand_promise, positioning, philosophy, values_json, business_model, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(p.id, p.legalName, p.tradingName, p.vision, p.mission, p.brandPromise, p.positioning, p.philosophy, JSON.stringify(p.values), p.businessModel, p.version, p.updatedAt)
      .run();
  }
  for (const d of store.departments) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_departments (id, code, name, head_title, parent_id, budget_minor, objectives, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(d.id, d.code, d.name, d.headTitle || null, d.parentId || null, d.budgetMinor, d.objectives, d.active ? 1 : 0, d.createdAt, now())
      .run();
  }
  for (const o of store.objectives) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_objectives (id, code, title, description, category, horizon, department_id, owner, start_date, target_date, budget_minor, kpi, target_value, actual_value, progress_override_pct, progress_override_reason, status, expected_outcome, comments, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(o.id, o.code, o.title, o.description, o.category, o.horizon, o.departmentId || null, o.owner, o.startDate, o.targetDate, o.budgetMinor, o.kpi, o.targetValue, o.actualValue, o.progressOverridePct ?? null, o.progressOverrideReason || null, o.status, o.expectedOutcome, o.comments, o.createdAt, o.updatedAt)
      .run();
  }
  for (const pr of store.products) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_products (id, code, name, category, description, owner, status, version, target_market, pricing_minor, cost_minor, revenue_model, roadmap, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(pr.id, pr.code, pr.name, pr.category, pr.description, pr.owner, pr.status, pr.version, pr.targetMarket, pr.pricingMinor, pr.costMinor, pr.revenueModel, pr.roadmap, pr.createdAt, pr.updatedAt)
      .run();
  }
  for (const e of store.prices) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_prices (id, product_id, sku, name, tier, currency, amount_minor, effective_from, effective_to, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(e.id, e.productId || null, e.sku, e.name, e.tier, e.currency, e.amountMinor, e.effectiveFrom, e.effectiveTo || null, e.notes, e.createdAt)
      .run();
  }
  for (const b of store.budgets) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_budgets (id, year, category, department_id, product_id, planned_minor, actual_minor, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(b.id, b.year, b.category, b.departmentId || null, b.productId || null, b.plannedMinor, b.actualMinor, b.notes, now(), now())
      .run();
  }
  for (const m of budgetMappings) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_budget_mappings (id, budget_category, finance_account_codes, notes, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(m.id, m.budgetCategory, m.financeAccountCodes.join(","), m.notes, m.createdAt)
      .run();
  }
  for (const r of store.risks) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_risks (id, title, category, description, probability, impact, owner, mitigation, status, review_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(r.id, r.title, r.category, r.description, r.probability, r.impact, r.owner, r.mitigation, r.status, r.reviewDate, r.createdAt, now())
      .run();
  }
  for (const r of store.roadmap) {
    await db.prepare(
      `INSERT OR REPLACE INTO csi_roadmap (id, year, title, priorities, budget_minor, status, symbolic_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(r.id, r.year, r.title, r.priorities, r.budgetMinor, r.status, r.symbolicNote || null, r.createdAt, now())
      .run();
  }
  if (store.allocation) {
    const a = store.allocation;
    await db.prepare(
      `INSERT OR REPLACE INTO csi_allocation (id, year, operations_pct, marketing_pct, personnel_pct, expansion_pct, reserves_pct, retained_pct, available_cash_minor, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(a.id, a.year, a.operationsPct, a.marketingPct, a.personnelPct, a.expansionPct, a.reservesPct, a.retainedPct, a.availableCashMinor, a.notes, a.updatedAt)
      .run();
  }
}

async function csiHydrate(db: D1Database) {
  await csiEnsureSchema(db);
  const profile = await db.prepare("SELECT * FROM csi_profile LIMIT 1").first<any>();
  if (profile) {
    store.profile = {
      id: profile.id,
      legalName: profile.legal_name,
      tradingName: profile.trading_name,
      vision: profile.vision || "",
      mission: profile.mission || "",
      brandPromise: profile.brand_promise || "",
      positioning: profile.positioning || "",
      philosophy: profile.philosophy || "",
      values: profile.values_json ? JSON.parse(profile.values_json) : [],
      businessModel: profile.business_model || "",
      updatedAt: profile.updated_at,
      version: profile.version,
    };
  }
  const { results: deps } = await db.prepare("SELECT * FROM csi_departments").all();
  if (deps?.length) {
    store.departments = deps.map((d: any) => ({
      id: d.id, code: d.code, name: d.name, headTitle: d.head_title, parentId: d.parent_id,
      budgetMinor: Number(d.budget_minor), objectives: d.objectives || "", active: !!d.active, createdAt: d.created_at,
    }));
  }
  const { results: objs } = await db.prepare("SELECT * FROM csi_objectives").all();
  if (objs?.length) {
    store.objectives = objs.map((o: any) => ({
      id: o.id, code: o.code, title: o.title, description: o.description || "", category: o.category, horizon: o.horizon,
      departmentId: o.department_id, owner: o.owner || "", startDate: o.start_date || "", targetDate: o.target_date || "",
      budgetMinor: Number(o.budget_minor), kpi: o.kpi || "", targetValue: Number(o.target_value), actualValue: Number(o.actual_value),
      progressOverridePct: o.progress_override_pct, progressOverrideReason: o.progress_override_reason,
      status: o.status, expectedOutcome: o.expected_outcome || "", comments: o.comments || "",
      createdAt: o.created_at, updatedAt: o.updated_at,
    }));
  }
  const { results: prods } = await db.prepare("SELECT * FROM csi_products").all();
  if (prods?.length) {
    store.products = prods.map((pr: any) => ({
      id: pr.id, code: pr.code, name: pr.name, category: pr.category || "", description: pr.description || "",
      owner: pr.owner || "", status: pr.status, version: pr.version || "", targetMarket: pr.target_market || "",
      pricingMinor: Number(pr.pricing_minor), costMinor: Number(pr.cost_minor), revenueModel: pr.revenue_model || "",
      roadmap: pr.roadmap || "", createdAt: pr.created_at, updatedAt: pr.updated_at,
    }));
  }
  const { results: prices } = await db.prepare("SELECT * FROM csi_prices").all();
  if (prices?.length) {
    store.prices = prices.map((e: any) => ({
      id: e.id, productId: e.product_id, sku: e.sku || "", name: e.name, tier: e.tier || "", currency: e.currency,
      amountMinor: Number(e.amount_minor), effectiveFrom: e.effective_from, effectiveTo: e.effective_to, notes: e.notes || "", createdAt: e.created_at,
    }));
  }
  const { results: buds } = await db.prepare("SELECT * FROM csi_budgets").all();
  if (buds?.length) {
    store.budgets = buds.map((b: any) => ({
      id: b.id, year: Number(b.year), category: b.category, departmentId: b.department_id, productId: b.product_id,
      plannedMinor: Number(b.planned_minor), actualMinor: Number(b.actual_minor), notes: b.notes || "",
    }));
  }
  const { results: maps } = await db.prepare("SELECT * FROM csi_budget_mappings").all();
  budgetMappings.length = 0;
  for (const m of maps || []) {
    budgetMappings.push({
      id: (m as any).id,
      budgetCategory: (m as any).budget_category,
      financeAccountCodes: String((m as any).finance_account_codes || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      notes: (m as any).notes || "",
      createdAt: (m as any).created_at,
    });
  }
  const { results: risks } = await db.prepare("SELECT * FROM csi_risks").all();
  if (risks?.length) {
    store.risks = risks.map((r: any) => ({
      id: r.id, title: r.title, category: r.category || "", description: r.description || "",
      probability: Number(r.probability), impact: Number(r.impact), owner: r.owner || "", mitigation: r.mitigation || "",
      status: r.status, reviewDate: r.review_date || "", createdAt: r.created_at,
    }));
  }
  const { results: road } = await db.prepare("SELECT * FROM csi_roadmap").all();
  if (road?.length) {
    store.roadmap = road.map((r: any) => ({
      id: r.id, year: Number(r.year), title: r.title || "", priorities: r.priorities || "", budgetMinor: Number(r.budget_minor),
      status: r.status, symbolicNote: r.symbolic_note || "", createdAt: r.created_at,
    }));
  }
  const alloc = await db.prepare("SELECT * FROM csi_allocation ORDER BY updated_at DESC LIMIT 1").first<any>();
  if (alloc) {
    store.allocation = {
      id: alloc.id, year: Number(alloc.year), operationsPct: Number(alloc.operations_pct), marketingPct: Number(alloc.marketing_pct),
      personnelPct: Number(alloc.personnel_pct), expansionPct: Number(alloc.expansion_pct), reservesPct: Number(alloc.reserves_pct),
      retainedPct: Number(alloc.retained_pct), availableCashMinor: Number(alloc.available_cash_minor), notes: alloc.notes || "", updatedAt: alloc.updated_at,
    };
  }
  store.seeded = true;
}

type CsiRole = "super_admin" | "ceo" | "cfo" | "cto" | "department_head" | "finance_manager" | "product_manager" | "sales_manager" | "viewer";

const WRITE_ROLES: CsiRole[] = ["super_admin", "ceo", "cfo", "cto", "department_head", "finance_manager", "product_manager", "sales_manager"];
const SENSITIVE_ROLES: CsiRole[] = ["super_admin", "ceo", "cfo", "finance_manager"];

function parseRole(request: Request): CsiRole {
  const h = request.headers.get("x-csi-role") || request.headers.get("x-nexus-role") || "viewer";
  const r = h.toLowerCase().replace(/\s+/g, "_") as CsiRole;
  const allowed: CsiRole[] = ["super_admin", "ceo", "cfo", "cto", "department_head", "finance_manager", "product_manager", "sales_manager", "viewer"];
  return allowed.includes(r) ? r : "viewer";
}

function canWrite(role: CsiRole) {
  return WRITE_ROLES.includes(role);
}

function canViewSensitive(role: CsiRole) {
  return SENSITIVE_ROLES.includes(role);
}

function deny(msg: string) {
  return json({ error: msg, code: "CSI_FORBIDDEN" }, 403);
}


export const onRequest = async (context: { request: Request; env: any; params: { path?: string | string[] } }) => {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" } });
  }

  const role = parseRole(request);
  const db: D1Database | undefined = (env as any).CSI_DB || (env as any).FIN_DB;
  if (db) {
    try {
      await csiHydrate(db);
    } catch (e: any) {
      console.error("CSI hydrate", e?.message);
    }
  }
  seedIfEmpty();
  const persist = async () => {
    if (db) {
      try { await csiPersistAll(db); } catch (e: any) { console.error("CSI persist", e?.message); }
    }
  };


  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");

  if (path === "health" || path === "") {
    return json({
      success: true,
      service: "CINTEXA Corporate Strategy & Intelligence",
      api: "operational",
      storage: db ? "d1" : env.CSI_ALLOW_MEMORY === "1" ? "isolate-memory-dev" : "isolate-memory",
      d1Configured: Boolean(db),
      role,
    });
  }

  if (path === "dashboard" && request.method === "GET") {
    const activeObj = store.objectives.filter((o) => o.status === "active" || o.status === "at_risk");
    const openRisks = store.risks.filter((r) => r.status === "open" || r.status === "mitigating");
    const productsActive = store.products.filter((p) => p.status === "active" || p.status === "released").length;
    const budgetPlanned = store.budgets.reduce((s, b) => s + b.plannedMinor, 0);
    const budgetActual = store.budgets.reduce((s, b) => s + b.actualMinor, 0);
    const avgProgress =
      activeObj.length === 0
        ? null
        : Math.round(activeObj.reduce((s, o) => s + objectiveProgress(o), 0) / activeObj.length);

    // Optional live Finance snapshot (never invent balances)
    let finance: any = null;
    try {
      const origin = new URL(request.url).origin;
      const fr = await fetch(`${origin}/api/finance/dashboard`, { headers: { accept: "application/json" } });
      if (fr.ok) finance = await fr.json();
    } catch {
      finance = null;
    }

    const insights: { id: string; severity: string; title: string; detail: string; source: string }[] = [];
    for (const o of activeObj) {
      const p = objectiveProgress(o);
      if (p < 40 && o.status === "active") {
        insights.push({
          id: `obj-${o.id}`,
          severity: "caution",
          title: `Objective behind pace: ${o.title}`,
          detail: `Measured progress ${p}% vs target. Owner: ${o.owner}.`,
          source: `objective:${o.code}`,
        });
      }
    }
    for (const r of openRisks) {
      if (riskScore(r) >= 15) {
        insights.push({
          id: `risk-${r.id}`,
          severity: "critical",
          title: `High residual risk: ${r.title}`,
          detail: `Score ${riskScore(r)} (P${r.probability}×I${r.impact}). Owner: ${r.owner}.`,
          source: `risk:${r.id}`,
        });
      }
    }
    if (store.allocation) {
      const v = allocationValid(store.allocation);
      if (!v.balanced) {
        insights.push({
          id: "alloc-balance",
          severity: "caution",
          title: "Resource allocation does not total 100%",
          detail: `Current sum ${v.sum}%. Adjust percentages before using as a plan.`,
          source: "allocation",
        });
      }
    }
    if (finance && typeof finance.cash === "number" && finance.cash <= 0 && (finance.accountsReceivable || 0) > 0) {
      insights.push({
        id: "fin-cash-ar",
        severity: "elevated",
        title: "Finance: low cash relative to receivables",
        detail: "Live Finance dashboard shows limited cash while AR is positive — prioritise collections.",
        source: "finance:/dashboard",
      });
    }

    return json({
      departments: store.departments.filter((d) => d.active).length,
      objectivesActive: activeObj.length,
      objectivesAvgProgress: avgProgress,
      productsActive,
      productsTotal: store.products.length,
      openRisks: openRisks.length,
      budgetPlannedMinor: budgetPlanned,
      budgetActualMinor: budgetActual,
      budgetUtilisationPct: budgetPlanned > 0 ? Math.round((budgetActual / budgetPlanned) * 100) : null,
      allocation: store.allocation,
      financeLive: finance
        ? {
            currency: finance.currency || "GHS",
            revenue: finance.grossRevenue ?? finance.revenue ?? null,
            netProfit: finance.netProfit ?? null,
            cash: finance.cash ?? null,
            accountsReceivable: finance.accountsReceivable ?? null,
            storage: finance.storage,
          }
        : null,
      insights,
      profile: store.profile
        ? { legalName: store.profile.legalName, vision: store.profile.vision, version: store.profile.version }
        : null,
    });
  }

  // Profile
  if (path === "profile" && request.method === "GET") {
    return json({ profile: store.profile });
  }
  if (path === "profile" && request.method === "PUT") {
    const body = await readJson(request);
    const prev = store.profile;
    store.profile = {
      id: prev?.id || uid(),
      legalName: String(body.legalName || prev?.legalName || "CINTEXA").slice(0, 200),
      tradingName: String(body.tradingName || prev?.tradingName || "CINTEXA").slice(0, 200),
      vision: String(body.vision || prev?.vision || "").slice(0, 2000),
      mission: String(body.mission || prev?.mission || "").slice(0, 2000),
      brandPromise: String(body.brandPromise || prev?.brandPromise || "").slice(0, 500),
      positioning: String(body.positioning || prev?.positioning || "").slice(0, 1000),
      philosophy: String(body.philosophy || prev?.philosophy || "").slice(0, 1000),
      values: Array.isArray(body.values) ? body.values.map(String).slice(0, 20) : prev?.values || [],
      businessModel: String(body.businessModel || prev?.businessModel || "").slice(0, 2000),
      updatedAt: now(),
      version: (prev?.version || 0) + 1,
    };
    await persist();
    return json({ profile: store.profile });
  }

  // Departments
  if (path === "departments" && request.method === "GET") {
    return json({ items: store.departments });
  }
  if (path === "departments" && request.method === "POST") {
    const body = await readJson(request);
    const d: Department = {
      id: uid(),
      code: String(body.code || "").slice(0, 20).toUpperCase() || "DEPT",
      name: String(body.name || "Department").slice(0, 120),
      headTitle: body.headTitle ? String(body.headTitle).slice(0, 120) : undefined,
      parentId: body.parentId ? String(body.parentId) : undefined,
      budgetMinor: Math.round(Number(body.budgetMinor) || 0),
      objectives: String(body.objectives || "").slice(0, 2000),
      active: body.active !== false,
      createdAt: now(),
    };
    store.departments.push(d);
    await persist();
    return json({ department: d }, 201);
  }
  if (path.startsWith("departments/") && request.method === "PUT") {
    const id = path.split("/")[1];
    const d = store.departments.find((x) => x.id === id);
    if (!d) return json({ error: "Not found" }, 404);
    const body = await readJson(request);
    if (body.name != null) d.name = String(body.name).slice(0, 120);
    if (body.code != null) d.code = String(body.code).slice(0, 20).toUpperCase();
    if (body.budgetMinor != null) d.budgetMinor = Math.round(Number(body.budgetMinor) || 0);
    if (body.objectives != null) d.objectives = String(body.objectives).slice(0, 2000);
    if (body.active != null) d.active = Boolean(body.active);
    if (body.headTitle != null) d.headTitle = String(body.headTitle).slice(0, 120);
    return json({ department: d });
  }

  // Objectives
  if (path === "objectives" && request.method === "GET") {
    return json({
      items: store.objectives.map((o) => ({ ...o, progressPct: objectiveProgress(o) })),
    });
  }
  if (path === "objectives" && request.method === "POST") {
    if (!canWrite(role)) return deny("Write role required");
    const body = await readJson(request);
    const o: Objective = {
      id: uid(),
      code: String(body.code || `OBJ-${store.objectives.length + 1}`).slice(0, 40),
      title: String(body.title || "Objective").slice(0, 200),
      description: String(body.description || "").slice(0, 4000),
      category: (body.category || "strategic") as Objective["category"],
      horizon: (body.horizon || "medium") as Objective["horizon"],
      departmentId: body.departmentId ? String(body.departmentId) : undefined,
      owner: String(body.owner || "").slice(0, 120),
      startDate: String(body.startDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      targetDate: String(body.targetDate || "").slice(0, 10),
      budgetMinor: Math.round(Number(body.budgetMinor) || 0),
      kpi: String(body.kpi || "").slice(0, 200),
      targetValue: Number(body.targetValue) || 0,
      actualValue: Number(body.actualValue) || 0,
      progressOverridePct: null,
      progressOverrideReason: undefined,
      status: (body.status || "draft") as Objective["status"],
      expectedOutcome: String(body.expectedOutcome || "").slice(0, 2000),
      comments: String(body.comments || "").slice(0, 2000),
      createdAt: now(),
      updatedAt: now(),
    };
    store.objectives.push(o);
    await persist();
    return json({ objective: { ...o, progressPct: objectiveProgress(o) } }, 201);
  }
  if (path.startsWith("objectives/") && request.method === "PUT") {
    const id = path.split("/")[1];
    const o = store.objectives.find((x) => x.id === id);
    if (!o) return json({ error: "Not found" }, 404);
    const body = await readJson(request);
    for (const k of [
      "title",
      "description",
      "category",
      "horizon",
      "owner",
      "startDate",
      "targetDate",
      "kpi",
      "status",
      "expectedOutcome",
      "comments",
      "departmentId",
    ] as const) {
      if (body[k] != null) (o as any)[k] = body[k];
    }
    if (body.budgetMinor != null) o.budgetMinor = Math.round(Number(body.budgetMinor) || 0);
    if (body.targetValue != null) o.targetValue = Number(body.targetValue) || 0;
    if (body.actualValue != null) o.actualValue = Number(body.actualValue) || 0;
    if (body.progressOverridePct != null) {
      if (!body.progressOverrideReason) {
        return json({ error: "progressOverrideReason required when setting progressOverridePct" }, 400);
      }
      o.progressOverridePct = Number(body.progressOverridePct);
      o.progressOverrideReason = String(body.progressOverrideReason).slice(0, 500);
    }
    if (body.clearProgressOverride) {
      o.progressOverridePct = null;
      o.progressOverrideReason = undefined;
    }
    o.updatedAt = now();
    return json({ objective: { ...o, progressPct: objectiveProgress(o) } });
  }

  // Products
  if (path === "products" && request.method === "GET") {
    return json({ items: store.products });
  }
  if (path === "products" && request.method === "POST") {
    const body = await readJson(request);
    const p: Product = {
      id: uid(),
      code: String(body.code || "PROD").slice(0, 40).toUpperCase(),
      name: String(body.name || "Product").slice(0, 200),
      category: String(body.category || "General").slice(0, 80),
      description: String(body.description || "").slice(0, 4000),
      owner: String(body.owner || "").slice(0, 120),
      status: (body.status || "concept") as Product["status"],
      version: String(body.version || "0.1").slice(0, 40),
      targetMarket: String(body.targetMarket || "").slice(0, 200),
      pricingMinor: Math.round(Number(body.pricingMinor) || 0),
      costMinor: Math.round(Number(body.costMinor) || 0),
      revenueModel: String(body.revenueModel || "").slice(0, 200),
      roadmap: String(body.roadmap || "").slice(0, 4000),
      createdAt: now(),
      updatedAt: now(),
    };
    store.products.push(p);
    await persist();
    return json({ product: p }, 201);
  }
  if (path.startsWith("products/") && request.method === "PUT") {
    const id = path.split("/")[1];
    const p = store.products.find((x) => x.id === id);
    if (!p) return json({ error: "Not found" }, 404);
    const body = await readJson(request);
    for (const k of ["name", "category", "description", "owner", "status", "version", "targetMarket", "revenueModel", "roadmap", "code"] as const) {
      if (body[k] != null) (p as any)[k] = body[k];
    }
    if (body.pricingMinor != null) p.pricingMinor = Math.round(Number(body.pricingMinor) || 0);
    if (body.costMinor != null) p.costMinor = Math.round(Number(body.costMinor) || 0);
    p.updatedAt = now();
    return json({ product: p });
  }

  // Prices
  if (path === "prices" && request.method === "GET") {
    return json({ items: store.prices });
  }
  if (path === "prices" && request.method === "POST") {
    const body = await readJson(request);
    const e: PriceBookEntry = {
      id: uid(),
      productId: body.productId ? String(body.productId) : undefined,
      sku: String(body.sku || "").slice(0, 60),
      name: String(body.name || "Price").slice(0, 200),
      tier: String(body.tier || "standard").slice(0, 60),
      currency: String(body.currency || "GHS").slice(0, 8),
      amountMinor: Math.round(Number(body.amountMinor) || 0),
      effectiveFrom: String(body.effectiveFrom || new Date().toISOString().slice(0, 10)).slice(0, 10),
      effectiveTo: body.effectiveTo ? String(body.effectiveTo).slice(0, 10) : undefined,
      notes: String(body.notes || "").slice(0, 1000),
      createdAt: now(),
    };
    store.prices.push(e);
    return json({ price: e }, 201);
  }

  // Budgets
  if (path === "budgets" && request.method === "GET") {
    return json({ items: store.budgets });
  }
  if (path === "budgets" && request.method === "POST") {
    const body = await readJson(request);
    const b: BudgetLine = {
      id: uid(),
      year: Number(body.year) || new Date().getFullYear(),
      category: String(body.category || "General").slice(0, 80),
      departmentId: body.departmentId ? String(body.departmentId) : undefined,
      productId: body.productId ? String(body.productId) : undefined,
      plannedMinor: Math.round(Number(body.plannedMinor) || 0),
      actualMinor: Math.round(Number(body.actualMinor) || 0),
      notes: String(body.notes || "").slice(0, 1000),
    };
    store.budgets.push(b);
    await persist();
    return json({ budget: b }, 201);
  }
  if (path.startsWith("budgets/") && request.method === "PUT") {
    const id = path.split("/")[1];
    const b = store.budgets.find((x) => x.id === id);
    if (!b) return json({ error: "Not found" }, 404);
    const body = await readJson(request);
    if (body.plannedMinor != null) b.plannedMinor = Math.round(Number(body.plannedMinor) || 0);
    if (body.actualMinor != null) b.actualMinor = Math.round(Number(body.actualMinor) || 0);
    if (body.notes != null) b.notes = String(body.notes).slice(0, 1000);
    if (body.category != null) b.category = String(body.category).slice(0, 80);
    return json({ budget: b });
  }

  // Risks
  if (path === "risks" && request.method === "GET") {
    return json({
      items: store.risks.map((r) => ({ ...r, score: riskScore(r) })),
    });
  }
  if (path === "risks" && request.method === "POST") {
    const body = await readJson(request);
    const r: Risk = {
      id: uid(),
      title: String(body.title || "Risk").slice(0, 200),
      category: String(body.category || "operational").slice(0, 60),
      description: String(body.description || "").slice(0, 4000),
      probability: Math.min(5, Math.max(1, Number(body.probability) || 1)),
      impact: Math.min(5, Math.max(1, Number(body.impact) || 1)),
      owner: String(body.owner || "").slice(0, 120),
      mitigation: String(body.mitigation || "").slice(0, 2000),
      status: (body.status || "open") as Risk["status"],
      reviewDate: String(body.reviewDate || "").slice(0, 10),
      createdAt: now(),
    };
    store.risks.push(r);
    return json({ risk: { ...r, score: riskScore(r) } }, 201);
  }
  if (path.startsWith("risks/") && request.method === "PUT") {
    const id = path.split("/")[1];
    const r = store.risks.find((x) => x.id === id);
    if (!r) return json({ error: "Not found" }, 404);
    const body = await readJson(request);
    for (const k of ["title", "category", "description", "owner", "mitigation", "status", "reviewDate"] as const) {
      if (body[k] != null) (r as any)[k] = body[k];
    }
    if (body.probability != null) r.probability = Math.min(5, Math.max(1, Number(body.probability) || 1));
    if (body.impact != null) r.impact = Math.min(5, Math.max(1, Number(body.impact) || 1));
    return json({ risk: { ...r, score: riskScore(r) } });
  }

  // Roadmap
  if (path === "roadmap" && request.method === "GET") {
    return json({ items: store.roadmap });
  }
  if (path.startsWith("roadmap/") && request.method === "PUT") {
    const id = path.split("/")[1];
    const r = store.roadmap.find((x) => x.id === id);
    if (!r) return json({ error: "Not found" }, 404);
    const body = await readJson(request);
    if (body.title != null) r.title = String(body.title).slice(0, 200);
    if (body.priorities != null) r.priorities = String(body.priorities).slice(0, 4000);
    if (body.budgetMinor != null) r.budgetMinor = Math.round(Number(body.budgetMinor) || 0);
    if (body.status != null) r.status = body.status;
    if (body.symbolicNote != null) r.symbolicNote = String(body.symbolicNote).slice(0, 500);
    return json({ item: r });
  }

  // Allocation
  if (path === "allocation" && request.method === "GET") {
    return json({
      allocation: store.allocation,
      validation: store.allocation ? allocationValid(store.allocation) : null,
    });
  }
  if (path === "allocation" && request.method === "PUT") {
    const body = await readJson(request);
    const prev = store.allocation;
    const a: AllocationPlan = {
      id: prev?.id || uid(),
      year: Number(body.year) || prev?.year || new Date().getFullYear(),
      operationsPct: Number(body.operationsPct ?? prev?.operationsPct ?? 30),
      marketingPct: Number(body.marketingPct ?? prev?.marketingPct ?? 15),
      personnelPct: Number(body.personnelPct ?? prev?.personnelPct ?? 20),
      expansionPct: Number(body.expansionPct ?? prev?.expansionPct ?? 15),
      reservesPct: Number(body.reservesPct ?? prev?.reservesPct ?? 10),
      retainedPct: Number(body.retainedPct ?? prev?.retainedPct ?? 10),
      availableCashMinor: Math.round(Number(body.availableCashMinor ?? prev?.availableCashMinor ?? 0)),
      notes: String(body.notes ?? prev?.notes ?? "").slice(0, 2000),
      updatedAt: now(),
    };
    store.allocation = a;
    await persist();
    return json({ allocation: a, validation: allocationValid(a) });
  }

  // Simple forecast from assumptions (not ledger)
  if (path === "forecast" && request.method === "POST") {
    const body = await readJson(request);
    const years = Math.min(10, Math.max(1, Number(body.years) || 5));
    const startRevenue = Math.round(Number(body.startRevenueMinor) || 0);
    const growthPct = Number(body.revenueGrowthPct) || 10;
    const expenseRatio = Number(body.expenseRatioPct) || 70;
    const scenario = String(body.scenario || "base");
    const mult = scenario === "conservative" ? 0.7 : scenario === "growth" ? 1.3 : 1;
    const series = [];
    let rev = startRevenue;
    for (let i = 0; i < years; i++) {
      if (i > 0) rev = Math.round(rev * (1 + (growthPct * mult) / 100));
      const exp = Math.round((rev * expenseRatio) / 100);
      series.push({
        year: new Date().getFullYear() + i,
        revenueMinor: rev,
        expenseMinor: exp,
        profitMinor: rev - exp,
        scenario,
        kind: "projection",
      });
    }
    return json({
      series,
      note: "Projections only — not guaranteed results. Does not alter Finance ledger balances.",
      assumptions: { startRevenue, growthPct, expenseRatio, scenario, multiplier: mult },
    });
  }


  // Permissions
  if (path === "me" && request.method === "GET") {
    return json({
      role,
      canWrite: canWrite(role),
      canViewSensitiveFinance: canViewSensitive(role),
      permissions: {
        view: true,
        create: canWrite(role),
        edit: canWrite(role),
        delete: role === "super_admin" || role === "ceo",
        manageBudgets: canViewSensitive(role) || role === "department_head",
        manageMappings: canViewSensitive(role),
        exportPdf: true,
        viewSalesRollups: canWrite(role) || role === "viewer",
      },
    });
  }

  // Budget ↔ Finance expense account mappings
  if (path === "budget-mappings" && request.method === "GET") {
    return json({ items: budgetMappings });
  }
  if (path === "budget-mappings" && request.method === "POST") {
    if (!canWrite(role) || !canViewSensitive(role)) return deny("Finance mapping requires CFO/finance_manager/super_admin");
    const body = await readJson(request);
    const cat = String(body.budgetCategory || "").trim();
    if (!cat) return json({ error: "budgetCategory required" }, 400);
    const codes = Array.isArray(body.financeAccountCodes)
      ? body.financeAccountCodes.map(String)
      : String(body.financeAccountCodes || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    let m = budgetMappings.find((x) => x.budgetCategory === cat);
    if (m) {
      m.financeAccountCodes = codes;
      m.notes = String(body.notes || m.notes || "");
    } else {
      m = { id: uid(), budgetCategory: cat, financeAccountCodes: codes, notes: String(body.notes || ""), createdAt: now() };
      budgetMappings.push(m);
    }
    await persist();
    return json({ mapping: m }, 201);
  }

  // Budget vs actual using Finance posted expense journals
  if (path === "budget-vs-actual" && request.method === "GET") {
    const origin = new URL(request.url).origin;
    let accounts: any[] = [];
    let journals: any[] = [];
    try {
      const [aRes, jRes] = await Promise.all([
        fetch(`${origin}/api/finance/accounts`),
        fetch(`${origin}/api/finance/journals`),
      ]);
      if (aRes.ok) {
        const a = await aRes.json();
        accounts = a.items || a.accounts || [];
      }
      if (jRes.ok) {
        const j = await jRes.json();
        journals = j.items || j.journals || [];
      }
    } catch { /* finance offline */ }

    const expenseByCode: Record<string, number> = {};
    for (const j of journals) {
      if (j.status && j.status !== "posted") continue;
      for (const l of j.lines || []) {
        const code = l.accountCode;
        const acc = accounts.find((x: any) => x.code === code);
        if (acc && acc.type === "expense") {
          expenseByCode[code] = (expenseByCode[code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
        } else if (!accounts.length) {
          // fallback: treat known expense range 5xxx-6xxx
          if (/^[56]/.test(String(code))) {
            expenseByCode[code] = (expenseByCode[code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
          }
        }
      }
    }

    const rows = store.budgets.map((b) => {
      const map = budgetMappings.find((m) => m.budgetCategory.toLowerCase() === b.category.toLowerCase());
      let financeActual = 0;
      if (map) {
        for (const code of map.financeAccountCodes) financeActual += expenseByCode[code] || 0;
      } else {
        // unmapped: do not invent — actual stays CSI-stored actual_minor
        financeActual = b.actualMinor;
      }
      const planned = b.plannedMinor;
      const actual = map ? financeActual : b.actualMinor;
      const variance = planned - actual;
      const utilisationPct = planned > 0 ? Math.round((actual / planned) * 100) : null;
      return {
        budgetId: b.id,
        year: b.year,
        category: b.category,
        plannedMinor: planned,
        actualMinor: actual,
        varianceMinor: variance,
        utilisationPct,
        remainingMinor: variance,
        source: map ? "finance_posted_expenses" : "csi_budget_actual_field",
        mappedAccounts: map?.financeAccountCodes || [],
      };
    });

    // Refresh CSI actuals when mapped
    for (const r of rows) {
      if (r.source === "finance_posted_expenses") {
        const b = store.budgets.find((x) => x.id === r.budgetId);
        if (b) b.actualMinor = r.actualMinor;
      }
    }
    await persist();

    const totalPlanned = rows.reduce((s, r) => s + r.plannedMinor, 0);
    const totalActual = rows.reduce((s, r) => s + r.actualMinor, 0);
    return json({
      rows,
      totals: {
        plannedMinor: totalPlanned,
        actualMinor: totalActual,
        varianceMinor: totalPlanned - totalActual,
        utilisationPct: totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : null,
      },
      note: "Actuals from posted Finance expense journals when budget category is mapped; otherwise CSI actual_minor only.",
    });
  }

  // Product performance from Finance invoices (sales order bridge when invoices exist)
  if (path === "product-performance" && request.method === "GET") {
    const origin = new URL(request.url).origin;
    let invoices: any[] = [];
    try {
      const ir = await fetch(`${origin}/api/finance/invoices`);
      if (ir.ok) {
        const data = await ir.json();
        invoices = data.items || [];
      }
    } catch { /* offline */ }

    const openInvoices = invoices.filter((i) => i.status !== "void" && i.status !== "cancelled");
    const byProduct = store.products.map((p) => {
      const matched = openInvoices.filter((inv) => {
        const blob = `${inv.customerName || ""} ${inv.number || ""}`.toLowerCase();
        return blob.includes(p.code.toLowerCase()) || blob.includes(p.name.toLowerCase().slice(0, 12));
      });
      // Prefer explicit sourceId product linkage if present
      const linked = openInvoices.filter((inv) => inv.sourceModule === "sales" && String(inv.sourceId || "").includes(p.id));
      const set = linked.length ? linked : matched;
      const gross = set.reduce((s: number, inv: any) => s + (Number(inv.amountMinor) || 0), 0);
      const paid = set.reduce((s: number, inv: any) => s + (Number(inv.amountPaidMinor) || 0), 0);
      const cost = p.costMinor > 0 ? Math.round((p.costMinor / Math.max(p.pricingMinor, 1)) * gross) : null;
      const profit = cost != null ? gross - cost : null;
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        category: p.category,
        status: p.status,
        orderCount: set.length,
        grossSalesMinor: gross,
        collectedMinor: paid,
        outstandingMinor: gross - paid,
        costMinor: cost,
        grossProfitMinor: profit,
        grossMarginPct: profit != null && gross > 0 ? Math.round((profit / gross) * 1000) / 10 : null,
        costDataAvailable: cost != null,
        matchMode: linked.length ? "source_link" : matched.length ? "name_heuristic" : "none",
      };
    });

    const ranked = [...byProduct].sort((a, b) => b.grossSalesMinor - a.grossSalesMinor);
    return json({
      items: byProduct,
      top: ranked.slice(0, 5),
      underperforming: ranked.filter((x) => x.orderCount === 0 && (x.status === "active" || x.status === "released")),
      totals: {
        grossSalesMinor: byProduct.reduce((s, x) => s + x.grossSalesMinor, 0),
        collectedMinor: byProduct.reduce((s, x) => s + x.collectedMinor, 0),
        outstandingMinor: byProduct.reduce((s, x) => s + x.outstandingMinor, 0),
      },
      note: "Rollups from Finance invoices (posted AR). Name match is heuristic when sales sourceId is absent. Cost/profit only when product cost_minor is set.",
    });
  }

  return json({ error: "Not found", path }, 404);
};
