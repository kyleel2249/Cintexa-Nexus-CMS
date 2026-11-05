/**
 * Extended marketing entities (Strategy, Brand, Personas, SWOT, OKRs, Funnels, Settings).
 * Same localStorage key as local-store for one unified bag. No network.
 */
import { marketingEmit, MarketingEvents } from "./memory";

const KEY = "cintexa-marketing-v1";

export type Strategy = {
  id: number;
  name: string;
  status: string;
  vision?: string;
  mission?: string;
  positioning?: string;
  value_proposition?: string;
  differentiation?: string;
  channels: string[];
  persona_ids: number[];
  objective_ids: number[];
  campaign_ids: number[];
  notes?: string;
  owner?: string;
  priority: string;
  review_date?: string | null;
  created_at: string;
  updated_at: string;
};

export type Persona = {
  id: number;
  name: string;
  category: string;
  industry?: string;
  business_type?: string;
  business_size?: string;
  role?: string;
  objectives: string[];
  pain_points: string[];
  motivations: string[];
  objections: string[];
  preferred_channels: string[];
  relevant_services: string[];
  recommended_message?: string;
  conversion_offer?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type SwotItem = {
  id: number;
  quadrant: "strength" | "weakness" | "opportunity" | "threat";
  title: string;
  description?: string;
  priority: string;
  evidence?: string;
  assumption: boolean;
  recommended_action?: string;
  linked_objective_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type KeyResult = {
  id: string;
  name: string;
  baseline: number;
  target: number;
  current: number;
  unit: string;
  deadline?: string | null;
  status: string;
};

export type Objective = {
  id: number;
  name: string;
  description?: string;
  horizon: "annual" | "quarterly" | "monthly" | "campaign";
  status: string;
  key_results: KeyResult[];
  campaign_ids: number[];
  persona_ids: number[];
  owner?: string;
  deadline?: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandProfile = {
  id: number;
  name: string;
  description?: string;
  mission?: string;
  vision?: string;
  values: string[];
  positioning?: string;
  personality: string[];
  value_proposition?: string;
  promise?: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  bg_color: string;
  typography?: string;
  tone: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type BrandClaim = {
  id: number;
  brand_id: number;
  text: string;
  category: string;
  status: "approved" | "restricted" | "unverified" | "prohibited";
  evidence?: string;
  created_at: string;
  updated_at: string;
};

export type FunnelStage = {
  id: string;
  name: string;
  target_rate?: number | null;
  actual_count?: number;
};

export type Funnel = {
  id: number;
  name: string;
  campaign_id?: number | null;
  page_path?: string | null;
  form_ref?: string | null;
  stages: FunnelStage[];
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type MarketingSettings = {
  business_name: string;
  default_brand_id?: number | null;
  currency: string;
  reporting_period: string;
  channels: string[];
};

type Bag = {
  strategies?: Strategy[];
  personas?: Persona[];
  swot?: SwotItem[];
  objectives?: Objective[];
  brands?: BrandProfile[];
  claims?: BrandClaim[];
  funnels?: Funnel[];
  settings?: MarketingSettings;
  seq?: Record<string, number>;
  [k: string]: unknown;
};

function load(): Bag {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Bag;
  } catch {
    return {};
  }
}

function save(patch: Partial<Bag>) {
  const cur = load();
  const next = { ...cur, ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  marketingEmit(MarketingEvents.CHANGED);
}

function seq(key: string): number {
  const b = load();
  const s = { ...(b.seq || {}) };
  s[key] = (s[key] || 1);
  const id = s[key]++;
  save({ seq: s });
  return id;
}

function now() {
  return new Date().toISOString();
}

// ── Seed CINTEXA defaults once ──
export function ensureMarketingSeed() {
  const b = load();
  if (b.brands && b.brands.length > 0) return;

  const t = now();
  const brandId = 1;
  const brands: BrandProfile[] = [{
    id: brandId,
    name: "CINTEXA",
    description: "Technology that helps businesses understand, improve and grow.",
    mission: "Help businesses assess needs, apply technology, and improve and grow.",
    vision: "Connected business systems that drive measurable improvement.",
    values: ["Clarity", "Practical technology", "Measurable growth", "Integrity"],
    positioning: "Technology partner for business transformation and growth.",
    personality: ["Professional", "Innovative", "Trustworthy", "Educational"],
    value_proposition: "Assess → Apply technology → Improve and grow.",
    promise: "Connected marketing, sales and digital systems without unnecessary complexity.",
    primary_color: "#0F766E",
    secondary_color: "#134E4A",
    accent_color: "#2DD4BF",
    bg_color: "#F0FDFA",
    typography: "Inter, system-ui, sans-serif",
    tone: ["Professional", "Authoritative", "Approachable", "Educational"],
    is_default: true,
    created_at: t,
    updated_at: t,
  }];

  const claims: BrandClaim[] = [
    { id: 1, brand_id: brandId, text: "Technology that helps businesses understand, improve and grow.", category: "tagline", status: "approved", evidence: "cintexa.com", created_at: t, updated_at: t },
    { id: 2, brand_id: brandId, text: "Assess. Apply technology. Improve and grow.", category: "framework", status: "approved", evidence: "cintexa.com", created_at: t, updated_at: t },
    { id: 3, brand_id: brandId, text: "Connected marketing, sales and digital systems.", category: "positioning", status: "approved", created_at: t, updated_at: t },
  ];

  const personas: Persona[] = [
    { id: 1, name: "SME Owner", category: "Business owner", industry: "Multi-sector", business_size: "1–50", role: "Owner", objectives: ["Grow revenue", "Improve operations"], pain_points: ["Limited tech capacity", "Fragmented tools"], motivations: ["Simple systems", "Clear ROI"], objections: ["Cost", "Complexity"], preferred_channels: ["Website", "WhatsApp", "Referral"], relevant_services: ["Website", "Digital marketing", "Automation"], recommended_message: "Practical technology that fits how you already run the business.", conversion_offer: "Discovery consultation", notes: "Template — edit freely.", created_at: t, updated_at: t },
    { id: 2, name: "Startup Founder", category: "Founder", industry: "Tech / services", business_size: "1–20", role: "Founder", objectives: ["Acquire customers", "Ship faster"], pain_points: ["No CRM discipline", "Brand inconsistency"], motivations: ["Speed", "Credibility"], objections: ["Budget", "Time"], preferred_channels: ["Social", "Email", "Organic search"], relevant_services: ["Marketing technology", "Sales technology", "Custom software"], recommended_message: "Build connected acquisition and sales systems from day one.", conversion_offer: "Growth systems review", notes: "Template — edit freely.", created_at: t, updated_at: t },
    { id: 3, name: "Marketing Manager", category: "Marketing", industry: "Professional services", business_size: "20–200", role: "Marketing manager", objectives: ["Lead quality", "Campaign ROI"], pain_points: ["Disconnected tools", "Weak reporting"], motivations: ["Attribution", "Brand control"], objections: ["Integration risk"], preferred_channels: ["Email", "Social", "SEO"], relevant_services: ["Digital marketing", "SEO", "Marketing technology"], recommended_message: "One marketing workspace connected to sales and content.", conversion_offer: "Marketing systems audit", notes: "Template — edit freely.", created_at: t, updated_at: t },
    { id: 4, name: "E-commerce Operator", category: "Retail", industry: "E-commerce", business_size: "5–100", role: "Operations / owner", objectives: ["Conversion rate", "Retention"], pain_points: ["Checkout friction", "Ads without CRM"], motivations: ["Sales lift", "Automation"], objections: ["Platform lock-in"], preferred_channels: ["Paid ads", "Email", "Social"], relevant_services: ["E-commerce", "Ads Boost", "Automation"], recommended_message: "Connect storefront, ads and follow-up into one growth loop.", conversion_offer: "Store growth assessment", notes: "Template — edit freely.", created_at: t, updated_at: t },
  ];

  const strategies: Strategy[] = [{
    id: 1,
    name: "CINTEXA growth — connected business systems",
    status: "ACTIVE",
    vision: "Be the practical technology partner for businesses that want measurable improvement.",
    mission: "Help organisations assess needs, apply the right technology, and grow.",
    positioning: "Technology-driven business transformation with connected marketing and sales.",
    value_proposition: "Assess → Apply technology → Improve and grow.",
    differentiation: "Unified marketing–sales–digital systems rather than isolated tools.",
    channels: ["Website", "Organic search", "Social media", "Referral", "WhatsApp"],
    persona_ids: [1, 2, 3, 4],
    objective_ids: [],
    campaign_ids: [],
    notes: "Seed strategy based on cintexa.com positioning. Edit and approve.",
    owner: "Marketing",
    priority: "HIGH",
    review_date: null,
    created_at: t,
    updated_at: t,
  }];

  const objectives: Objective[] = [{
    id: 1,
    name: "Strengthen inbound lead quality",
    description: "Improve qualified enquiries from website and campaigns.",
    horizon: "quarterly",
    status: "ACTIVE",
    key_results: [
      { id: "kr1", name: "Qualified marketing leads", baseline: 0, target: 40, current: 0, unit: "leads", deadline: null, status: "on_track" },
      { id: "kr2", name: "Active campaigns", baseline: 0, target: 3, current: 0, unit: "campaigns", deadline: null, status: "on_track" },
    ],
    campaign_ids: [],
    persona_ids: [1, 3],
    owner: "Marketing",
    deadline: null,
    created extr_at: t,
    updated_at: t,
  } as any];

  // fix typo field
  objectives[0].created_at = t;

  const swot: SwotItem[] = [
    { id: 1, quadrant: "strength", title: "Connected product vision", description: "Marketing, sales and digital systems under one Nexus.", priority: "HIGH", assumption: false, evidence: "Platform positioning", created_at: t, updated_at: t },
    { id: 2, quadrant: "strength", title: "Clear growth framework", description: "Assess → Apply → Improve.", priority: "MEDIUM", assumption: false, evidence: "cintexa.com", created_at: t, updated_at: t },
    { id: 3, quadrant: "weakness", title: "Brand assets incomplete", description: "Need approved claim library and visual kit fully documented.", priority: "MEDIUM", assumption: true, recommended_action: "Complete Brand Management profiles", created_at: t, updated_at: t },
    { id: 4, quadrant: "opportunity", title: "SME digital transformation demand", description: "Growing need for practical, connected systems.", priority: "HIGH", assumption: true, recommended_action: "Target SME and founder personas", created_at: t, updated_at: t },
    { id: 5, quadrant: "threat", title: "Tool fragmentation alternatives", description: "Prospects may stitch many point tools.", priority: "MEDIUM", assumption: true, recommended_action: "Emphasise unified memory and workflow", created_at: t, updated_at: t },
  ];

  const funnels: Funnel[] = [{
    id: 1,
    name: "Website enquiry funnel",
    campaign_id: null,
    page_path: "/",
    form_ref: null,
    stages: [
      { id: "s1", name: "Visitor", actual_count: 0 },
      { id: "s2", name: "Landing page", actual_count: 0 },
      { id: "s3", name: "Call to action", actual_count: 0 },
      { id: "s4", name: "Form submission", actual_count: 0 },
      { id: "s5", name: "Qualified lead", actual_count: 0 },
      { id: "s6", name: "Sales opportunity", actual_count: 0 },
      { id: "s7", name: "Customer", actual_count: 0 },
    ],
    notes: "Reference funnel — link to real Nexus pages and forms.",
    created_at: t,
    updated_at: t,
  }];

  const settings: MarketingSettings = {
    business_name: "CINTEXA",
    default_brand_id: brandId,
    currency: "GHS",
    reporting_period: "monthly",
    channels: ["Website", "Organic search", "Social media", "Email", "Paid advertising", "WhatsApp", "Referral", "Direct enquiries", "Events", "Other"],
  };

  save({
    brands, claims, personas, strategies, objectives, swot, funnels, settings,
    seq: { brand: 2, claim: 4, strategy: 2, objective: 2, swot: 6, funnel: 2, claim: 4 },
  });
}

// ── Strategies ──
export function listStrategies(): Strategy[] {
  ensureMarketingSeed();
  return (load().strategies || []).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function getStrategy(id: number) {
  return listStrategies().find((s) => s.id === id) || null;
}
export function createStrategy(input: Partial<Strategy> & { name: string }): Strategy {
  ensureMarketingSeed();
  const b = load();
  const id = seq("strategy");
  const t = now();
  const row: Strategy = {
    id, name: input.name.trim(), status: input.status || "DRAFT",
    vision: input.vision, mission: input.mission, positioning: input.positioning,
    value_proposition: input.value_proposition, differentiation: input.differentiation,
    channels: input.channels || [], persona_ids: input.persona_ids || [],
    objective_ids: input.objective_ids || [], campaign_ids: input.campaign_ids || [],
    notes: input.notes, owner: input.owner, priority: input.priority || "MEDIUM",
    review_date: input.review_date ?? null, created_at: t, updated_at: t,
  };
  save({ strategies: [...(b.strategies || []), row] });
  marketingEmit(MarketingEvents.STRATEGY, row);
  return row;
}
export function updateStrategy(id: number, patch: Partial<Strategy>): Strategy | null {
  const b = load();
  const list = b.strategies || [];
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ strategies: list });
  marketingEmit(MarketingEvents.STRATEGY, list[i]);
  return list[i];
}

// ── Personas ──
export function listPersonas(): Persona[] {
  ensureMarketingSeed();
  return (load().personas || []).sort((a, b) => a.name.localeCompare(b.name));
}
export function createPersona(input: Partial<Persona> & { name: string }): Persona {
  ensureMarketingSeed();
  const b = load();
  const id = seq("persona");
  const t = now();
  const row: Persona = {
    id, name: input.name.trim(), category: input.category || "General",
    industry: input.industry, business_type: input.business_type, business_size: input.business_size, role: input.role,
    objectives: input.objectives || [], pain_points: input.pain_points || [],
    motivations: input.motivations || [], objections: input.objections || [],
    preferred_channels: input.preferred_channels || [], relevant_services: input.relevant_services || [],
    recommended_message: input.recommended_message, conversion_offer: input.conversion_offer,
    notes: input.notes, created_at: t, updated_at: t,
  };
  save({ personas: [...(b.personas || []), row] });
  marketingEmit(MarketingEvents.PERSONA, row);
  return row;
}
export function updatePersona(id: number, patch: Partial<Persona>): Persona | null {
  const b = load();
  const list = b.personas || [];
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ personas: list });
  marketingEmit(MarketingEvents.PERSONA, list[i]);
  return list[i];
}

// ── SWOT ──
export function listSwot(): SwotItem[] {
  ensureMarketingSeed();
  return load().swot || [];
}
export function createSwot(input: Partial<SwotItem> & { title: string; quadrant: SwotItem["quadrant"] }): SwotItem {
  ensureMarketingSeed();
  const b = load();
  const id = seq("swot");
  const t = now();
  const row: SwotItem = {
    id, quadrant: input.quadrant, title: input.title.trim(), description: input.description,
    priority: input.priority || "MEDIUM", evidence: input.evidence, assumption: !!input.assumption,
    recommended_action: input.recommended_action, linked_objective_id: input.linked_objective_id ?? null,
    created_at: t, updated_at: t,
  };
  save({ swot: [...(b.swot || []), row] });
  marketingEmit(MarketingEvents.SWOT, row);
  return row;
}
export function updateSwot(id: number, patch: Partial<SwotItem>): SwotItem | null {
  const b = load();
  const list = b.swot || [];
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ swot: list });
  marketingEmit(MarketingEvents.SWOT, list[i]);
  return list[i];
}
export function deleteSwot(id: number) {
  const b = load();
  save({ swot: (b.swot || []).filter((s) => s.id !== id) });
  marketingEmit(MarketingEvents.SWOT);
}

