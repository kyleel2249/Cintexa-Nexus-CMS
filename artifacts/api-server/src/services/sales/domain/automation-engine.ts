/**
 * Pure part of the automation engine: rule shape, validation, condition evaluation, cycle detection and
 * idempotency keys. Execution against the database lives in modules/automation.ts and only ever runs rules that
 * passed validateRule().
 */
import { createHash } from "node:crypto";

export const TRIGGERS = {
  "lead.created": "lead",
  "lead.assigned": "lead",
  "lead.uncontacted": "lead",
  "lead.qualified": "lead",
  "opportunity.stage_changed": "opportunity",
  "opportunity.amount_changed": "opportunity",
  "opportunity.close_date_approaching": "opportunity",
  "quotation.pending_approval": "quotation",
  "quotation.expiring": "quotation",
  "order.confirmed": "order",
  "payment.status_changed": "order",
  "activity.overdue": "activity",
  "target.threshold_crossed": "target",
  "account.inactive": "account",
  "renewal.approaching": "renewal",
} as const;
export type Trigger = keyof typeof TRIGGERS;
export const TRIGGER_LIST = Object.keys(TRIGGERS) as Trigger[];

/** Triggers raised by the clock rather than by a user action. */
export const SCHEDULED_TRIGGERS: Trigger[] = ["lead.uncontacted", "opportunity.close_date_approaching", "quotation.expiring", "activity.overdue", "target.threshold_crossed", "account.inactive", "renewal.approaching"];

export const ACTION_TYPES = ["create_task", "assign", "notify", "request_approval", "update_field", "add_tag", "create_reminder", "send_message", "call_integration", "generate_report", "escalate"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Which triggers an action can itself cause (used to find circular rule chains). */
export const ACTION_EMITS: Record<ActionType, Trigger[]> = {
  create_task: [],
  assign: ["lead.assigned"],
  notify: [],
  request_approval: ["quotation.pending_approval"],
  update_field: [],
  add_tag: [],
  create_reminder: [],
  send_message: [],
  call_integration: [],
  generate_report: [],
  escalate: [],
};

/** Actions that touch customers, money or other systems - a rule using them needs approval before activation. */
export const SENSITIVE_ACTIONS: ActionType[] = ["send_message", "call_integration", "generate_report", "request_approval"];

export const UPDATABLE_FIELDS: Record<string, string[]> = {
  lead: ["priority", "next_action", "status"],
  opportunity: ["next_action", "forecast_category", "risks"],
  account: ["classification", "next_engagement_on"],
  quotation: [],
  order: [],
  activity: ["priority"],
  target: [],
  renewal: [],
};

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "is_set", "is_empty"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export interface Action {
  type: ActionType;
  params: Record<string, unknown>;
}

export interface RuleDef {
  id?: number;
  name: string;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  status?: string;
  version?: number;
}

export interface RuleIssue {
  path: string;
  message: string;
}

const FIELD_RE = /^[a-z_][a-z0-9_.]{0,48}$/;

export function entityOf(trigger: Trigger): string {
  return TRIGGERS[trigger];
}

export function validateRule(rule: RuleDef, others: RuleDef[] = []): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });
  if (!rule.name || rule.name.trim().length < 3) bad("name", "Give the rule a name of at least 3 characters");
  if (!(rule.trigger in TRIGGERS)) {
    bad("trigger", `Unknown trigger "${rule.trigger}"`);
    return issues;
  }
  const entity = entityOf(rule.trigger);
  if (rule.conditions.length > 10) bad("conditions", "At most 10 conditions per rule");
  rule.conditions.forEach((c, i) => {
    if (!FIELD_RE.test(c.field)) bad(`conditions[${i}].field`, "Field name is not valid");
    if (!(CONDITION_OPS as readonly string[]).includes(c.op)) bad(`conditions[${i}].op`, `Unknown operator "${c.op}"`);
    if (!["is_set", "is_empty"].includes(c.op) && c.value === undefined) bad(`conditions[${i}].value`, "A comparison value is required");
    if (c.op === "in" && !Array.isArray(c.value)) bad(`conditions[${i}].value`, "'in' needs a list of values");
  });
  if (!rule.actions.length) bad("actions", "Add at least one action");
  if (rule.actions.length > 5) bad("actions", "At most 5 actions per rule");
  rule.actions.forEach((a, i) => {
    const p = `actions[${i}]`;
    if (!(ACTION_TYPES as readonly string[]).includes(a.type)) return bad(`${p}.type`, `Unknown action "${a.type}"`);
    const params = a.params ?? {};
    switch (a.type) {
      case "create_task":
      case "create_reminder":
        if (typeof params.subject !== "string" || params.subject.trim().length < 2) bad(`${p}.params.subject`, "A task subject is required");
        if (params.dueInDays !== undefined && (!Number.isInteger(params.dueInDays) || (params.dueInDays as number) < 0 || (params.dueInDays as number) > 365)) bad(`${p}.params.dueInDays`, "Due days must be 0-365");
        break;
      case "assign":
        if (params.to !== "round_robin" && params.to !== "territory" && !Number.isInteger(params.to)) bad(`${p}.params.to`, "Choose a member, round_robin or territory");
        if (entity !== "lead" && entity !== "opportunity" && entity !== "account") bad(p, "Assign works on leads, opportunities and accounts only");
        break;
      case "notify":
        if (typeof params.title !== "string" || params.title.trim().length < 2) bad(`${p}.params.title`, "A notification title is required");
        break;
      case "update_field": {
        const allowed = UPDATABLE_FIELDS[entity] ?? [];
        if (typeof params.field !== "string" || !allowed.includes(params.field)) bad(`${p}.params.field`, allowed.length ? `Allowed fields for ${entity}: ${allowed.join(", ")}` : `${entity} records cannot be updated by automation`);
        if (params.value === undefined) bad(`${p}.params.value`, "A value is required");
        break;
      }
      case "add_tag":
        if (typeof params.tag !== "string" || !/^[\w -]{1,40}$/.test(params.tag)) bad(`${p}.params.tag`, "Tag must be 1-40 letters, digits, spaces, - or _");
        if (entity !== "account") bad(p, "Tags are supported on accounts only");
        break;
      case "send_message":
        if (params.channel !== "email" && params.channel !== "whatsapp") bad(`${p}.params.channel`, "Channel must be email or whatsapp");
        if (typeof params.template !== "string" || params.template.trim().length < 2) bad(`${p}.params.template`, "A message template is required");
        break;
      case "call_integration":
        if (typeof params.name !== "string" || !/^[a-z][a-z0-9_.-]{1,40}$/.test(params.name)) bad(`${p}.params.name`, "Integration name is required");
        break;
      case "generate_report":
        if (typeof params.report !== "string" || !params.report) bad(`${p}.params.report`, "Choose a report");
        break;
      case "escalate":
        if (params.to !== "manager" && params.to !== "director") bad(`${p}.params.to`, "Escalate to manager or director");
        break;
      case "request_approval":
        if (entity !== "quotation" && entity !== "order") bad(p, "Approvals apply to quotations and orders");
        break;
    }
  });
  // circular chains: this rule + other active rules form a graph  A --emits--> B.trigger
  const cycle = findCycle([...others.filter((o) => o.id === undefined || o.id !== rule.id), rule]);
  if (cycle) bad("actions", `This rule would create a circular workflow: ${cycle.join(" → ")}`);
  return issues;
}

