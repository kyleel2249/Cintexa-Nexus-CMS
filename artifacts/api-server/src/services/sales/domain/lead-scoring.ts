import type { SalesSettings } from "../core/settings";
import { cmp } from "../core/money";

export interface ScorableLead {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  job_title?: string | null;
  budget?: string | null;
  estimated_value?: string | null;
  source?: string | null;
  consent_email?: boolean;
  consent_whatsapp?: boolean;
  last_contact_at?: string | null;
  created_at?: string | null;
  status?: string;
}

export interface ScoreFactor {
  factor: string;
  points: number;
  detail: string;
}

/**
 * Explainable lead score 0-100. Every point is attributed to a named factor so a salesperson can see *why*
 * a lead ranks where it does. Weights come from Sales settings; the result is clamped to 0..100.
 */
export function scoreLead(lead: ScorableLead, cfg: SalesSettings["leads"]["scoring"], now: Date): { score: number; breakdown: ScoreFactor[] } {
  const f: ScoreFactor[] = [];
  const add = (factor: string, points: number, detail: string) => {
    if (points !== 0) f.push({ factor, points, detail });
  };
  if (lead.email) add("email", cfg.hasEmail, "Has an e-mail address");
  if (lead.phone) add("phone", cfg.hasPhone, "Has a phone number");
  if (lead.company) add("company", cfg.hasCompany, "Company is known");
  if (lead.job_title) add("job_title", cfg.hasJobTitle, "Job title is known");
  const title = (lead.job_title ?? "").toLowerCase();
  if (title && cfg.decisionMakerTitles.some((t) => new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(title))) add("decision_maker", cfg.decisionMaker, "Title suggests decision-making authority");
  const money = lead.budget ?? lead.estimated_value;
  if (money) {
    add("budget", cfg.budgetKnown, "Budget or deal value is known");
    if (cmp(money, cfg.highBudgetThreshold) >= 0) add("high_budget", cfg.highBudget, `Budget at or above ${cfg.highBudgetThreshold}`);
  }
  const sw = lead.source ? cfg.sourceWeights[lead.source] : undefined;
  if (sw) add("source", sw, `Source "${lead.source}"`);
  if (lead.consent_email || lead.consent_whatsapp) add("consent", cfg.consent, "Has given communication consent");
  if (lead.last_contact_at) {
    const days = (now.getTime() - Date.parse(lead.last_contact_at)) / 86_400_000;
    if (days <= cfg.recentContactDays) add("recent_contact", cfg.recentContact, `Contacted within ${cfg.recentContactDays} days`);
    else if (days > cfg.staleDays && lead.status && !["converted", "disqualified"].includes(lead.status)) add("stale", -cfg.stalePenalty, `No contact for more than ${cfg.staleDays} days`);
  } else if (lead.created_at && lead.status === "new") {
    const days = (now.getTime() - Date.parse(lead.created_at)) / 86_400_000;
    if (days > cfg.staleDays) add("stale", -cfg.stalePenalty, `Never contacted after ${cfg.staleDays} days`);
  }
  const raw = f.reduce((a, b) => a + b.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), breakdown: f };
}

export function priorityFromScore(score: number): "low" | "medium" | "high" | "urgent" {
  if (score >= 75) return "urgent";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}