// ── Objectives / OKRs ──
export function listObjectives(): Objective[] {
  ensureMarketingSeed();
  return (load().objectives || []).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function createObjective(input: Partial<Objective> & { name: string }): Objective {
  ensureMarketingSeed();
  const b = load();
  const id = seq("objective");
  const t = now();
  const row: Objective = {
    id, name: input.name.trim(), description: input.description,
    horizon: input.horizon || "quarterly", status: input.status || "ACTIVE",
    key_results: input.key_results || [], campaign_ids: input.campaign_ids || [],
    persona_ids: input.persona_ids || [], owner: input.owner, deadline: input.deadline ?? null,
    created_at: t, updated_at: t,
  };
  save({ objectives: [...(b.objectives || []), row] });
  marketingEmit(MarketingEvents.OKR, row);
  return row;
}
export function updateObjective(id: number, patch: Partial<Objective>): Objective | null {
  const b = load();
  const list = b.objectives || [];
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ objectives: list });
  marketingEmit(MarketingEvents.OKR, list[i]);
  return list[i];
}
export function objectiveProgress(o: Objective): number {
  if (!o.key_results?.length) return 0;
  const parts = o.key_results.map((kr) => {
    const span = kr.target - kr.baseline;
    if (span === 0) return kr.current >= kr.target ? 1 : 0;
    return Math.max(0, Math.min(1, (kr.current - kr.baseline) / span));
  });
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 1000) / 10;
}

