/** Option lists mirroring the server's validators. The server remains the authority and re-validates every value. */
export interface Opt {
  value: string;
  label: string;
}
const opts = (vals: readonly string[], labels: Record<string, string> = {}): Opt[] =>
  vals.map((value) => ({ value, label: labels[value] ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

export const LEAD_STATUSES = opts(["new", "contacted", "qualified", "nurturing", "converted", "disqualified"]);
export const LEAD_SOURCES = opts(["manual", "web_form", "referral", "event", "campaign", "partner", "cold", "import", "whatsapp", "email"], { web_form: "Web form", cold: "Cold outreach" });
export const PRIORITIES = opts(["low", "medium", "high", "urgent"]);
export const TOUCH_CHANNELS = opts(["call", "email", "meeting", "visit", "demo", "note"]);
export const ACCOUNT_KINDS = opts(["company", "individual"]);
export const ACCOUNT_STATUSES = opts(["prospect", "active", "inactive", "churned"]);
export const CONTACT_ROLES = opts(["contact", "decision_maker", "influencer", "billing", "technical", "champion"]);
export const ACTIVITY_TYPES = opts(["call", "email", "meeting", "visit", "demo", "task", "follow_up", "note", "comment", "event"]);
export const OPP_STATUSES = opts(["open", "won", "lost"]);
export const FORECAST_CATEGORIES = opts(["omitted", "pipeline", "best_case", "commit", "closed"]);
export const PRODUCT_KINDS = opts(["product", "service", "bundle"]);
export const PRODUCT_STATUSES = opts(["active", "discontinued"]);
export const QUOTATION_STATUSES = opts(["draft", "pending_approval", "approved", "sent", "viewed", "accepted", "rejected", "expired", "cancelled", "superseded"]);
export const ORDER_STATUSES = opts(["draft", "pending_approval", "confirmed", "processing", "partially_fulfilled", "fulfilled", "completed", "cancelled"]);
export const PAYMENT_STATUSES = opts(["unpaid", "partial", "paid", "refunded", "overpaid"]);
export const PAYMENT_METHODS = opts(["bank_transfer", "cash", "card", "mobile_money", "cheque", "other"]);
export const TARGET_SCOPES = opts(["company", "department", "team", "member", "product", "category", "territory", "branch", "channel"]);
export const TARGET_METRICS = opts(["revenue", "units", "gross_profit", "new_customers", "deals_won"]);
export const TARGET_BASES = opts(["booked", "invoiced", "collected"]);
export const PERIOD_KINDS = opts(["month", "quarter", "year", "custom"]);
export const CAMPAIGN_STATUSES = opts(["planned", "active", "paused", "completed", "cancelled"]);
export const CAMPAIGN_CHANNELS = opts(["email", "whatsapp", "social", "event", "webinar", "referral", "paid_ads", "content", "partner", "other"], { paid_ads: "Paid ads" });
export const INTEL_KINDS = opts(["pricing", "product", "positioning", "objection", "observation", "win_loss"], { win_loss: "Win / loss" });
export const FEEDBACK_KINDS = opts(["survey", "complaint", "feedback", "service_request"]);
export const FEEDBACK_STATUSES = opts(["open", "in_progress", "resolved", "closed"]);
export const PLAYBOOK_KINDS = opts(["article", "script", "discovery", "objection", "framework", "template", "negotiation", "closing", "onboarding", "training", "coaching", "pricing", "faq"], { faq: "FAQ" });
export const PLAYBOOK_STATUSES = opts(["draft", "review", "published", "archived"]);
export const DOC_KINDS = opts(["quotation", "proposal", "order", "contract", "account_plan", "meeting_summary", "report", "commission_statement", "other"]);
export const DOC_ENTITIES = opts(["lead", "account", "opportunity", "quotation", "order"]);
export const PERIODS: Opt[] = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "This week" }, { value: "last_week", label: "Last week" },
  { value: "month", label: "This month" }, { value: "last_month", label: "Last month" }, { value: "quarter", label: "This quarter" }, { value: "last_quarter", label: "Last quarter" },
  { value: "year", label: "This year" }, { value: "last_year", label: "Last year" }, { value: "last_30_days", label: "Last 30 days" }, { value: "last_90_days", label: "Last 90 days" },
];
export const CONDITION_OPS = opts(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "is_set", "is_empty"], { eq: "equals", neq: "does not equal", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "is one of", contains: "contains", is_set: "is set", is_empty: "is empty" });
export const ACTION_LABELS: Record<string, string> = {
  create_task: "Create a task", assign: "Assign owner", notify: "Send in-app notification", request_approval: "Request approval", update_field: "Update a field", add_tag: "Add a tag",
  create_reminder: "Create a reminder", send_message: "Send message (needs provider + consent)", call_integration: "Call integration (needs provider)", generate_report: "Generate report", escalate: "Escalate to manager",
};
