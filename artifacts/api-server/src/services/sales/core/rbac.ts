/**
 * Role-based access control for Sales. Everything here runs on the server; the UI only mirrors it for display.
 *
 * Permissions are "resource:action" strings. A role is a set of permissions plus a record *scope*:
 *   own  - only records the member owns
 *   team - own records plus those of members in the manager's team (and subordinate teams)
 *   all  - every record
 * Field protection (cost price, margins, commission rates) is a separate permission: `cost:read`.
 */
import type { Actor, RecordScope, SalesRole } from "./types";
import { forbidden, notFound } from "./errors";

export const PERMISSIONS = [
  "dashboard:read",
  "leads:read", "leads:write", "leads:assign", "leads:merge", "leads:import", "leads:export", "leads:delete",
  "accounts:read", "accounts:write", "accounts:assign", "accounts:export", "accounts:delete", "accounts:merge",
  "contacts:read", "contacts:write",
  "opportunities:read", "opportunities:write", "opportunities:assign", "opportunities:override_close", "pipeline:configure",
  "activities:read", "activities:write",
  "targets:read", "targets:write", "targets:approve",
  "products:read", "products:write", "pricebooks:write", "cost:read",
  "quotations:read", "quotations:write", "quotations:approve", "quotations:send",
  "orders:read", "orders:write", "orders:approve", "orders:cancel", "orders:fulfil", "payments:record",
  "forecast:read", "forecast:override",
  "performance:read", "leaderboard:read",
  "teams:read", "teams:write",
  "commissions:read", "commissions:write", "commissions:approve", "commissions:pay",
  "retention:read", "retention:write",
  "campaigns:read", "campaigns:write", "campaigns:send",
  "competitors:read", "competitors:write", "competitors:verify",
  "reports:read", "reports:export", "reports:schedule",
  "automation:read", "automation:write", "automation:activate", "automation:run",
  "playbook:read", "playbook:write", "playbook:publish",
  "documents:read", "documents:write", "documents:restricted",
  "settings:read", "settings:write", "fx:write",
  "audit:read",
  "ai:use",
  "agents:read", "agents:run", "agents:manage", "approvals:read", "approvals:decide",
  "members:read", "members:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);
const only = (...p: Permission[]) => new Set<Permission>(p);
const without = (base: Set<Permission>, ...p: Permission[]) => new Set([...base].filter((x) => !p.includes(x)));
const readOf = (...resources: string[]) => PERMISSIONS.filter((p) => resources.some((r) => p === `${r}:read`));

const REPS = new Set<Permission>([
  "dashboard:read", "leads:read", "leads:write", "leads:export", "accounts:read", "accounts:write", "contacts:read", "contacts:write",
  "opportunities:read", "opportunities:write", "activities:read", "activities:write", "targets:read", "products:read",
  "quotations:read", "quotations:write", "quotations:send", "orders:read", "orders:write", "forecast:read",
  "performance:read", "leaderboard:read", "commissions:read", "retention:read", "retention:write", "campaigns:read",
  "competitors:read", "competitors:write", "reports:read", "playbook:read", "documents:read", "documents:write", "ai:use", "teams:read", "agents:read",
]);

const MANAGERS = new Set<Permission>([
  ...REPS,
  "leads:assign", "leads:merge", "leads:import", "accounts:assign", "accounts:export", "opportunities:assign", "opportunities:override_close",
  "targets:write", "quotations:approve", "orders:approve", "orders:cancel", "orders:fulfil", "forecast:override", "reports:export", "reports:schedule",
  "automation:read", "campaigns:write", "playbook:write", "retention:write", "cost:read", "members:read", "teams:write", "documents:restricted",
  "agents:run", "approvals:read", "approvals:decide", "fx:write",
]);

export const ROLE_PERMISSIONS: Record<SalesRole, Set<Permission>> = {
  sales_admin: ALL,
  sales_director: without(ALL, "settings:write", "members:write"),
  sales_manager: MANAGERS,
  sales_rep: REPS,
  sales_analyst: new Set<Permission>([
    ...readOf("dashboard", "leads", "accounts", "contacts", "opportunities", "activities", "targets", "products", "quotations", "orders", "forecast", "performance", "leaderboard", "teams", "commissions", "retention", "campaigns", "competitors", "reports", "automation", "playbook", "documents", "settings", "members"),
    "cost:read", "reports:export", "reports:schedule", "leads:export", "accounts:export", "ai:use", "agents:read", "agents:run", "approvals:read",
  ]),
  finance: new Set<Permission>([
    ...readOf("dashboard", "accounts", "contacts", "opportunities", "products", "quotations", "orders", "forecast", "performance", "targets", "commissions", "reports", "documents", "members", "teams"),
    "cost:read", "payments:record", "orders:fulfil", "commissions:write", "commissions:approve", "commissions:pay", "reports:export", "documents:restricted", "accounts:export", "approvals:read", "approvals:decide",
  ]),
  support_agent: new Set<Permission>([
    "dashboard:read", "accounts:read", "contacts:read", "contacts:write", "activities:read", "activities:write", "orders:read", "retention:read", "retention:write", "playbook:read", "products:read", "documents:read",
  ]),
  readonly_exec: new Set<Permission>([
    ...readOf("dashboard", "leads", "accounts", "contacts", "opportunities", "activities", "targets", "products", "quotations", "orders", "forecast", "performance", "leaderboard", "teams", "commissions", "retention", "campaigns", "competitors", "reports", "playbook", "documents", "members"),
    "cost:read", "reports:export", "agents:read", "approvals:read",
  ]),
};

export const ROLE_SCOPE: Record<SalesRole, RecordScope> = {
  sales_admin: "all",
  sales_director: "all",
  sales_manager: "team",
  sales_rep: "own",
  sales_analyst: "all",
  finance: "all",
  support_agent: "all",
  readonly_exec: "all",
};

export const ROLE_LABELS: Record<SalesRole, string> = {
  sales_admin: "Sales Administrator",
  sales_director: "Sales Director",
  sales_manager: "Sales Manager",
  sales_rep: "Sales Representative",
  sales_analyst: "Sales Operations Analyst",
  finance: "Finance / Accounts Officer",
  support_agent: "Customer Support Agent",
  readonly_exec: "Read-Only Executive",
};

export function can(actor: Pick<Actor, "role">, permission: Permission): boolean {
  return ROLE_PERMISSIONS[actor.role]?.has(permission) ?? false;
}

export function permissionsOf(role: SalesRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}

export function require(actor: Pick<Actor, "role">, permission: Permission): void {
  if (!can(actor, permission)) throw forbidden(`Your role (${ROLE_LABELS[actor.role] ?? actor.role}) cannot perform "${permission}"`, "permission_denied");
}

export function scopeOf(actor: Pick<Actor, "role">): RecordScope {
  return ROLE_SCOPE[actor.role] ?? "own";
}

/**
 * Owner-scope predicate for list/read queries. All ids are validated integers, so inlining them is injection-safe.
 * `column` must be a trusted identifier from the calling module, e.g. "l.owner_id".
 */
export function ownerScopeSql(actor: Actor, column: string): string {
  const scope = scopeOf(actor);
  if (scope === "all") return "TRUE";
  if (scope === "own") return `${column} = ${intId(actor.memberId)}`;
  const ids = [...new Set([actor.memberId, ...actor.teamMemberIds])].map(intId);
  return `${column} IN (${ids.join(",")})`;
}

function intId(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error("Invalid member id in scope");
  return n;
}

/** Can the actor act on a record owned by `ownerId` (null owner = unassigned)? */
export function canAccessOwner(actor: Actor, ownerId: number | null): boolean {
  const scope = scopeOf(actor);
  if (scope === "all") return true;
  if (ownerId === null) return false;
  if (scope === "own") return ownerId === actor.memberId;
  return ownerId === actor.memberId || actor.teamMemberIds.includes(ownerId);
}

/** Throws 404 (not 403) so the existence of out-of-scope records is not revealed (IDOR hardening). */
export function assertOwnerAccess(actor: Actor, ownerId: number | null, what = "Record"): void {
  if (!canAccessOwner(actor, ownerId)) throw notFound(what);
}

/** Strip fields the actor may not see. Mutates and returns the row. */
export function redactCost<T extends Record<string, unknown>>(actor: Pick<Actor, "role">, row: T, fields: string[] = ["cost_price", "unit_cost", "cost_total", "cost", "margin", "margin_percent", "gross_profit"]): T {
  if (can(actor, "cost:read")) return row;
  for (const f of fields) if (f in row) delete (row as Record<string, unknown>)[f];
  return row;
}

export function isManagerial(actor: Pick<Actor, "role">): boolean {
  return ["sales_admin", "sales_director", "sales_manager"].includes(actor.role);
}
