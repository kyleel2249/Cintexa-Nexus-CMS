/**
 * Automatic recommendations for every record that enters any Nexus tool.
 * Deterministic rules over the event (what happened, where, how much); no external service.
 * The same event produces a different, relevant suggestion for each receiving tool.
 */

export type RecEvent = { event_type: string; source_module: string; entity_type: string; entity_id: string };

export const ALL_MODULES = ["sales", "marketing", "corporate-strategy", "business-diary", "financial-intelligence", "finance", "dashboard"] as const;
export type ModuleId = (typeof ALL_MODULES)[number];

type Kind = "lead" | "customer" | "order" | "invoice" | "payment" | "expense" | "journal" | "asset" | "campaign" | "content" | "strategy" | "diary" | "fi" | "other";

export function kindOf(ev: RecEvent): Kind {
  const t = `${ev.event_type} ${ev.entity_type}`.toLowerCase();
  if (/lead|prospect|opportunit/.test(t)) return "lead";
  if (/customer|client|contact|account(?!ing)/.test(t)) return "customer";
  if (/order|quote|deal/.test(t)) return "order";
  if (/payment|receipt/.test(t)) return "payment";
  if (/invoice|bill/.test(t)) return "invoice";
  if (/expense|spend|budget/.test(t)) return "expense";
  if (/journal|ledger/.test(t)) return "journal";
  if (/asset|deprec/.test(t)) return "asset";
  if (/campaign|ad|email|seo|social/.test(t)) return "campaign";
  if (/content|post|calendar/.test(t)) return "content";
  if (/strategy|objective|kpi|initiative|risk|swot|csi|goal/.test(t)) return "strategy";
  if (/diary/.test(t)) return "diary";
  if (/^fi_|financial|ledger/.test(t)) return "fi";
  return "other";
}