// ── Brand ──
export function listBrands(): BrandProfile[] {
  ensureMarketingSeed();
  return load().brands || [];
}
export function getDefaultBrand(): BrandProfile | null {
  const brands = listBrands();
  return brands.find((b) => b.is_default) || brands[0] || null;
}
export function updateBrand(id: number, patch: Partial<BrandProfile>): BrandProfile | null {
  const b = load();
  const list = b.brands || [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ brands: list });
  marketingEmit(MarketingEvents.BRAND, list[i]);
  return list[i];
}
export function listClaims(brandId?: number): BrandClaim[] {
  ensureMarketingSeed();
  let list = load().claims || [];
  if (brandId != null) list = list.filter((c) => c.brand_id === brandId);
  return list;
}
export function createClaim(input: Partial<BrandClaim> & { brand_id: number; text: string }): BrandClaim {
  ensureMarketingSeed();
  const b = load();
  const id = seq("claim");
  const t = now();
  const row: BrandClaim = {
    id, brand_id: input.brand_id, text: input.text.trim(), category: input.category || "claim",
    status: input.status || "unverified", evidence: input.evidence, created_at: t, updated_at: t,
  };
  save({ claims: [...(b.claims || []), row] });
  marketingEmit(MarketingEvents.BRAND, row);
  return row;
}

