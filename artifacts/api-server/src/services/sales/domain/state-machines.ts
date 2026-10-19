/**
 * Explicit state machines. A status can only change along a listed edge; anything else is rejected with a
 * 409 explaining the allowed next states. Keeping these tables in one place makes the lifecycle auditable.
 */
import { conflict } from "../core/errors";

export type Transitions<S extends string> = Record<S, readonly S[]>;

export const LEAD_TRANSITIONS: Transitions<"new" | "contacted" | "qualified" | "nurturing" | "converted" | "disqualified"> = {
  new: ["contacted", "qualified", "nurturing", "disqualified"],
  contacted: ["qualified", "nurturing", "disqualified", "new"],
  qualified: ["converted", "nurturing", "disqualified", "contacted"],
  nurturing: ["contacted", "qualified", "disqualified"],
  converted: [],
  disqualified: ["new", "nurturing"],
};

export const QUOTATION_TRANSITIONS: Transitions<"draft" | "internal_review" | "pending_approval" | "approved" | "sent" | "viewed" | "accepted" | "rejected" | "expired" | "superseded" | "cancelled"> = {
  draft: ["internal_review", "pending_approval", "approved", "cancelled"],
  internal_review: ["draft", "pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "draft", "cancelled"],
  approved: ["sent", "draft", "cancelled", "superseded"],
  sent: ["viewed", "accepted", "rejected", "expired", "superseded", "cancelled"],
  viewed: ["accepted", "rejected", "expired", "superseded", "cancelled"],
  accepted: [],
  rejected: ["superseded"],
  expired: ["superseded"],
  superseded: [],
  cancelled: [],
};

export const ORDER_TRANSITIONS: Transitions<"draft" | "pending_approval" | "confirmed" | "processing" | "partially_fulfilled" | "fulfilled" | "completed" | "cancelled"> = {
  draft: ["pending_approval", "confirmed", "cancelled"],
  pending_approval: ["confirmed", "draft", "cancelled"],
  confirmed: ["processing", "partially_fulfilled", "fulfilled", "cancelled"],
  processing: ["partially_fulfilled", "fulfilled", "cancelled"],
  partially_fulfilled: ["partially_fulfilled", "fulfilled", "cancelled"],
  fulfilled: ["completed"],
  completed: [],
  cancelled: [],
};

export const TARGET_PERIOD_TRANSITIONS: Transitions<"draft" | "pending_approval" | "approved" | "closed"> = {
  draft: ["pending_approval", "approved"],
  pending_approval: ["approved", "draft"],
  approved: ["closed"],
  closed: [],
};

export const COMMISSION_TRANSITIONS: Transitions<"calculated" | "approved" | "paid" | "void"> = {
  calculated: ["approved", "void"],
  approved: ["paid", "void"],
  paid: [],
  void: [],
};

export const PLAYBOOK_TRANSITIONS: Transitions<"draft" | "review" | "published" | "archived"> = {
  draft: ["review", "published", "archived"],
  review: ["draft", "published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransition<S extends string>(table: Transitions<S>, from: S, to: S): boolean {
  return (table[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(entity: string, table: Transitions<S>, from: S, to: S): void {
  if (from === to) return;
  if (!canTransition(table, from, to)) {
    const allowed = table[from] ?? [];
    throw conflict(`A ${entity} that is "${from}" cannot become "${to}"${allowed.length ? `. Allowed: ${allowed.join(", ")}` : ". This status is final"}`, "invalid_transition", { from, to, allowed });
  }
}
