/**
 * Marketing client — 100% on-device. No network, no authentication.
 */
import * as store from "./local-store";

export const marketingApi = {
  overview: () => Promise.resolve(store.overview()),

  listCampaigns: (status?: string) => Promise.resolve({ items: store.listCampaigns(status), total: store.listCampaigns(status).length }),
  getCampaign: (id: number) => {
    const c = store.getCampaign(id);
    if (!c) return Promise.reject(new Error("Campaign not found"));
    return Promise.resolve(c);
  },
  createCampaign: (body: Parameters<typeof store.createCampaign>[0]) => {
    const row = store.createCampaign(body);
    try { ent.logActivity({ action: "created", entity_type: "campaign", entity_id: row.id, summary: `Campaign created: ${row.name}` }); } catch { /* */ }
    return Promise.resolve(row);
  },
  updateCampaign: (id: number, body: Parameters<typeof store.updateCampaign>[1]) => {
    const c = store.updateCampaign(id, body);
    if (!c) return Promise.reject(new Error("Campaign not found"));
    return Promise.resolve(c);
  },
  transitionCampaign: (id: number, status: string) => {
    const c = store.transitionCampaign(id, status);
    if (!c) return Promise.reject(new Error("Invalid transition or not found"));
    return Promise.resolve(c);
  },

  listContent: (type?: string, status?: string) => {
    const items = store.listContent(type, status);
    return Promise.resolve({ items, total: items.length });
  },
  getContent: (id: number) => {
    const c = store.getContent(id);
    if (!c) return Promise.reject(new Error("Content not found"));
    return Promise.resolve(c);
  },
  createContent: (body: Parameters<typeof store.createContent>[0]) => Promise.resolve(store.createContent(body)),
  updateContent: (id: number, body: Parameters<typeof store.updateContent>[1]) => {
    const c = store.updateContent(id, body);
    if (!c) return Promise.reject(new Error("Content not found"));
    return Promise.resolve(c);
  },

  listEvents: () => {
    const items = store.listEvents();
    return Promise.resolve({ items, total: items.length });
  },
  createEvent: (body: Parameters<typeof store.createEvent>[0]) => Promise.resolve(store.createEvent(body)),
  updateEvent: (id: number, body: Parameters<typeof store.updateEvent>[1]) => {
    const e = store.updateEvent(id, body);
    if (!e) return Promise.reject(new Error("Event not found"));
    return Promise.resolve(e);
  },
  confirmPublished: (id: number) => {
    const e = store.updateEvent(id, { status: "PUBLISHED_MANUALLY" });
    if (!e) return Promise.reject(new Error("Event not found"));
    return Promise.resolve(e);
  },

  listEmails: () => {
    const items = store.listEmails();
    return Promise.resolve({ items, total: items.length });
  },
  createEmail: (body: Parameters<typeof store.createEmail>[0]) => Promise.resolve(store.createEmail(body)),
  updateEmail: (id: number, body: Parameters<typeof store.updateEmail>[1]) => {
    const e = store.updateEmail(id, body);
    if (!e) return Promise.reject(new Error("Email not found"));
    return Promise.resolve(e);
  },

  listLeads: () => {
    const items = store.listLeads();
    return Promise.resolve({ items, total: items.length });
  },
  createLead: (body: Parameters<typeof store.createLead>[0]) => Promise.resolve(store.createLead(body)),
  updateLead: (id: number, body: Parameters<typeof store.updateLead>[1]) => {
    const l = store.updateLead(id, body);
    if (!l) return Promise.reject(new Error("Lead not found"));
    return Promise.resolve(l);
  },

  listAutomations: () => {
    const items = store.listAutomations();
    return Promise.resolve({ items, total: items.length });
  },
  createAutomation: (body: Parameters<typeof store.createAutomation>[0]) => Promise.resolve(store.createAutomation(body)),
  updateAutomation: (id: number, body: Parameters<typeof store.updateAutomation>[1]) => {
    const a = store.updateAutomation(id, body);
    if (!a) return Promise.reject(new Error("Automation not found"));
    return Promise.resolve(a);
  },
  runAutomation: (id: number) => {
    const a = store.runAutomation(id);
    if (!a) return Promise.reject(new Error("Cannot run"));
    return Promise.resolve(a);
  },

  listBudgets: () => {
    const items = store.listBudgets();
    return Promise.resolve({ items, total: items.length });
  },
  createBudget: (body: Parameters<typeof store.createBudget>[0]) => Promise.resolve(store.createBudget(body)),
  updateBudget: (id: number, body: Parameters<typeof store.updateBudget>[1]) => {
    const b = store.updateBudget(id, body);
    if (!b) return Promise.reject(new Error("Budget not found"));
    return Promise.resolve(b);
  },

  listSeo: () => {
    const items = store.listSeo();
    return Promise.resolve({ items, total: items.length });
  },
  upsertSeo: (body: Parameters<typeof store.upsertSeo>[0]) => Promise.resolve(store.upsertSeo(body)),
};

