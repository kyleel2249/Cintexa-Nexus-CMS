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
  createCampaign: (body: Parameters<typeof store.createCampaign>[0]) => Promise.resolve(store.createCampaign(body)),
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
