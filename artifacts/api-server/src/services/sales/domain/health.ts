/**
 * Explainable customer health. Every signal is observable data with a stated rule; a customer is only flagged
 * "at risk" when a configured rule fires, and the reasons are returned so the UI can show *why*.
 */
import type { SalesSettings } from "../core/settings";

export interface HealthInput {
  /** days since the most recent paid/booked order, null when the account has never bought */
  daysSinceLastPurchase: number | null;
  ordersLast365: number;
  revenueLast90: number;
  revenuePrev90: number;
  openComplaints: number;
  activitiesLast60: number;
  /** account-specific expected purchase interval, if configured */
  reorderIntervalDays: number | null;
  /** days overdue for the expected reorder date, null if not applicable */
  daysPastExpectedReorder: number | null;
  status: "prospect" | "active" | "inactive" | "churned";
}

export interface HealthSignal {
  signal: string;
  effect: number;
  detail: string;
}

export interface Health {
  band: "healthy" | "watch" | "at_risk" | "churned" | "unknown";
  score: number | null;
  signals: HealthSignal[];
  reasons: string[];
}

export function assessHealth(i: HealthInput, cfg: SalesSettings["retention"]): Health {
  if (i.status === "churned") return { band: "churned", score: 0, signals: [], reasons: ["Marked as churned"] };
  const evidence = i.daysSinceLastPurchase !== null || i.openComplaints > 0 || i.activitiesLast60 > 0;
  if (!evidence) return { band: "unknown", score: null, signals: [], reasons: ["No purchase, complaint or activity history yet - not enough evidence to rate this account"] };

  const signals: HealthSignal[] = [];
  const reasons: string[] = [];
  let score = 70;
  const sig = (signal: string, effect: number, detail: string) => {
    signals.push({ signal, effect, detail });
    score += effect;
  };

  if (i.daysSinceLastPurchase === null) sig("no_purchases", -10, "Has never purchased");
  else {
    const interval = i.reorderIntervalDays;
    if (i.daysSinceLastPurchase >= cfg.inactiveDays) { sig("recency", -35, `No purchase for ${i.daysSinceLastPurchase} days (inactive after ${cfg.inactiveDays})`); reasons.push(`No purchase for ${i.daysSinceLastPurchase} days (inactivity limit ${cfg.inactiveDays})`); }
    else if (i.daysSinceLastPurchase >= cfg.atRiskDays) { sig("recency", -20, `No purchase for ${i.daysSinceLastPurchase} days (at-risk after ${cfg.atRiskDays})`); reasons.push(`No purchase for ${i.daysSinceLastPurchase} days (at-risk limit ${cfg.atRiskDays})`); }
    else if (i.daysSinceLastPurchase <= 30) sig("recency", 10, "Purchased in the last 30 days");
    if (interval !== null && i.daysPastExpectedReorder !== null && i.daysPastExpectedReorder > 0) { sig("reorder_overdue", -10, `Expected reorder is ${i.daysPastExpectedReorder} days overdue`); reasons.push(`Reorder is ${i.daysPastExpectedReorder} days overdue`); }
  }
  if (i.ordersLast365 >= 4) sig("frequency", 10, `${i.ordersLast365} orders in the last 12 months`);
  else if (i.ordersLast365 === 0 && i.daysSinceLastPurchase !== null) sig("frequency", -10, "No orders in the last 12 months");

  if (i.revenuePrev90 > 0) {
    const change = (i.revenueLast90 - i.revenuePrev90) / i.revenuePrev90;
    if (change <= -0.4) { sig("trend", -15, `Revenue down ${Math.round(-change * 100)}% versus the previous 90 days`); reasons.push(`Revenue is down ${Math.round(-change * 100)}% versus the previous 90 days`); }
    else if (change >= 0.2) sig("trend", 8, `Revenue up ${Math.round(change * 100)}% versus the previous 90 days`);
  }
  if (i.openComplaints > 0) { const e = -Math.min(30, cfg.complaintWeight * i.openComplaints); sig("complaints", e, `${i.openComplaints} unresolved complaint${i.openComplaints === 1 ? "" : "s"}`); reasons.push(`${i.openComplaints} unresolved complaint${i.openComplaints === 1 ? "" : "s"}`); }
  if (i.activitiesLast60 >= 2) sig("engagement", 8, `${i.activitiesLast60} touchpoints in the last 60 days`);
  else if (i.activitiesLast60 === 0 && i.daysSinceLastPurchase !== null && i.daysSinceLastPurchase >= cfg.atRiskDays) sig("engagement", -5, "No contact in the last 60 days");

  score = Math.max(0, Math.min(100, score));
  const ruleFired = reasons.length > 0;
  const band: Health["band"] = ruleFired && score < 50 ? "at_risk" : score >= 70 ? "healthy" : "watch";
  return { band, score, signals, reasons };
}
