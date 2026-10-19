import type { Actor, Queryable } from "../core/types";
import { ownerScopeSql, assertOwnerAccess } from "../core/rbac";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit } from "../core/audit";
import { escapeLike } from "../core/validate";

/** Parameterised WHERE builder: `?` placeholders become $n, values are never concatenated into SQL. */
export class Where {
  private parts: string[] = [];
  readonly params: unknown[] = [];
  and(sql: string, ...values: unknown[]): this {
    let i = 0;
    const text = sql.replace(/\?/g, () => {
      this.params.push(values[i++]);
      return `$${this.params.length}`;
    });
    this.parts.push(`(${text})`);
    return this;
  }
  raw(sql: string): this {
    this.parts.push(`(${sql})`);
    return this;
  }
  /** ILIKE on several columns with escaped wildcards */
  search(term: string | undefined, columns: string[]): this {
    if (!term) return this;
    this.params.push(`%${escapeLike(term)}%`);
    const p = `$${this.params.length}`;
    this.parts.push(`(${columns.map((c) => `${c} ILIKE ${p} ESCAPE '\\'`).join(" OR ")})`);
    return this;
  }
  get sql(): string {
    return this.parts.length ? this.parts.join(" AND ") : "TRUE";
  }
  /** index of the next placeholder (for appending LIMIT/OFFSET) */
  next(): number {
    return this.params.length + 1;
  }
}

/** Load a row by id, hiding rows outside the actor's scope as 404 (no existence leak). */
export async function loadOwned<T extends { owner_id: number | null }>(q: Queryable, actor: Actor, table: string, id: number, what: string, opts: { forUpdate?: boolean; ownerColumn?: string; extraWhere?: string } = {}): Promise<T> {
  assertTable(table);
  const r = await q.query<T>(`SELECT * FROM ${table} WHERE id = $1 ${opts.extraWhere ? `AND ${opts.extraWhere}` : ""} ${opts.forUpdate ? "FOR UPDATE" : ""}`, [id]);
  const row = r.rows[0];
  if (!row) throw notFound(what);
  assertOwnerAccess(actor, (row as any)[opts.ownerColumn ?? "owner_id"] ?? null, what);
  return row;
}

const TABLES = new Set([
  "sales_leads", "sales_accounts", "sales_contacts", "sales_opportunities", "sales_quotations", "sales_orders", "sales_activities", "sales_members", "sales_teams",
  "sales_products", "sales_campaigns", "sales_competitors", "sales_territories", "sales_targets", "sales_playbook_articles", "sales_commission_plans", "sales_automation_rules",
]);
function assertTable(t: string) {
  if (!TABLES.has(t)) throw new Error(`Table ${t} is not allowed here`);
}

export const scopeSql = ownerScopeSql;

/** Record an ownership change with who/why, and write the audit event. */
export async function changeOwner(q: Queryable, actor: Actor, entityType: "lead" | "account" | "opportunity", table: string, id: number, toOwnerId: number | null, reason: string | undefined, requestId: string): Promise<void> {
  assertTable(table);
  if (toOwnerId !== null) {
    const m = await q.query("SELECT id FROM sales_members WHERE id = $1 AND active", [toOwnerId]);
    if (!m.rows[0]) throw badRequest("The selected owner is not an active sales member");
  }
  const cur = await q.query<{ owner_id: number | null }>(`SELECT owner_id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  if (!cur.rows[0]) throw notFound(entityType);
  if ((cur.rows[0].owner_id ?? null) === toOwnerId) return;
  await q.query(`UPDATE ${table} SET owner_id = $2, updated_at = now() WHERE id = $1`, [id, toOwnerId]);
  await q.query("INSERT INTO sales_ownership_history (entity_type, entity_id, from_owner_id, to_owner_id, changed_by, reason) VALUES ($1,$2,$3,$4,$5,$6)", [entityType, id, cur.rows[0].owner_id, toOwnerId, actor.label, reason ?? null]);
  await audit(q, actor, { action: `${entityType}.reassign`, entityType, entityId: id, summary: `Owner changed from ${cur.rows[0].owner_id ?? "unassigned"} to ${toOwnerId ?? "unassigned"}${reason ? ` (${reason})` : ""}`, before: { owner_id: cur.rows[0].owner_id }, after: { owner_id: toOwnerId } }, requestId);
}

/** Build a dynamic UPDATE from a validated patch, whitelisting columns. Returns null when nothing to change. */
export function buildUpdate(patch: Record<string, unknown>, allowed: Record<string, string>, startAt = 2): { set: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(allowed)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${col} = $${startAt + params.length - 1}`);
  }
  if (!sets.length) return null;
  return { set: sets.join(", "), params };
}

export function rowOrConflict<T>(row: T | undefined, message: string): T {
  if (!row) throw conflict(message);
  return row;
}

/** ::text[] literal from a JS string array via JSON (no array bind params - portable across drivers) */
export const textArrayParam = (xs: string[]): string => JSON.stringify(xs);
export const TEXT_ARRAY = (p: string) => `ARRAY(SELECT jsonb_array_elements_text(${p}::text::jsonb))`;

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Lightweight in-process hook registry so modules can react to order lifecycle changes inside the same
 * transaction (e.g. commissions) without importing each other.
 */
export interface OrderHookCtx { now: Date; actor: Actor; requestId: string }
type OrderHook = (q: Queryable, orderId: number, ctx: OrderHookCtx) => Promise<void>;
export const orderHooks: { booked: OrderHook[]; cancelled: OrderHook[]; returned: OrderHook[]; paid: OrderHook[] } = { booked: [], cancelled: [], returned: [], paid: [] };
