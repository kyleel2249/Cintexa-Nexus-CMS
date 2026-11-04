/**
 * On-device Marketing Management store.
 * No API server, no authentication — data lives in this browser (localStorage).
 */
const KEY = "cintexa-marketing-v1";

export type Campaign = {
  id: number;
  number: string;
  name: string;
  description?: string | null;
  objective?: string | null;
  status: string;
  priority: string;
  channels: string[];
  start_date?: string | null;
  end_date?: string | null;
  budget: number;
  spent: number;
  owner_id?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  activities: { at: string; actor_id?: string; action: string; summary: string }[];
};

export type ContentItem = {
  id: number;
  title: string;
  slug?: string | null;
  type: string;
  status: string;
  body?: string | null;
  excerpt?: string | null;
  campaign_id?: number | null;
  category?: string | null;
  tags: string[];
  channel?: string | null;
  scheduled_at?: string | null;
  published_at?: string | null;
  version: number;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type CalEvent = {
  id: number;
  title: string;
  description?: string | null;
  event_type: string;
  status: string;
  channel?: string | null;
  campaign_id?: number | null;
  content_id?: number | null;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailCampaign = {
  id: number;
  name: string;
  subject: string;
  status: string;
  body_html?: string | null;
  body_text?: string | null;
  audience?: string | null;
  scheduled_at?: string | null;
  sent_at?: string | null;
  metrics?: { opens?: number; clicks?: number; unsubs?: number; sent?: number };
  created_at: string;
  updated_at: string;
};

export type MarketingLead = {
  id: number;
  name: string;
  email?: string | null;
  source?: string | null;
  status: string;
  score: number;
  campaign_id?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type Automation = {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  trigger_event: string;
  conditions: unknown[];
  actions: unknown[];
  last_run_at?: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
};

export type BudgetLine = {
  id: number;
  name: string;
  period_start: string;
  period_end: string;
  amount: number;
  spent: number;
  currency: string;
  campaign_id?: number | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type SeoRecord = {
  id: number;
  page_path: string;
  title?: string | null;
  meta_description?: string | null;
  slug?: string | null;
  canonical?: string | null;
  keywords: string[];
  score: number;
  notes?: string | null;
  updated_at: string;
};

type Store = {
  campaigns: Campaign[];
  content: ContentItem[];
  events: CalEvent[];
  emails: EmailCampaign[];
  leads: MarketingLead[];
  automations: Automation[];
  budgets: BudgetLine[];
  seo: SeoRecord[];
  seq: { campaign: number; content: number; event: number; email: number; lead: number; auto: number; budget: number; seo: number; number: number };
};

function empty(): Store {
  return {
    campaigns: [],
    content: [],
    events: [],
    emails: [],
    leads: [],
    automations: [],
    budgets: [],
    seo: [],
    seq: { campaign: 1, content: 1, event: 1, email: 1, lead: 1, auto: 1, budget: 1, seo: 1, number: 1000 },
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Store;
    return { ...empty(), ...parsed, seq: { ...empty().seq, ...(parsed.seq || {}) } };
  } catch {
    return empty();
  }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

function now() {
  return new Date().toISOString();
}

// ── Campaigns ──
export function listCampaigns(status?: string): Campaign[] {
  let list = load().campaigns.filter((c) => !c.archived_at);
  if (status) list = list.filter((c) => c.status === status);
  return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getCampaign(id: number): Campaign | null {
  return load().campaigns.find((c) => c.id === id && !c.archived_at) || null;
}

export function createCampaign(input: Partial<Campaign> & { name: string }): Campaign {
  const s = load();
  const id = s.seq.campaign++;
  const number = `MC-${s.seq.number++}`;
  const t = now();
  const row: Campaign = {
    id,
    number,
    name: input.name.trim(),
    description: input.description ?? null,
    objective: input.objective ?? null,
    status: input.status || "DRAFT",
    priority: input.priority || "MEDIUM",
    channels: input.channels || [],
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    budget: Number(input.budget) || 0,
    spent: Number(input.spent) || 0,
    owner_id: "local",
    tags: input.tags || [],
    metadata: input.metadata || {},
    archived_at: null,
    created_at: t,
    updated_at: t,
    activities: [{ at: t, actor_id: "local", action: "created", summary: "Campaign created" }],
  };
  s.campaigns.push(row);
  save(s);
  return row;
}

export function updateCampaign(id: number, patch: Partial<Campaign>): Campaign | null {
  const s = load();
  const c = s.campaigns.find((x) => x.id === id && !x.archived_at);
  if (!c) return null;
  Object.assign(c, patch, { id: c.id, number: c.number, updated_at: now() });
  c.activities = c.activities || [];
  c.activities.push({ at: c.updated_at, actor_id: "local", action: "updated", summary: "Campaign updated" });
  save(s);
  return c;
}

export function transitionCampaign(id: number, to: string): Campaign | null {
  const valid: Record<string, string[]> = {
    DRAFT: ["PLANNED", "ARCHIVED"],
    PLANNED: ["APPROVED", "DRAFT", "ARCHIVED"],
    APPROVED: ["ACTIVE", "PLANNED", "ARCHIVED"],
    ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
    PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
    COMPLETED: ["ARCHIVED"],
    ARCHIVED: [],
  };
  const s = load();
  const c = s.campaigns.find((x) => x.id === id && !x.archived_at);
  if (!c || !valid[c.status]?.includes(to)) return null;
  const prev = c.status;
  c.status = to;
  c.updated_at = now();
  if (to === "ARCHIVED") c.archived_at = c.updated_at;
  c.activities = c.activities || [];
  c.activities.push({ at: c.updated_at, actor_id: "local", action: "status_change", summary: `${prev} → ${to}` });
  save(s);
  return c;
}

// ── Content ──
export function listContent(type?: string, status?: string): ContentItem[] {
  let list = load().content.filter((c) => !c.archived_at);
  if (type) list = list.filter((c) => c.type === type);
  if (status) list = list.filter((c) => c.status === status);
  return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getContent(id: number): ContentItem | null {
  return load().content.find((c) => c.id === id && !c.archived_at) || null;
}

export function createContent(input: Partial<ContentItem> & { title: string }): ContentItem {
  const s = load();
  const id = s.seq.content++;
  const t = now();
  const row: ContentItem = {
    id,
    title: input.title.trim(),
    slug: input.slug ?? null,
    type: input.type || "blog",
    status: input.status || "DRAFT",
    body: input.body ?? null,
    excerpt: input.excerpt ?? null,
    campaign_id: input.campaign_id ?? null,
    category: input.category ?? null,
    tags: input.tags || [],
    channel: input.channel ?? null,
    scheduled_at: input.scheduled_at ?? null,
    published_at: null,
    version: 1,
    archived_at: null,
    created_at: t,
    updated_at: t,
  };
  s.content.push(row);
  save(s);
  return row;
}

export function updateContent(id: number, patch: Partial<ContentItem>): ContentItem | null {
  const s = load();
  const c = s.content.find((x) => x.id === id && !x.archived_at);
  if (!c) return null;
  Object.assign(c, patch, { id: c.id, version: (c.version || 1) + 1, updated_at: now() });
  save(s);
  return c;
}

// ── Calendar / Social ──
export function listEvents(): CalEvent[] {
  return load().events.filter((e) => !e.archived_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function createEvent(input: Partial<CalEvent> & { title: string; starts_at: string }): CalEvent {
  const s = load();
  const id = s.seq.event++;
  const t = now();
  const row: CalEvent = {
    id,
    title: input.title.trim(),
    description: input.description ?? null,
    event_type: input.event_type || "content",
    status: input.status || "DRAFT",
    channel: input.channel ?? null,
    campaign_id: input.campaign_id ?? null,
    content_id: input.content_id ?? null,
    starts_at: input.starts_at,
    ends_at: input.ends_at ?? null,
    all_day: !!input.all_day,
    archived_at: null,
    created_at: t,
    updated_at: t,
  };
  s.events.push(row);
  save(s);
  return row;
}

export function updateEvent(id: number, patch: Partial<CalEvent>): CalEvent | null {
  const s = load();
  const e = s.events.find((x) => x.id === id && !x.archived_at);
  if (!e) return null;
  Object.assign(e, patch, { id: e.id, updated_at: now() });
  save(s);
  return e;
}

// ── Email ──
export function listEmails(): EmailCampaign[] {
  return load().emails.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function createEmail(input: Partial<EmailCampaign> & { name: string; subject: string }): EmailCampaign {
  const s = load();
  const id = s.seq.email++;
  const t = now();
  const row: EmailCampaign = {
    id,
    name: input.name.trim(),
    subject: input.subject.trim(),
    status: input.status || "DRAFT",
    body_html: input.body_html ?? null,
    body_text: input.body_text ?? null,
    audience: input.audience ?? null,
    scheduled_at: input.scheduled_at ?? null,
    sent_at: null,
    metrics: input.metrics || {},
    created_at: t,
    updated_at: t,
  };
  s.emails.push(row);
  save(s);
  return row;
}

export function updateEmail(id: number, patch: Partial<EmailCampaign>): EmailCampaign | null {
  const s = load();
  const e = s.emails.find((x) => x.id === id);
  if (!e) return null;
  Object.assign(e, patch, { id: e.id, updated_at: now() });
  save(s);
  return e;
}

// ── Leads ──
export function listLeads(): MarketingLead[] {
  return load().leads.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function createLead(input: Partial<MarketingLead> & { name: string }): MarketingLead {
  const s = load();
  const id = s.seq.lead++;
  const t = now();
  const row: MarketingLead = {
    id,
    name: input.name.trim(),
    email: input.email ?? null,
    source: input.source ?? null,
    status: input.status || "new",
    score: Number(input.score) || 0,
    campaign_id: input.campaign_id ?? null,
    notes: input.notes ?? null,
    created_at: t,
    updated_at: t,
  };
  s.leads.push(row);
  save(s);
  return row;
}

export function updateLead(id: number, patch: Partial<MarketingLead>): MarketingLead | null {
  const s = load();
  const l = s.leads.find((x) => x.id === id);
  if (!l) return null;
  Object.assign(l, patch, { id: l.id, updated_at: now() });
  save(s);
  return l;
}

// ── Automations ──
export function listAutomations(): Automation[] {
  return load().automations.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function createAutomation(input: Partial<Automation> & { name: string; trigger_event: string }): Automation {
  const s = load();
  const id = s.seq.auto++;
  const t = now();
  const row: Automation = {
    id,
    name: input.name.trim(),
    description: input.description ?? null,
    enabled: input.enabled !== false,
    trigger_event: input.trigger_event,
    conditions: input.conditions || [],
    actions: input.actions || [],
    last_run_at: null,
    run_count: 0,
    created_at: t,
    updated_at: t,
  };
  s.automations.push(row);
  save(s);
  return row;
}

export function updateAutomation(id: number, patch: Partial<Automation>): Automation | null {
  const s = load();
  const a = s.automations.find((x) => x.id === id);
  if (!a) return null;
  Object.assign(a, patch, { id: a.id, updated_at: now() });
  save(s);
  return a;
}

export function runAutomation(id: number): Automation | null {
  const s = load();
  const a = s.automations.find((x) => x.id === id);
  if (!a || !a.enabled) return null;
  a.last_run_at = now();
  a.run_count = (a.run_count || 0) + 1;
  a.updated_at = a.last_run_at;
  save(s);
  return a;
}

// ── Budgets ──
export function listBudgets(): BudgetLine[] {
  return load().budgets.sort((a, b) => b.period_start.localeCompare(a.period_start));
}

export function createBudget(input: Partial<BudgetLine> & { name: string; period_start: string; period_end: string; amount: number }): BudgetLine {
  const s = load();
  const id = s.seq.budget++;
  const t = now();
  const row: BudgetLine = {
    id,
    name: input.name.trim(),
    period_start: input.period_start,
    period_end: input.period_end,
    amount: Number(input.amount) || 0,
    spent: Number(input.spent) || 0,
    currency: input.currency || "USD",
    campaign_id: input.campaign_id ?? null,
    notes: input.notes ?? null,
    created_at: t,
    updated_at: t,
  };
  s.budgets.push(row);
  save(s);
  return row;
}

export function updateBudget(id: number, patch: Partial<BudgetLine>): BudgetLine | null {
  const s = load();
  const b = s.budgets.find((x) => x.id === id);
  if (!b) return null;
  Object.assign(b, patch, { id: b.id, updated_at: now() });
  save(s);
  return b;
}

// ── SEO ──
export function listSeo(): SeoRecord[] {
  return load().seo.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function upsertSeo(input: Partial<SeoRecord> & { page_path: string }): SeoRecord {
  const s = load();
  let row = s.seo.find((x) => x.page_path === input.page_path);
  const t = now();
  if (row) {
    Object.assign(row, input, { id: row.id, updated_at: t });
  } else {
    row = {
      id: s.seq.seo++,
      page_path: input.page_path,
      title: input.title ?? null,
      meta_description: input.meta_description ?? null,
      slug: input.slug ?? null,
      canonical: input.canonical ?? null,
      keywords: input.keywords || [],
      score: Number(input.score) || 0,
      notes: input.notes ?? null,
      updated_at: t,
    };
    s.seo.push(row);
  }
  // Simple on-page score
  let score = 0;
  if (row.title && row.title.length >= 10 && row.title.length <= 60) score += 25;
  else if (row.title) score += 10;
  if (row.meta_description && row.meta_description.length >= 50 && row.meta_description.length <= 160) score += 25;
  else if (row.meta_description) score += 10;
  if (row.slug) score += 15;
  if (row.canonical) score += 10;
  if (row.keywords?.length) score += Math.min(15, row.keywords.length * 3);
  row.score = Math.min(100, score);
  save(s);
  return row;
}

// ── Overview ──
export function overview() {
  const campaigns = listCampaigns();
  const active = campaigns.filter((c) => c.status === "ACTIVE").length;
  const draft = campaigns.filter((c) => c.status === "DRAFT").length;
  const planned = campaigns.filter((c) => c.status === "PLANNED" || c.status === "APPROVED").length;
  const completed = campaigns.filter((c) => c.status === "COMPLETED").length;
  const totalBudget = campaigns.reduce((s, c) => s + Number(c.budget || 0), 0);
  const totalSpent = campaigns.reduce((s, c) => s + Number(c.spent || 0), 0);
  const leads = listLeads();
  const budgets = listBudgets();
  const budgetAmount = budgets.reduce((s, b) => s + b.amount, 0);
  const budgetSpent = budgets.reduce((s, b) => s + b.spent, 0);
  return {
    kpis: {
      activeCampaigns: active,
      draftCampaigns: draft,
      scheduledCampaigns: planned,
      completedCampaigns: completed,
      totalBudget: totalBudget || budgetAmount,
      totalSpent: totalSpent || budgetSpent,
      budgetUtilization:
        (totalBudget || budgetAmount) > 0
          ? Math.round(((totalSpent || budgetSpent) / (totalBudget || budgetAmount)) * 1000) / 10
          : 0,
      leadsGenerated: leads.length,
      qualifiedLeads: leads.filter((l) => l.status === "qualified" || l.score >= 50).length,
      conversionRate: leads.length ? Math.round((leads.filter((l) => l.status === "won").length / leads.length) * 1000) / 10 : null,
      contentItems: listContent().length,
      upcomingEvents: listEvents().filter((e) => e.starts_at >= now()).length,
      emailCampaigns: listEmails().length,
    },
    recentCampaigns: campaigns.slice(0, 8),
    upcoming: campaigns.filter((c) => c.start_date && !["COMPLETED", "ARCHIVED"].includes(c.status)).slice(0, 5),
  };
}