const money = (minor: unknown) => {
  const n = Number(minor);
  if (!Number.isFinite(n) || n <= 0) return "";
  const major = n / 100;
  return ` of ${Number.isInteger(major) ? major.toLocaleString("en-US") : major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const RULES: Record<Kind, Partial<Record<ModuleId, (amt: string) => string[]>>> = {
  lead: {
    sales: () => ["Contact the lead within 24 hours and record the next step.", "Qualify budget, need and timing before preparing a quote."],
    marketing: () => ["Tag the lead with the campaign or channel that produced it so Customer Acquisition Cost (CAC) is measured per channel."],
    finance: () => ["Marketing and sales spend on this lead counts toward CAC: keep it in 6200 Marketing and Advertising or a sales cost account."],
    "corporate-strategy": () => ["Compare lead volume with the growth target in your strategy objectives."],
    "financial-intelligence": () => ["Add the expected revenue to the forecast only after the lead is qualified."],
    "business-diary": () => ["Log the first conversation with this lead as a diary entry."],
    dashboard: () => ["Check the pipeline widget for lead response time."],
  },
  customer: {
    sales: () => ["Record the customer's decision-maker, payment terms and credit limit."],
    marketing: () => ["Mark this customer as acquired and link the originating campaign: it feeds the Customer Acquisition Cost (CAC) ratio."],
    finance: () => ["Set up the customer's receivable terms; the CAC ratio and Days Sales Outstanding use this customer's invoices."],
    "corporate-strategy": () => ["Review customer concentration: no single customer should dominate revenue."],
    "financial-intelligence": () => ["Include the customer in receivable ageing and credit-risk checks."],
    "business-diary": () => ["Record the onboarding date and who owns the relationship."],
    dashboard: () => ["New customer count updates the acquisition metrics."],
  },
  order: {
    sales: (a) => [`Confirm delivery date and invoice terms for the order${a}.`],
    marketing: () => ["Attribute this order to a campaign to measure return on marketing spend."],
    finance: (a) => [`Raise the invoice for the order${a} when it is confirmed so revenue and receivables are recorded in the right period.`],
    "corporate-strategy": () => ["Check this order against the revenue target for the quarter."],
    "financial-intelligence": () => ["Update the cash forecast with the expected payment date."],
    "business-diary": () => ["Record any commitments made to the customer."],
    dashboard: () => ["Revenue and pipeline cards refresh from this order."],
  },
  invoice: {
    finance: (a) => [`Invoice${a} issued: follow up before the due date; unpaid invoices raise Days Sales Outstanding.`],
    sales: () => ["Tell the account owner so they can follow up on payment."],
    marketing: () => ["Revenue from this customer can be matched to its campaign for return-on-spend."],
    "corporate-strategy": () => ["Revenue booked: compare year-to-date revenue with plan."],
    "financial-intelligence": () => ["Receivables rose; the current ratio and cash forecast are recalculated."],
    "business-diary": () => ["Invoice issued is recorded for the audit trail."],
    dashboard: () => ["Receivables and revenue cards refresh."],
  },
  payment: {
    finance: (a) => [`Payment${a} received: confirm it is matched to the right invoice.`],
    sales: () => ["Thank the customer and check whether they need a follow-up order."],
    marketing: () => ["Customer paid: count them as a converted customer in acquisition analysis."],
    "corporate-strategy": () => ["Cash collected supports the cash-runway objective."],
    "financial-intelligence": () => ["Cash up and receivables down: liquidity ratios improve."],
    "business-diary": () => ["Payment recorded for the audit trail."],
    dashboard: () => ["Cash card refreshes."],
  },
  expense: {
    finance: (a) => [`Expense${a}: attach the receipt and confirm the account (marketing, data bandwidth, rent and so on) so ratios classify it correctly.`],
    sales: () => ["If this is a selling cost, it counts toward Customer Acquisition Cost."],
    marketing: () => ["Compare this spend with the campaign budget and the leads it produced."],
    "corporate-strategy": () => ["Check the expense against the operating-cost objective."],
    "financial-intelligence": () => ["Net margin and operating margin are recalculated."],
    "business-diary": () => ["Record why the spend was approved."],
    dashboard: () => ["Expense and profit cards refresh."],
  },
  journal: {
    finance: () => ["Confirm the journal memo explains the business reason, not only the accounts."],
    sales: () => ["If the entry changes revenue or receivables, check open customer balances."],
    marketing: () => ["If the entry touches marketing spend, review the Customer Acquisition Cost ratio."],
    "corporate-strategy": () => ["Re-check profitability against strategy targets."],
    "financial-intelligence": () => ["All financial ratios are recalculated from the new balances."],
    "business-diary": () => ["Journal recorded for the audit trail."],
    dashboard: () => ["Finance cards refresh."],
  },
  asset: {
    finance: () => ["Depreciation reduces profit but not cash; check the asset register against physical items."],
    "financial-intelligence": () => ["Asset turnover and return on assets are recalculated."],
    "corporate-strategy": () => ["Plan replacement before the asset is fully depreciated."],
    sales: () => [], marketing: () => [], "business-diary": () => ["Asset movement recorded."], dashboard: () => ["Asset totals refresh."],
  },
  campaign: {
    marketing: () => ["Set a budget and a target number of customers so Customer Acquisition Cost can be judged."],
    sales: () => ["Prepare the sales team for the leads this campaign will bring."],
    finance: () => ["Marketing spend for this campaign should post to 6200 Marketing and Advertising."],
    "corporate-strategy": () => ["Link the campaign to a strategy objective."],
    "financial-intelligence": () => ["Include planned spend in the cash forecast."],
    "business-diary": () => ["Record the campaign's goal and owner."],
    dashboard: () => ["Marketing cards refresh."],
  },
  content: {
    marketing: () => ["Schedule publication and tie the item to a campaign."],
    sales: () => ["Share this content with leads in the pipeline."],
    finance: () => [], "corporate-strategy": () => [], "financial-intelligence": () => [],
    "business-diary": () => ["Content activity recorded."], dashboard: () => ["Content cards refresh."],
  },
  strategy: {
    "corporate-strategy": () => ["Give each objective an owner, a measure and a date."],
    finance: () => ["Check that the budget supports this objective."],
    sales: () => ["Translate the objective into a sales target."],
    marketing: () => ["Align campaigns with the objective."],
    "financial-intelligence": () => ["Model the financial effect of the objective."],
    "business-diary": () => ["Record the decision and who approved it."],
    dashboard: () => ["Strategy cards refresh."],
  },
  diary: {
    "business-diary": () => ["Add a follow-up date to turn this note into an action."],
    sales: () => [], marketing: () => [], finance: () => [], "corporate-strategy": () => ["Review diary entries for decisions that should become strategy objectives."], "financial-intelligence": () => [], dashboard: () => ["Diary cards refresh."],
  },
  fi: {
    "financial-intelligence": () => ["Review the entry in the ratio analysis."],
    finance: () => ["Reconcile with the CINTEXA Finance ledger."],
    sales: () => [], marketing: () => [], "corporate-strategy": () => ["Check profitability against targets."], "business-diary": () => ["Entry recorded."], dashboard: () => ["Financial cards refresh."],
  },
  other: {},
};

const GENERIC: Record<ModuleId, string> = {
  sales: "Check whether this change affects open deals or customer balances.",
  marketing: "Check whether this change affects campaign results or Customer Acquisition Cost.",
  "corporate-strategy": "Check whether this change moves any strategy objective or target.",
  "business-diary": "Recorded in the diary so there is an audit trail.",
  "financial-intelligence": "Financial ratios and forecasts are recalculated from this change.",
  finance: "Check that the ledger and its ratios still reflect this change.",
  dashboard: "Dashboard cards refresh from this change.",
};

/** Every module receives every event, including the one it came from, so links run both ways between all tools. */
export function targetsFor(_ev: RecEvent): ModuleId[] {
  return [...ALL_MODULES];
}

export function recommend(ev: RecEvent, payload: Record<string, any> = {}, target: ModuleId): string[] {
  const rule = RULES[kindOf(ev)][target];
  const out = rule ? rule(money(payload.amountMinor ?? payload.amount_minor)) : [];
  const recs = out.length ? out : [GENERIC[target]];
  return recs.slice(0, 3);
}

export function recommendAll(ev: RecEvent, payload: Record<string, any> = {}): Array<{ target: ModuleId; text: string }> {
  const rows: Array<{ target: ModuleId; text: string }> = [];
  for (const t of targetsFor(ev)) for (const text of recommend(ev, payload, t)) rows.push({ target: t, text });
  return rows;
}