// Extended entities (strategy, brand, personas, SWOT, OKRs, funnels, settings)
import * as ent from "./entities";

export const marketingIntel = {
  ...({} as any),

  ensureSeed: () => { ent.ensureMarketingSeed(); },

  listStrategies: () => Promise.resolve({ items: ent.listStrategies() }),
  getStrategy: (id: number) => {
    const s = ent.getStrategy(id);
    if (!s) return Promise.reject(new Error("Not found"));
    return Promise.resolve(s);
  },
  createStrategy: (b: Parameters<typeof ent.createStrategy>[0]) => Promise.resolve(ent.createStrategy(b)),
  updateStrategy: (id: number, b: Parameters<typeof ent.updateStrategy>[1]) => {
    const s = ent.updateStrategy(id, b);
    if (!s) return Promise.reject(new Error("Not found"));
    return Promise.resolve(s);
  },

  listPersonas: () => Promise.resolve({ items: ent.listPersonas() }),
  createPersona: (b: Parameters<typeof ent.createPersona>[0]) => Promise.resolve(ent.createPersona(b)),
  updatePersona: (id: number, b: Parameters<typeof ent.updatePersona>[1]) => {
    const p = ent.updatePersona(id, b);
    if (!p) return Promise.reject(new Error("Not found"));
    return Promise.resolve(p);
  },

  listSwot: () => Promise.resolve({ items: ent.listSwot() }),
  createSwot: (b: Parameters<typeof ent.createSwot>[0]) => Promise.resolve(ent.createSwot(b)),
  updateSwot: (id: number, b: Parameters<typeof ent.updateSwot>[1]) => {
    const s = ent.updateSwot(id, b);
    if (!s) return Promise.reject(new Error("Not found"));
    return Promise.resolve(s);
  },
  deleteSwot: (id: number) => { ent.deleteSwot(id); return Promise.resolve(); },

  listObjectives: () => Promise.resolve({ items: ent.listObjectives() }),
  createObjective: (b: Parameters<typeof ent.createObjective>[0]) => Promise.resolve(ent.createObjective(b)),
  updateObjective: (id: number, b: Parameters<typeof ent.updateObjective>[1]) => {
    const o = ent.updateObjective(id, b);
    if (!o) return Promise.reject(new Error("Not found"));
    return Promise.resolve(o);
  },
  objectiveProgress: ent.objectiveProgress,
  listActivity: (limit?: number) => Promise.resolve(ent.listActivity(limit)),
  logActivity: (input: Parameters<typeof ent.logActivity>[0]) => {
    ent.logActivity(input);
    return Promise.resolve();
  },
  archiveObjective: (id: number) => {
    const o = ent.archiveObjective(id);
    if (!o) return Promise.reject(new Error("Not found"));
    return Promise.resolve(o);
  },
  duplicateObjective: (id: number) => {
    const o = ent.duplicateObjective(id);
    if (!o) return Promise.reject(new Error("Not found"));
    return Promise.resolve(o);
  },

  listBrands: () => Promise.resolve({ items: ent.listBrands() }),
  getDefaultBrand: () => Promise.resolve(ent.getDefaultBrand()),
  updateBrand: (id: number, b: Parameters<typeof ent.updateBrand>[1]) => {
    const x = ent.updateBrand(id, b);
    if (!x) return Promise.reject(new Error("Not found"));
    return Promise.resolve(x);
  },
  listClaims: (brandId?: number) => Promise.resolve({ items: ent.listClaims(brandId) }),
  createClaim: (b: Parameters<typeof ent.createClaim>[0]) => Promise.resolve(ent.createClaim(b)),

  listFunnels: () => Promise.resolve({ items: ent.listFunnels() }),
  createFunnel: (b: Parameters<typeof ent.createFunnel>[0]) => Promise.resolve(ent.createFunnel(b)),
  updateFunnel: (id: number, b: Parameters<typeof ent.updateFunnel>[1]) => {
    const f = ent.updateFunnel(id, b);
    if (!f) return Promise.reject(new Error("Not found"));
    return Promise.resolve(f);
  },

  getSettings: () => Promise.resolve(ent.getSettings()),
  updateSettings: (b: Parameters<typeof ent.updateSettings>[0]) => Promise.resolve(ent.updateSettings(b)),
  exportJson: () => Promise.resolve(ent.exportMarketingJson()),
  importJson: (raw: string, mode: "merge" | "replace" = "merge") => Promise.resolve(ent.importMarketingJson(raw, mode)),
  toCsv: ent.toCsv,
};