/** Find a cycle in the rule graph (rule X → rule Y when an action of X can raise Y's trigger). */
export function findCycle(rules: RuleDef[]): string[] | null {
  const nodes = rules.map((r, i) => ({ key: `${r.name} (#${r.id ?? "new" + i})`, r }));
  const edges = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const emitted = new Set(n.r.actions.flatMap((a) => ACTION_EMITS[a.type] ?? []));
    edges.set(i, nodes.map((m, j) => (emitted.has(m.r.trigger) ? j : -1)).filter((j) => j >= 0));
  });
  const state = new Map<number, 0 | 1 | 2>();
  const stack: number[] = [];
  const dfs = (u: number): string[] | null => {
    state.set(u, 1);
    stack.push(u);
    for (const w of edges.get(u) ?? []) {
      if (state.get(w) === 1) return [...stack.slice(stack.indexOf(w)), w].map((i) => nodes[i]!.key);
      if (!state.get(w)) {
        const c = dfs(w);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(u, 2);
    return null;
  };
  for (let i = 0; i < nodes.length; i++) if (!state.get(i)) {
    const c = dfs(i);
    if (c) return c;
  }
  return null;
}

function getPath(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function evaluateCondition(c: Condition, ctx: Record<string, unknown>): boolean {
  const actual = getPath(ctx, c.field);
  const empty = actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0);
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN);
  switch (c.op) {
    case "is_set": return !empty;
    case "is_empty": return empty;
    case "eq": return String(actual) === String(c.value);
    case "neq": return String(actual) !== String(c.value);
    case "gt": return num(actual) > num(c.value);
    case "gte": return num(actual) >= num(c.value);
    case "lt": return num(actual) < num(c.value);
    case "lte": return num(actual) <= num(c.value);
    case "in": return Array.isArray(c.value) && c.value.map(String).includes(String(actual));
    case "contains": return typeof actual === "string" ? actual.toLowerCase().includes(String(c.value).toLowerCase()) : Array.isArray(actual) && actual.map(String).includes(String(c.value));
  }
}

export function evaluateConditions(conds: Condition[], ctx: Record<string, unknown>): boolean {
  return conds.every((c) => evaluateCondition(c, ctx));
}

/** Replace {{path}} with values from ctx. Unknown paths become empty. Output is plain text (escaped by the UI). */
export function renderTemplate(text: string, ctx: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([a-z_][a-z0-9_.]{0,48})\s*\}\}/gi, (_, p: string) => {
    const v = getPath(ctx, p);
    return v === undefined || v === null ? "" : typeof v === "object" ? "" : String(v);
  });
}

/** Stable per-event key: the same event can never run the same rule version twice, a later event runs again. */
export function runKey(rule: { id: number; version: number }, trigger: string, entityType: string, entityId: number, eventKey: string): string {
  return createHash("sha256").update(`${rule.id}:${rule.version}:${trigger}:${entityType}:${entityId}:${eventKey}`).digest("hex").slice(0, 48);
}
