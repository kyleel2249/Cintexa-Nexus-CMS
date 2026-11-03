/**
 * CINTEXA Corporate Strategy & Intelligence API (/api/csi/*)
 * Zero third-party API keys. Persist via CSI_DB (D1) when bound; otherwise isolate memory (dev only).
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

export const onRequest = async (context: { request: Request; env: any; params: { path?: string | string[] } }) => {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" } });
  }

  seedIfEmpty();

  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");

  if (path === "health" || path === "") {
    return json({
      success: true,
      service: "CINTEXA Corporate Strategy & Intelligence",
      api: "operational",
      storage: env.CSI_DB ? "d1" : env.CSI_ALLOW_MEMORY === "1" ? "isolate-memory-dev" : "isolate-memory",
      d1Configured: Boolean(env.CSI_DB),
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

  return json({ error: "Not found", path }, 404);
};
