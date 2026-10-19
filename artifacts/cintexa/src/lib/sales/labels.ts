import { titleCase } from "./format";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "gold" | "violet";

const TONES: Record<string, Tone> = {
  // generic
  open: "info", active: "success", draft: "neutral", archived: "neutral", paused: "warning", completed: "success", cancelled: "neutral", canceled: "neutral",
  // leads
  new: "info", contacted: "gold", qualified: "success", nurturing: "violet", converted: "success", disqualified: "danger",
  // opportunities
  won: "success", lost: "danger",
  // quotations
  internal_review: "info", pending_approval: "warning", approved: "success", sent: "info", viewed: "violet", accepted: "success", rejected: "danger", expired: "neutral", superseded: "neutral",
  // orders
  confirmed: "info", processing: "info", partially_fulfilled: "warning", fulfilled: "success",
  unpaid: "warning", partial: "warning", paid: "success", refunded: "neutral", overpaid: "danger",
  // activities
  done: "success", missed: "danger",
  // health
  healthy: "success", watch: "warning", at_risk: "danger", churned: "neutral", unknown: "neutral",
  // commissions
  calculated: "info", reversed: "neutral", voided: "neutral",
  // priority
  low: "neutral", medium: "info", high: "warning", urgent: "danger",
  // integrations / outbox
  pending: "warning", unconfigured: "warning", failed: "danger", dead: "danger", manual: "neutral", connected: "success", not_connected: "neutral", enabled_but_no_provider: "warning",
  // automation runs
  running: "info", success: "success", skipped: "neutral", retrying: "warning",
  // intel / misc
  verified: "success", unverified: "warning", planned: "info", published: "success", review: "warning", upcoming: "info", renewed: "success",
  resolved: "success", in_progress: "info", closed: "neutral", received: "info",
};

export function toneOf(status: string | null | undefined): Tone {
  return (status && TONES[status]) || "neutral";
}

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-border",
  info: "bg-sky-500/10 text-sky-500 border-sky-500/30",
  success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  danger: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  gold: "bg-primary/10 text-primary border-primary/30",
  violet: "bg-violet-500/10 text-violet-500 border-violet-500/30",
};

const LABELS: Record<string, string> = {
  pending_approval: "Pending approval", internal_review: "Internal review", at_risk: "At risk", not_connected: "Not connected", enabled_but_no_provider: "No provider installed",
  best_case: "Best case", web_form: "Web form", sales_rep: "Sales representative", sales_manager: "Sales manager", sales_director: "Sales director", sales_admin: "Sales administrator",
  sales_analyst: "Sales analyst", finance: "Finance", support_agent: "Support agent", readonly_exec: "Read-only executive",
};

export function labelOf(status: string | null | undefined): string {
  if (!status) return "—";
  return LABELS[status] ?? titleCase(status);
}

export const ROLE_OPTIONS = [
  { value: "sales_admin", label: "Sales administrator" }, { value: "sales_director", label: "Sales director" }, { value: "sales_manager", label: "Sales manager" },
  { value: "sales_rep", label: "Sales representative" }, { value: "sales_analyst", label: "Sales analyst" }, { value: "finance", label: "Finance" },
  { value: "support_agent", label: "Support agent" }, { value: "readonly_exec", label: "Read-only executive" },
];