// Assets, page/form refs, OKR sync
export const marketingAssets = {
  list: () => Promise.resolve({ items: ent.listAssets() }),
  create: (b: Parameters<typeof ent.createAsset>[0]) => Promise.resolve(ent.createAsset(b)),
  update: (id: number, b: Parameters<typeof ent.updateAsset>[1]) => {
    const r = ent.updateAsset(id, b);
    if (!r) return Promise.reject(new Error("Not found"));
    return Promise.resolve(r);
  },
  remove: (id: number) => { ent.deleteAsset(id); return Promise.resolve(); },
  listPageRefs: () => Promise.resolve({ items: ent.listPageRefs() }),
  createPageRef: (b: Parameters<typeof ent.createPageRef>[0]) => Promise.resolve(ent.createPageRef(b)),
  listFormRefs: () => Promise.resolve({ items: ent.listFormRefs() }),
  createFormRef: (b: Parameters<typeof ent.createFormRef>[0]) => Promise.resolve(ent.createFormRef(b)),
  syncOkrs: (m: Parameters<typeof ent.syncOkrsFromLocalMetrics>[0]) => Promise.resolve(ent.syncOkrsFromLocalMetrics(m)),
};


export const marketingExtended = {
  listTouchpoints: (leadId?: number) => Promise.resolve(ent.listTouchpoints(leadId)),
  createTouchpoint: (b: Parameters<typeof ent.createTouchpoint>[0]) => Promise.resolve(ent.createTouchpoint(b)),
  deleteTouchpoint: (id: string) => { ent.deleteTouchpoint(id); return Promise.resolve(); },
  listTemplates: (arch?: boolean) => Promise.resolve(ent.listTemplates(arch)),
  createTemplate: (b: Parameters<typeof ent.createTemplate>[0]) => Promise.resolve(ent.createTemplate(b)),
  updateTemplate: (id: string, b: Parameters<typeof ent.updateTemplate>[1]) => {
    const r = ent.updateTemplate(id, b);
    if (!r) return Promise.reject(new Error("Not found"));
    return Promise.resolve(r);
  },
  listVariants: (t?: string, id?: number) => Promise.resolve(ent.listVariants(t, id)),
  createVariant: (b: Parameters<typeof ent.createVariant>[0]) => Promise.resolve(ent.createVariant(b)),
  updateVariant: (id: string, b: Parameters<typeof ent.updateVariant>[1]) => {
    const r = ent.updateVariant(id, b);
    if (!r) return Promise.reject(new Error("Not found"));
    return Promise.resolve(r);
  },
  getBudgetAlertConfig: () => Promise.resolve(ent.getBudgetAlertConfig()),
  setBudgetAlertConfig: (c: Parameters<typeof ent.setBudgetAlertConfig>[0]) => {
    ent.setBudgetAlertConfig(c);
    return Promise.resolve();
  },
  computeBudgetAlerts: (campaigns: Parameters<typeof ent.computeBudgetAlerts>[0]) =>
    Promise.resolve(ent.computeBudgetAlerts(campaigns)),
};