// ── Funnels ──
export function listFunnels(): Funnel[] {
  ensureMarketingSeed();
  return load().funnels || [];
}
export function createFunnel(input: Partial<Funnel> & { name: string }): Funnel {
  ensureMarketingSeed();
  const b = load();
  const id = seq("funnel");
  const t = now();
  const row: Funnel = {
    id, name: input.name.trim(), campaign_id: input.campaign_id ?? null,
    page_path: input.page_path ?? null, form_ref: input.form_ref ?? null,
    stages: input.stages || [
      { id: "s1", name: "Visitor" }, { id: "s2", name: "Landing page" },
      { id: "s3", name: "CTA" }, { id: "s4", name: "Form" },
      { id: "s5", name: "Qualified lead" }, { id: "s6", name: "Customer" },
    ],
    notes: input.notes, created_at: t, updated_at: t,
  };
  save({ funnels: [...(b.funnels || []), row] });
  marketingEmit(MarketingEvents.FUNNEL, row);
  return row;
}
export function updateFunnel(id: number, patch: Partial<Funnel>): Funnel | null {
  const b = load();
  const list = b.funnels || [];
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ funnels: list });
  marketingEmit(MarketingEvents.FUNNEL, list[i]);
  return list[i];
}

// ── Settings + backup ──
export function getSettings(): MarketingSettings {
  ensureMarketingSeed();
  return load().settings || {
    business_name: "CINTEXA", default_brand_id: null, currency: "GHS",
    reporting_period: "monthly",
    channels: ["Website", "Social media", "Email", "WhatsApp", "Referral", "Other"],
  };
}
export function updateSettings(patch: Partial<MarketingSettings>): MarketingSettings {
  const cur = getSettings();
  const next = { ...cur, ...patch };
  save({ settings: next });
  marketingEmit(MarketingEvents.SETTINGS, next);
  return next;
}


export function archiveObjective(id: number): Objective | null {
  return updateObjective(id, { status: "ARCHIVED" });
}

export function duplicateObjective(id: number): Objective | null {
  const src = listObjectives().find((o) => o.id === id);
  if (!src) return null;
  return createObjective({
    name: `${src.name} (copy)`,
    description: src.description,
    horizon: src.horizon,
    status: "ACTIVE",
    key_results: src.key_results.map((kr) => ({
      ...kr,
      id: crypto.randomUUID(),
      current: kr.baseline,
      status: "on_track",
    })),
    campaign_ids: [...(src.campaign_ids || [])],
    persona_ids: [...(src.persona_ids || [])],
    owner: src.owner,
  });
}

export function exportMarketingJson(): string {
  ensureMarketingSeed();
  const data = load();
  return JSON.stringify({ schemaVersion: 1, exportedAt: now(), data }, null, 2);
}

export function importMarketingJson(raw: string, mode: "merge" | "replace" = "merge"): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(raw);
    const data = parsed.data || parsed;
    if (mode === "replace") {
      localStorage.setItem(KEY, JSON.stringify(data));
    } else {
      const cur = load();
      localStorage.setItem(KEY, JSON.stringify({ ...cur, ...data }));
    }
    marketingEmit(MarketingEvents.CHANGED);
    return { ok: true, message: mode === "replace" ? "Replaced local marketing store." : "Merged into local marketing store." };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Invalid JSON" };
  }
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}

// ── Asset references (local tags on media; no duplicate file storage) ──
export type AssetRef = {
  id: number;
  name: string;
  media_id?: number | null;
  url?: string | null;
  mime_type?: string | null;
  category?: string | null;
  tags: string[];
  brand_id?: number | null;
  campaign_ids: number[];
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type PageRef = {
  id: number;
  title: string;
  path: string;
  notes?: string | null;
  created_at: string;
};

export type FormRef = {
  id: number;
  name: string;
  form_id?: number | null;
  notes?: string | null;
  created_at: string;
};

export function listAssets(): AssetRef[] {
  ensureMarketingSeed();
  return ((load() as any).assets || []).sort((a: AssetRef, b: AssetRef) => b.updated_at.localeCompare(a.updated_at));
}

export function createAsset(input: Partial<AssetRef> & { name: string }): AssetRef {
  ensureMarketingSeed();
  const b = load() as any;
  const id = seq("asset");
  const t = now();
  const row: AssetRef = {
    id,
    name: input.name.trim(),
    media_id: input.media_id ?? null,
    url: input.url ?? null,
    mime_type: input.mime_type ?? null,
    category: input.category ?? null,
    tags: input.tags || [],
    brand_id: input.brand_id ?? null,
    campaign_ids: input.campaign_ids || [],
    notes: input.notes ?? null,
    created_at: t,
    updated_at: t,
  };
  save({ assets: [...(b.assets || []), row] });
  return row;
}

export function updateAsset(id: number, patch: Partial<AssetRef>): AssetRef | null {
  const b = load() as any;
  const list: AssetRef[] = b.assets || [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, id, updated_at: now() };
  save({ assets: list });
  return list[i];
}

export function deleteAsset(id: number) {
  const b = load() as any;
  save({ assets: (b.assets || []).filter((x: AssetRef) => x.id !== id) });
}

export function listPageRefs(): PageRef[] {
  ensureMarketingSeed();
  return (load() as any).pageRefs || [];
}

export function createPageRef(input: { title: string; path: string; notes?: string }): PageRef {
  ensureMarketingSeed();
  const b = load() as any;
  const id = seq("pageRef");
  const row: PageRef = { id, title: input.title.trim(), path: input.path.trim() || "/", notes: input.notes, created_at: now() };
  save({ pageRefs: [...(b.pageRefs || []), row] });
  return row;
}

export function listFormRefs(): FormRef[] {
  ensureMarketingSeed();
  return (load() as any).formRefs || [];
}

export function createFormRef(input: { name: string; form_id?: number | null; notes?: string }): FormRef {
  ensureMarketingSeed();
  const b = load() as any;
  const id = seq("formRef");
  const row: FormRef = { id, name: input.name.trim(), form_id: input.form_id ?? null, notes: input.notes, created_at: now() };
  save({ formRefs: [...(b.formRefs || []), row] });
  return row;
}

/** Sync OKR current values from local campaign / lead counts (CALCULATED). */
export function syncOkrsFromLocalMetrics(metrics: {
  activeCampaigns: number;
  leadsGenerated: number;
  qualifiedLeads: number;
  contentItems: number;
}): Objective[] {
  ensureMarketingSeed();
  const b = load();
  const list = (b.objectives || []).map((o) => {
    const krs = o.key_results.map((kr) => {
      const n = kr.name.toLowerCase();
      let current = kr.current;
      if (n.includes("qualified") && n.includes("lead")) current = metrics.qualifiedLeads;
      else if (n.includes("lead")) current = metrics.leadsGenerated;
      else if (n.includes("active campaign") || n.includes("campaign")) current = metrics.activeCampaigns;
      else if (n.includes("content")) current = metrics.contentItems;
      const status =
        current >= kr.target ? "completed" : current >= (kr.baseline + (kr.target - kr.baseline) * 0.5) ? "on_track" : "at_risk";
      return { ...kr, current, status };
    });
    return { ...o, key_results: krs, updated_at: now() };
  });
  save({ objectives: list });
  marketingEmit(MarketingEvents.OKR);
  return list;
}
