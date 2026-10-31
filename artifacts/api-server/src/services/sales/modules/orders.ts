import { v, parse } from "../core/validate";
import { created, type Route, type DomainEvent } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, forbidden, unprocessable } from "../core/errors";
import { audit } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { redactCost, can } from "../core/rbac";
import { pageOf, orderBy, str, d10 } from "../core/http";
import { evaluateApproval, approverCanApprove, type ApprovalFinding } from "../domain/pricing";
import { assertTransition, ORDER_TRANSITIONS } from "../domain/state-machines";
import { effectiveDiscountPercent, cmp, sub, add, sum, proportion } from "../core/money";
import { businessDate } from "../core/time";
import { enqueue } from "../integrations/outbox";
import type { OrderPayload } from "../integrations/providers";
import { Where, scopeSql, loadOwned, orderHooks } from "./common";
import { visibleAccount } from "./accounts";
import { buildLines, openExposure } from "./quotations";
import { notify } from "./activities";
import type { Actor, Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

const lineIn = v.object({
  product_id: v.optional(v.id()), description: v.optional(v.string({ min: 1, max: 500 })), quantity: v.number({ min: 0.0001, max: 1e9 }), unit_price: v.optional(v.money()),
  discount_percent: v.withDefault(v.number({ min: 0, max: 100 }), 0), discount_amount: v.optional(v.money()), tax_rate: v.optional(v.number({ min: 0, max: 100 })),
});
const createBody = v.object({
  account_id: v.id(), contact_id: v.optional(v.id()), opportunity_id: v.optional(v.id()), currency: v.optional(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ })), channel: v.withDefault(v.string({ min: 2, max: 30 }), "direct"),
  campaign_id: v.optional(v.id()), payment_terms_days: v.optional(v.int({ min: 0, max: 365 })), requested_delivery_on: v.optional(v.date()), billing_address: v.optional(v.string({ max: 500 })), shipping_address: v.optional(v.string({ max: 500 })),
  notes: v.optional(v.string({ max: 4000, raw: true })), client_request_id: v.optional(v.string({ min: 8, max: 80, pattern: /^[A-Za-z0-9_\-.:]+$/ })), lines: v.array(lineIn, { min: 1, max: 200 }),
  /** when the sale actually happened (past or future); created_at always keeps the real entry time */
  transaction_date: v.optional(v.date()),
});
const convertBody = v.object({ requested_delivery_on: v.optional(v.date()), billing_address: v.optional(v.string({ max: 500 })), shipping_address: v.optional(v.string({ max: 500 })), notes: v.optional(v.string({ max: 4000, raw: true })), client_request_id: v.optional(v.string({ min: 8, max: 80 })) });
const patchBody = v.object({
  contact_id: v.nullable(v.id()), requested_delivery_on: v.nullable(v.date()), billing_address: v.nullable(v.string({ max: 500 })), shipping_address: v.nullable(v.string({ max: 500 })), notes: v.nullable(v.string({ max: 4000, raw: true })),
  payment_terms_days: v.optional(v.int({ min: 0, max: 365 })), lines: v.optional(v.array(lineIn, { min: 1, max: 200 })),
});

const LIST = `o.id, o.number, o.status, o.account_id, a.name AS account_name, o.owner_id, m.display_name AS owner_name, o.currency, o.total, o.paid_total, o.payment_status, o.invoice_status, o.inventory_status, o.booked_at, o.created_at, o.requires_approval`;
const FROM = `FROM sales_orders o JOIN sales_accounts a ON a.id = o.account_id LEFT JOIN sales_members m ON m.id = o.owner_id`;

async function loadOrder(q: Queryable, actor: Actor, id: number, forUpdate = false): Promise<any> {
  return loadOwned<any>(q, actor, "sales_orders", id, "Order", { forUpdate });
}

async function payloadOf(q: Queryable, o: any): Promise<OrderPayload> {
  const lines = (await q.query<any>("SELECT l.product_id, l.description, l.quantity::text, l.unit_price::text, p.sku FROM sales_order_lines l LEFT JOIN sales_products p ON p.id = l.product_id WHERE l.order_id = $1 ORDER BY l.position", [o.id])).rows;
  return { orderId: o.id, number: o.number, accountId: o.account_id, currency: o.currency, total: o.total, dueOn: o.invoice_due_on ? d10(o.invoice_due_on) : null, lines: lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, productId: l.product_id })) };
}

async function writeOrderLines(q: Queryable, orderId: number, lines: Awaited<ReturnType<typeof buildLines>>["lines"]): Promise<void> {
  await q.query("DELETE FROM sales_order_lines WHERE order_id = $1", [orderId]);
  for (const l of lines) {
    await q.query(`INSERT INTO sales_order_lines (order_id, position, product_id, description, quantity, unit_price, discount_percent, discount_amount, tax_rate, unit_cost, gross, discount, net, tax, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [orderId, l.position, l.product_id, l.description, l.quantity, l.unit_price, l.discount_percent, l.discount_amount, l.tax_rate, l.unit_cost, l.gross, l.discount, l.net, l.tax, l.total]);
  }
}

async function writeOrderTotals(q: Queryable, id: number, t: Awaited<ReturnType<typeof buildLines>>["totals"]): Promise<void> {
  await q.query(`UPDATE sales_orders SET subtotal=$2, discount_total=$3, net_total=$4, tax_total=$5, total=$6, cost_total=$7, gross_profit=$8, updated_at=now() WHERE id = $1`,
    [id, t.subtotal, t.discountTotal, t.netTotal, t.taxTotal, t.total, t.costTotal, t.marginTotal]);
}

async function recomputePayment(q: Queryable, orderId: number): Promise<{ paid: string; status: string }> {
  const r = await q.query<{ paid: string }>("SELECT COALESCE(sum(amount),0)::numeric(18,2)::text AS paid FROM sales_order_payments WHERE order_id = $1 AND status = 'recorded'", [orderId]);
  const o = (await q.query<{ total: string }>("SELECT total::text FROM sales_orders WHERE id = $1", [orderId])).rows[0]!;
  const paid = r.rows[0]!.paid;
  const status = cmp(paid, "0.00") === 0 ? "unpaid" : cmp(paid, o.total) >= 0 ? "paid" : "partial";
  await q.query("UPDATE sales_orders SET paid_total = $2, payment_status = $3, updated_at = now() WHERE id = $1", [orderId, paid, status]);
  return { paid, status };
}

/** Evaluate approval policy for an order and either hold it for approval or confirm it. */
async function confirmOrApprove(q: Queryable, actor: Actor, c: { now: Date; settings: SalesSettings; requestId: string; events: DomainEvent[]; asApprover?: boolean }, o: any): Promise<{ status: string; findings: ApprovalFinding[] }> {
  const lines = (await q.query<any>("SELECT gross, discount, unit_price FROM sales_order_lines WHERE order_id = $1", [o.id])).rows;
  if (!lines.length) throw unprocessable("An order needs at least one line", "no_lines");
  const acct = (await q.query<any>("SELECT credit_limit::text, payment_terms_days FROM sales_accounts WHERE id = $1", [o.account_id])).rows[0];
  const owner = o.owner_id ? (await q.query<{ role: any }>("SELECT role FROM sales_members WHERE id = $1", [o.owner_id])).rows[0] : null;
  const maxDisc = lines.reduce((m, l) => Math.max(m, effectiveDiscountPercent(l.gross, l.discount)), 0);
  const margin = o.cost_total !== null && cmp(o.net_total, "0.00") > 0 ? Math.round(Number(sub(o.net_total, o.cost_total)) / Number(o.net_total) * 10000) / 100 : null;
  // a quotation that was already approved covers its own discount/margin findings; credit and threshold are rechecked now
  const findings = evaluateApproval({ ownerRole: owner?.role ?? actor.role, maxLineDiscountPercent: o.quotation_id ? 0 : maxDisc, marginPercent: o.quotation_id ? null : margin, total: o.total, creditLimit: acct?.credit_limit ?? null, openExposure: await openExposure(q, o.account_id, o.currency), belowList: false }, c.settings.discounts, c.settings.orders);
  if (findings.length && !c.asApprover) {
    await q.query("UPDATE sales_orders SET status = 'pending_approval', requires_approval = TRUE, approval_reasons = $2::text::jsonb, updated_at = now() WHERE id = $1", [o.id, JSON.stringify(findings)]);
    const approvers = (await q.query<{ id: number }>("SELECT id FROM sales_members WHERE active AND role IN ('sales_manager','sales_director','sales_admin','finance') AND id <> $1", [actor.memberId])).rows;
    for (const a of approvers) await notify(q, a.id, { kind: "approval", title: `Order approval needed: ${o.number}`, body: findings.map((f) => f.message).join("; "), link: `/sales/orders/${o.id}`, severity: "warning", dedupeKey: `order-approval:${o.id}` });
    return { status: "pending_approval", findings };
  }
  await bookOrder(q, actor, c, o, findings.length ? actor.label : null);
  return { status: "confirmed", findings };
}

async function bookOrder(q: Queryable, actor: Actor, c: { now: Date; settings: SalesSettings; requestId: string; events: DomainEvent[] }, o: any, approvedBy: string | null): Promise<void> {
  const terms = o.payment_terms_days ?? 30;
  // Transaction date vs entry date: a person may record a sale that happened earlier. The order is booked ON that date (so every report places it in the right period); created_at keeps the real entry time.
  const txn: string | null = d10(o.transaction_date);
  if (txn && txn > businessDate(c.now, c.settings.business.timezone)) throw conflict("This order is dated in the future, so it cannot be booked as a sale yet. Confirm it on or after its transaction date, or clear the date.", "future_transaction_date");
  const bookedAt = txn ? new Date(`${txn}T12:00:00.000Z`) : c.now;
  const due = new Date(bookedAt.getTime() + terms * 86_400_000).toISOString().slice(0, 10);
  const stockLines = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_order_lines l JOIN sales_products p ON p.id = l.product_id WHERE l.order_id = $1 AND p.track_stock", [o.id])).rows[0]!.n;
  const invCfg = c.settings.integrations.inventory;
  const invStatus = stockLines === 0 ? "not_requested" : invCfg.enabled && invCfg.provider !== "none" ? "pending" : "unavailable";
  await q.query(`UPDATE sales_orders SET status = 'confirmed', booked_at = $2, confirmed_at = $2, approved_by = COALESCE($3, approved_by), approved_at = CASE WHEN $3 IS NULL THEN approved_at ELSE $2::timestamptz END,
    requires_approval = requires_approval OR $3 IS NOT NULL, invoice_due_on = $4, inventory_status = $5, updated_at = now() WHERE id = $1`, [o.id, bookedAt.toISOString(), approvedBy, due, invStatus]);
  const fresh = (await q.query<any>("SELECT * FROM sales_orders WHERE id = $1", [o.id])).rows[0];
  if (stockLines > 0) await enqueue(q, { kind: "inventory.reserve", entityType: "order", entityId: o.id, idempotencyKey: `order-reserve:${o.id}`, payload: { order: await payloadOf(q, fresh) } });
  await q.query("UPDATE sales_accounts SET last_purchase_at = $2, status = CASE WHEN status IN ('prospect','inactive') THEN 'active' ELSE status END, expected_reorder_on = CASE WHEN reorder_interval_days IS NOT NULL THEN ($2::timestamptz + (reorder_interval_days || ' days')::interval)::date ELSE expected_reorder_on END, updated_at = now() WHERE id = $1", [o.account_id, c.now.toISOString()]);
  for (const h of orderHooks.booked) await h(q, o.id, { now: c.now, actor, requestId: c.requestId });
  c.events.push({ type: "order.confirmed", entityType: "order", entityId: o.id } as DomainEvent);
}

export const orderRoutes: Route[] = [
  {
    method: "GET", path: "/orders", permission: "orders:read",
    async handler({ q, actor, query }) {
      const w = new Where().raw(scopeSql(actor, "o.owner_id"));
      w.search(str(query, "q"), ["o.number", "a.name"]);
      for (const k of ["status", "payment_status", "invoice_status"]) if (str(query, k)) w.and(`o.${k} = ?`, str(query, k));
      if (str(query, "account_id")) w.and("o.account_id = ?", parse(v.id(), str(query, "account_id")));
      if (str(query, "owner_id")) w.and("o.owner_id = ?", parse(v.id(), str(query, "owner_id")));
      if (str(query, "overdue") === "true") w.raw("o.payment_status IN ('unpaid','partial') AND o.invoice_due_on < CURRENT_DATE AND o.status <> 'cancelled'");
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { created: "o.created_at", total: "o.total", number: "o.number", booked: "o.booked_at" }, "created");
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n ${FROM} WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query(`SELECT ${LIST} ${FROM} WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      return { items: r.rows, total, page, pageSize };
    },
  },
  {
    method: "POST", path: "/orders", permission: "orders:write", idempotent: true,
    async handler({ q, actor, body, now, settings, requestId, events }) {
      const b = parse(createBody, body);
      const account = await visibleAccount(q, actor, b.account_id);
      if (b.client_request_id) {
        const ex = (await q.query<any>("SELECT id, number FROM sales_orders WHERE client_request_id = $1", [b.client_request_id])).rows[0];
        if (ex) return { id: ex.id, number: ex.number, duplicateRequest: true };
      }
      const currency = b.currency ?? account.currency ?? settings.business.currency;
      if (b.contact_id && !(await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", [b.contact_id, b.account_id])).rows[0]) throw badRequest("The contact does not belong to this account");
      if (b.opportunity_id) {
        const o = await loadOwned<any>(q, actor, "sales_opportunities", b.opportunity_id, "Opportunity", { extraWhere: "archived_at IS NULL" });
        if (o.account_id !== b.account_id) throw badRequest("The opportunity belongs to a different account");
      }
      const built = await buildLines(q, { accountId: b.account_id, currency, now, settings }, b.lines);
      const number = await nextNumber(q, "order", now, { yearly: settings.numbering.yearly, prefix: settings.numbering.orderPrefix });
      const team = actor.memberId ? (await q.query<{ team_id: number | null }>("SELECT team_id FROM sales_members WHERE id = $1", [actor.memberId])).rows[0]?.team_id ?? null : null;
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_orders (number, account_id, contact_id, opportunity_id, owner_id, team_id, territory_id, campaign_id, channel, currency, payment_terms_days, requested_delivery_on, billing_address, shipping_address, notes, client_request_id, created_by, transaction_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [number, b.account_id, b.contact_id ?? null, b.opportunity_id ?? null, actor.memberId || account.owner_id || null, team, account.territory_id ?? null, b.campaign_id ?? null, b.channel, currency, b.payment_terms_days ?? account.payment_terms_days ?? 30, b.requested_delivery_on ?? null, b.billing_address ?? null, b.shipping_address ?? null, b.notes ?? null, b.client_request_id ?? null, actor.label, b.transaction_date ?? null],
      );
      const id = r.rows[0]!.id;
      await writeOrderLines(q, id, built.lines);
      await writeOrderTotals(q, id, built.totals);
      await audit(q, actor, { action: "order.create", entityType: "order", entityId: id, summary: `Created order ${number} (${built.totals.total} ${currency})` }, requestId);
      events.push({ type: "order.created", entityType: "order", entityId: id } as DomainEvent);
      return created({ id, number, total: built.totals.total });
    },
  },
  {
    method: "POST", path: "/quotations/:id/convert", permission: "orders:write", idempotent: true,
    async handler({ q, actor, params, body, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(convertBody, body ?? {});
      const x = await loadOwned<any>(q, actor, "sales_quotations", id, "Quotation", { forUpdate: true });
      if (x.status !== "accepted") throw unprocessable(`Only an accepted quotation can become an order (this one is ${x.status}).`, "not_accepted");
      const existing = (await q.query<any>("SELECT id, number FROM sales_orders WHERE quotation_id = $1 AND status <> 'cancelled'", [id])).rows[0];
      if (existing) throw conflict(`Order ${existing.number} was already created from this quotation`, "already_converted", { order_id: existing.id });
      const account = await visibleAccount(q, actor, x.account_id);
      const number = await nextNumber(q, "order", now, { yearly: settings.numbering.yearly, prefix: settings.numbering.orderPrefix });
      const team = x.owner_id ? (await q.query<{ team_id: number | null }>("SELECT team_id FROM sales_members WHERE id = $1", [x.owner_id])).rows[0]?.team_id ?? null : null;
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_orders (number, account_id, contact_id, quotation_id, opportunity_id, owner_id, team_id, territory_id, currency, payment_terms_days, requested_delivery_on, billing_address, shipping_address, notes, client_request_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [number, x.account_id, x.contact_id, id, x.opportunity_id, x.owner_id ?? actor.memberId, team, account.territory_id ?? null, x.currency, x.payment_terms_days, b.requested_delivery_on ?? null, b.billing_address ?? null, b.shipping_address ?? null, b.notes ?? x.notes, b.client_request_id ?? null, actor.label],
      ).catch((e: any) => { if (e?.code === "23505") throw conflict("An order was already created from this quotation", "already_converted"); throw e; });
      const oid = r.rows[0]!.id;
      await q.query(`INSERT INTO sales_order_lines (order_id, position, product_id, description, quantity, unit_price, discount_percent, discount_amount, tax_rate, unit_cost, gross, discount, net, tax, total)
        SELECT $2, position, product_id, description, quantity, unit_price, discount_percent, discount_amount, tax_rate, unit_cost, gross, discount, net, tax, total FROM sales_quotation_lines WHERE quotation_id = $1`, [id, oid]);
      await q.query(`UPDATE sales_orders SET subtotal=$2, discount_total=$3, net_total=$4, tax_total=$5, total=$6, cost_total=$7, gross_profit = CASE WHEN $7::numeric IS NULL THEN NULL ELSE $4::numeric - $7::numeric END WHERE id = $1`, [oid, x.subtotal, x.discount_total, x.net_total, x.tax_total, x.total, x.cost_total]);
      await audit(q, actor, { action: "order.create", entityType: "order", entityId: oid, summary: `Created order ${number} from quotation ${x.number} v${x.version}` }, requestId);
      events.push({ type: "order.created", entityType: "order", entityId: oid } as DomainEvent);
      return created({ id: oid, number, total: x.total });
    },
  },
  {
    method: "GET", path: "/orders/:id", permission: "orders:read",
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const o = await loadOrder(q, actor, id);
      const lines = (await q.query<any>("SELECT l.*, p.sku FROM sales_order_lines l LEFT JOIN sales_products p ON p.id = l.product_id WHERE l.order_id = $1 ORDER BY l.position", [id])).rows;
      const payments = (await q.query("SELECT id, amount, method, reference, received_on, source, status, recorded_by, at FROM sales_order_payments WHERE order_id = $1 ORDER BY at", [id])).rows;
      const fulfilments = (await q.query("SELECT f.id, f.line_id, f.quantity, f.reference, f.source, f.recorded_by, f.at FROM sales_order_fulfilments f WHERE f.order_id = $1 ORDER BY f.at", [id])).rows;
      const returns = (await q.query("SELECT id, line_id, quantity, reason, credit_amount, recorded_by, at FROM sales_order_returns WHERE order_id = $1 ORDER BY at", [id])).rows;
      const queue = (await q.query("SELECT kind, status, attempts, last_error, provider_ref, created_at, sent_at FROM sales_outbox WHERE entity_type = 'order' AND entity_id = $1::text ORDER BY id", [String(id)])).rows;
      const account = (await q.query("SELECT id, name, number FROM sales_accounts WHERE id = $1", [o.account_id])).rows[0];
      const outstanding = sub(o.total, o.paid_total);
      return {
        order: redactCost(actor, { ...o }), lines: lines.map((l) => redactCost(actor, l)), payments, fulfilments, returns, integrations: queue, account, outstanding,
        statusNotes: {
          inventory: o.inventory_status === "unavailable" ? "Not connected: stock was not reserved by any system." : undefined,
          invoice: o.invoice_status === "unavailable" ? "Not connected: no finance system issued an invoice." : undefined,
        },
      };
    },
  },
  {
    method: "PATCH", path: "/orders/:id", permission: "orders:write",
    async handler({ q, actor, params, body, now, settings, requestId }) {
      const id = parse(v.id(), params.id);
      const o = await loadOrder(q, actor, id, true);
      const b = parse(patchBody, body);
      const logistics = ["requested_delivery_on", "billing_address", "shipping_address", "notes"] as const;
      const onlyLogistics = Object.keys(b).every((k) => (logistics as readonly string[]).includes(k));
      if (o.status !== "draft" && !(onlyLogistics && ["confirmed", "processing"].includes(o.status))) throw conflict(`A ${o.status} order can only have its delivery details and notes changed`, "order_locked");
      if (b.contact_id && !(await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", [b.contact_id, o.account_id])).rows[0]) throw badRequest("The contact does not belong to this account");
      const sets: string[] = [];
      const p: unknown[] = [id];
      for (const k of ["contact_id", "requested_delivery_on", "billing_address", "shipping_address", "notes", "payment_terms_days"] as const) if ((b as any)[k] !== undefined) { p.push((b as any)[k]); sets.push(`${k} = $${p.length}`); }
      if (sets.length) await q.query(`UPDATE sales_orders SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, p);
      if (b.lines) {
        const built = await buildLines(q, { accountId: o.account_id, currency: o.currency, now, settings }, b.lines);
        await writeOrderLines(q, id, built.lines);
        await writeOrderTotals(q, id, built.totals);
      }
      await audit(q, actor, { action: "order.update", entityType: "order", entityId: id, summary: `Edited ${o.number}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/orders/:id/confirm", permission: "orders:write", idempotent: true,
    async handler({ q, actor, params, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const o = await loadOrder(q, actor, id, true);
      if (o.status === "confirmed") return { ok: true, status: "confirmed", already: true };
      assertTransition("order", ORDER_TRANSITIONS, o.status, "confirmed");
      if (o.status === "pending_approval") throw conflict("This order is waiting for approval", "pending_approval");
      const res = await confirmOrApprove(q, actor, { now, settings, requestId, events }, o);
      await audit(q, actor, { action: "order.confirm", entityType: "order", entityId: id, summary: res.status === "confirmed" ? `Confirmed ${o.number}` : `${o.number} needs approval: ${res.findings.map((f) => f.code).join(", ")}`, after: res.findings }, requestId);
      return { ok: true, ...res };
    },
  },
  {
    method: "POST", path: "/orders/:id/approve", permission: "orders:approve", idempotent: true,
    async handler({ q, actor, params, body, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ comment: v.optional(v.string({ max: 500 })) }), body ?? {});
      const o = await loadOrder(q, actor, id, true);
      if (o.status !== "pending_approval") throw conflict(`This order is ${o.status}, not waiting for approval`, "invalid_state");
      if (o.created_by === actor.label && actor.role !== "sales_admin") throw forbidden("You cannot approve your own order", "self_approval");
      const findings = (o.approval_reasons ?? []) as ApprovalFinding[];
      const lines = (await q.query<any>("SELECT gross, discount FROM sales_order_lines WHERE order_id = $1", [id])).rows;
      const maxDisc = lines.reduce((m, l) => Math.max(m, effectiveDiscountPercent(l.gross, l.discount)), 0);
      const ok = approverCanApprove(actor.role, findings, maxDisc, settings.discounts);
      if (!ok.ok) throw forbidden(ok.reason ?? "You cannot approve this order", "approval_limit");
      await bookOrder(q, actor, { now, settings, requestId, events }, o, actor.label);
      if (o.owner_id) await notify(q, o.owner_id, { kind: "approval", title: `${o.number} approved`, body: b.comment, link: `/sales/orders/${id}`, dedupeKey: `order-approved:${id}` });
      await audit(q, actor, { action: "order.approve", entityType: "order", entityId: id, summary: `Approved and confirmed ${o.number}`, after: { comment: b.comment } }, requestId);
      return { ok: true, status: "confirmed" };
    },
  },
  {
    method: "POST", path: "/orders/:id/reject-approval", permission: "orders:approve",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ comment: v.string({ min: 3, max: 500 }) }), body);
      const o = await loadOrder(q, actor, id, true);
      if (o.status !== "pending_approval") throw conflict(`This order is ${o.status}`, "invalid_state");
      await q.query("UPDATE sales_orders SET status = 'draft', requires_approval = FALSE, updated_at = now() WHERE id = $1", [id]);
      if (o.owner_id) await notify(q, o.owner_id, { kind: "approval", title: `${o.number} was not approved`, body: b.comment, link: `/sales/orders/${id}`, severity: "warning", dedupeKey: `order-rejected:${id}:${Date.now()}` });
      await audit(q, actor, { action: "order.approval_rejected", entityType: "order", entityId: id, summary: `Rejected approval for ${o.number}: ${b.comment}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/orders/:id/request-invoice", permission: "orders:fulfil", idempotent: true,
    async handler({ q, actor, params, settings, requestId }) {
      const id = parse(v.id(), params.id);
      const o = await loadOrder(q, actor, id, true);
      if (!["confirmed", "processing", "partially_fulfilled", "fulfilled", "completed"].includes(o.status)) throw conflict("Confirm the order before requesting an invoice", "invalid_state");
      if (o.invoice_status === "issued") return { ok: true, status: "issued", already: true };
      const fin = settings.integrations.finance;
      await enqueue(q, { kind: "finance.invoice", entityType: "order", entityId: id, idempotencyKey: `order-invoice:${id}`, payload: { order: await payloadOf(q, o) } });
      const status = fin.enabled && fin.provider !== "none" ? "pending" : "unavailable";
      await q.query("UPDATE sales_orders SET invoice_status = $2, updated_at = now() WHERE id = $1 AND invoice_status <> 'issued'", [id, status]);
      await audit(q, actor, { action: "order.request_invoice", entityType: "order", entityId: id, summary: status === "pending" ? `Invoice requested for ${o.number}` : `Invoice requested for ${o.number} but no finance system is connected` }, requestId);
      return { ok: true, status, note: status === "unavailable" ? "No finance system is connected, so no invoice was issued. The request is kept and will run when one is connected." : "Invoice requested. It is marked issued only after the finance system confirms." };
    },
  },
  {
    method: "POST", path: "/orders/:id/fulfil", permission: "orders:fulfil", idempotent: true,
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ reference: v.optional(v.string({ max: 120 })), lines: v.array(v.object({ line_id: v.id(), quantity: v.number({ min: 0.0001, max: 1e9 }) }), { min: 1, max: 200 }) }), body);
      const o = await loadOrder(q, actor, id, true);
      if (!["confirmed", "processing", "partially_fulfilled"].includes(o.status)) throw conflict(`A ${o.status} order cannot be fulfilled`, "invalid_state");
      if (new Set(b.lines.map((l) => l.line_id)).size !== b.lines.length) throw badRequest("Each line can appear once per fulfilment");
      for (const l of b.lines) {
        const row = (await q.query<any>("SELECT id, quantity::text, fulfilled_quantity::text FROM sales_order_lines WHERE id = $1 AND order_id = $2 FOR UPDATE", [l.line_id, id])).rows[0];
        if (!row) throw badRequest(`Line ${l.line_id} is not on this order`);
        if (Number(row.fulfilled_quantity) + l.quantity > Number(row.quantity) + 1e-9) throw conflict(`Line ${l.line_id}: only ${Number(row.quantity) - Number(row.fulfilled_quantity)} left to fulfil`, "over_fulfilment");
        await q.query("UPDATE sales_order_lines SET fulfilled_quantity = fulfilled_quantity + $2 WHERE id = $1", [l.line_id, l.quantity]);
        await q.query("INSERT INTO sales_order_fulfilments (order_id, line_id, quantity, reference, source, recorded_by) VALUES ($1,$2,$3,$4,'manual',$5)", [id, l.line_id, l.quantity, b.reference ?? null, actor.label]);
      }
      const left = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_order_lines WHERE order_id = $1 AND fulfilled_quantity < quantity", [id])).rows[0]!.n;
      const status = left === 0 ? "fulfilled" : "partially_fulfilled";
      await q.query("UPDATE sales_orders SET status = $2, fulfilled_at = CASE WHEN $2 = 'fulfilled' THEN $3::timestamptz ELSE fulfilled_at END, updated_at = now() WHERE id = $1", [id, status, now.toISOString()]);
      await audit(q, actor, { action: "order.fulfil", entityType: "order", entityId: id, summary: `${o.number}: fulfilment recorded (${status}); stock levels in any inventory system are not changed by this record` }, requestId);
      events.push({ type: "order.fulfilled", entityType: "order", entityId: id, data: { status } } as DomainEvent);
      return { ok: true, status };
    },
  },
  {
    method: "POST", path: "/orders/:id/complete", permission: "orders:fulfil",
    async handler({ q, actor, params, now, requestId }) {
      const id = parse(v.id(), params.id);
      const o = await loadOrder(q, actor, id, true);
      assertTransition("order", ORDER_TRANSITIONS, o.status, "completed");
      await q.query("UPDATE sales_orders SET status = 'completed', completed_at = $2, updated_at = now() WHERE id = $1", [id, now.toISOString()]);
      await audit(q, actor, { action: "order.complete", entityType: "order", entityId: id, summary: `Completed ${o.number}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/orders/:id/payments", permission: "payments:record", idempotent: true,
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ amount: v.money(), method: v.withDefault(v.string({ min: 2, max: 40 }), "bank_transfer"), reference: v.optional(v.string({ max: 120 })), received_on: v.optional(v.date()) }), body);
      const o = await loadOrder(q, actor, id, true);
      if (["draft", "pending_approval", "cancelled"].includes(o.status)) throw conflict(`Payments cannot be recorded on a ${o.status} order`, "invalid_state");
      if (cmp(b.amount, "0.00") <= 0) throw validationFailed([{ path: "amount", message: "The amount must be greater than zero" }]);
      const outstanding = sub(o.total, o.paid_total);
      if (cmp(b.amount, outstanding) > 0) throw conflict(`The amount exceeds the outstanding balance of ${outstanding}`, "overpayment");
      const receivedOn = b.received_on ?? businessDate(now, "UTC");
      if (receivedOn > businessDate(now, "UTC") && receivedOn > d10(new Date(now.getTime() + 86_400_000))!) throw validationFailed([{ path: "received_on", message: "The payment date is in the future" }]);
      const r = await q.query<{ id: number }>("INSERT INTO sales_order_payments (order_id, amount, method, reference, received_on, source, recorded_by) VALUES ($1,$2,$3,$4,$5,'manual',$6) RETURNING id", [id, b.amount, b.method, b.reference ?? null, receivedOn, actor.label]);
      const res = await recomputePayment(q, id);
      for (const h of orderHooks.paid) await h(q, id, { now, actor, requestId });
      await audit(q, actor, { action: "order.payment", entityType: "order", entityId: id, summary: `Recorded payment ${b.amount} on ${o.number} (${res.status}); recorded manually, not verified with a bank` }, requestId);
      events.push({ type: "order.paid", entityType: "order", entityId: id, data: { status: res.status } } as DomainEvent);
      return created({ id: r.rows[0]!.id, paid_total: res.paid, payment_status: res.status });
    },
  },
  {
    method: "POST", path: "/orders/:id/payments/:paymentId/reverse", permission: "payments:record",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const pid = parse(v.id(), params.paymentId);
      parse(v.object({ reason: v.string({ min: 3, max: 300 }) }), body);
      const o = await loadOrder(q, actor, id, true);
      const p = (await q.query<any>("SELECT * FROM sales_order_payments WHERE id = $1 AND order_id = $2 FOR UPDATE", [pid, id])).rows[0];
      if (!p) throw notFound("Payment");
      if (p.status === "reversed") return { ok: true, already: true };
      await q.query("UPDATE sales_order_payments SET status = 'reversed' WHERE id = $1", [pid]);
      const res = await recomputePayment(q, id);
      await audit(q, actor, { action: "order.payment_reverse", entityType: "order", entityId: id, summary: `Reversed payment ${p.amount} on ${o.number}`, after: (body as any) }, requestId);
      return { ok: true, paid_total: res.paid, payment_status: res.status };
    },
  },
  {
    method: "POST", path: "/orders/:id/returns", permission: "orders:fulfil", idempotent: true,
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ line_id: v.id(), quantity: v.number({ min: 0.0001, max: 1e9 }), reason: v.string({ min: 3, max: 300 }) }), body);
      const o = await loadOrder(q, actor, id, true);
      if (!["partially_fulfilled", "fulfilled", "completed"].includes(o.status)) throw conflict("Only fulfilled quantities can be returned", "invalid_state");
      const l = (await q.query<any>("SELECT id, quantity::text, fulfilled_quantity::text, returned_quantity::text, net::text, total::text FROM sales_order_lines WHERE id = $1 AND order_id = $2 FOR UPDATE", [b.line_id, id])).rows[0];
      if (!l) throw badRequest("The line is not on this order");
      if (Number(l.returned_quantity) + b.quantity > Number(l.fulfilled_quantity) + 1e-9) throw conflict(`Only ${Number(l.fulfilled_quantity) - Number(l.returned_quantity)} can still be returned on this line`, "over_return");
      const qty = String(b.quantity);
      const credit = proportion(l.total, qty, l.quantity);
      const netPortion = proportion(l.net, qty, l.quantity);
      await q.query("UPDATE sales_order_lines SET returned_quantity = returned_quantity + $2 WHERE id = $1", [b.line_id, b.quantity]);
      await q.query("INSERT INTO sales_order_returns (order_id, line_id, quantity, reason, credit_amount, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, b.line_id, b.quantity, b.reason, credit, actor.label]);
      await q.query("UPDATE sales_orders SET returned_total = returned_total + $2, updated_at = now() WHERE id = $1", [id, netPortion]);
      for (const h of orderHooks.returned) await h(q, id, { now, actor, requestId });
      await audit(q, actor, { action: "order.return", entityType: "order", entityId: id, summary: `Return of ${qty} on line ${b.line_id} (credit ${credit}): ${b.reason}. No credit note is issued unless a finance system is connected.` }, requestId);
      events.push({ type: "order.returned", entityType: "order", entityId: id } as DomainEvent);
      return created({ credit_amount: credit, returned_net: netPortion });
    },
  },
  {
    method: "POST", path: "/orders/:id/cancel", permission: "orders:cancel", idempotent: true,
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ reason: v.string({ min: 3, max: 300 }) }), body);
      const o = await loadOrder(q, actor, id, true);
      if (o.status === "cancelled") return { ok: true, already: true };
      assertTransition("order", ORDER_TRANSITIONS, o.status, "cancelled");
      const paid = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_order_payments WHERE order_id = $1 AND status = 'recorded'", [id])).rows[0]!.n;
      if (paid > 0) throw conflict("Payments are recorded on this order. Reverse or refund them before cancelling.", "has_payments");
      const shipped = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_order_lines WHERE order_id = $1 AND fulfilled_quantity > 0", [id])).rows[0]!.n;
      if (shipped > 0) throw conflict("Items were already fulfilled. Record returns instead of cancelling.", "has_fulfilments");
      await q.query("UPDATE sales_orders SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3, updated_at = now() WHERE id = $1", [id, now.toISOString(), b.reason]);
      const fresh = (await q.query<any>("SELECT * FROM sales_orders WHERE id = $1", [id])).rows[0];
      if (["pending", "reserved"].includes(o.inventory_status)) await enqueue(q, { kind: "inventory.release", entityType: "order", entityId: id, idempotencyKey: `order-release:${id}`, payload: { order: await payloadOf(q, fresh) } });
      else if (o.inventory_status === "unavailable") await q.query("UPDATE sales_orders SET inventory_status = 'not_requested' WHERE id = $1", [id]);
      if (o.invoice_status === "issued" && o.invoice_ref) await enqueue(q, { kind: "finance.void_invoice", entityType: "order", entityId: id, idempotencyKey: `order-void:${id}`, payload: { invoiceRef: o.invoice_ref, reason: b.reason } });
      for (const h of orderHooks.cancelled) await h(q, id, { now, actor, requestId });
      await audit(q, actor, { action: "order.cancel", entityType: "order", entityId: id, summary: `Cancelled ${o.number}: ${b.reason}` }, requestId);
      events.push({ type: "order.cancelled", entityType: "order", entityId: id } as DomainEvent);
      return { ok: true };
    },
  },
  {
    // Set or clear the date the sale actually happened (can be past or future). Before booking it simply stores the date; after booking, only people who can approve orders may correct it (the booking date, due date and reports move with it; created_at never changes).
    method: "PATCH", path: "/orders/:id/transaction-date", permission: "orders:write",
    async handler({ q, actor, params, body, now, requestId, settings }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ transaction_date: v.nullable(v.date()), reason: v.optional(v.string({ max: 300 })) }), body);
      const o = await loadOrder(q, actor, id, true);
      if (o.status === "cancelled") throw conflict("A cancelled order cannot be re-dated", "invalid_state");
      const booked = o.booked_at !== null && o.booked_at !== undefined;
      if (booked && !can(actor, "orders:approve")) throw forbidden("Only a person who can approve orders may change the date of a booked order");
      const txn = b.transaction_date ?? null;
      if (booked) {
        if (!txn) throw badRequest("A booked order needs a transaction date; pick one");
        if (txn > businessDate(now, settings.business.timezone)) throw conflict("A booked order cannot be dated in the future", "future_transaction_date");
        const bookedAt = new Date(`${txn}T12:00:00.000Z`);
        const due = new Date(bookedAt.getTime() + (o.payment_terms_days ?? 30) * 86_400_000).toISOString().slice(0, 10);
        await q.query("UPDATE sales_orders SET transaction_date = $2, booked_at = $3, invoice_due_on = CASE WHEN invoice_status = 'issued' THEN invoice_due_on ELSE $4 END, updated_at = now() WHERE id = $1", [id, txn, bookedAt.toISOString(), due]);
      } else {
        await q.query("UPDATE sales_orders SET transaction_date = $2, updated_at = now() WHERE id = $1", [id, txn]);
      }
      await audit(q, actor, { action: "order.transaction_date", entityType: "order", entityId: id, summary: `Transaction date of ${o.number} set to ${txn ?? "none"}`, before: { transaction_date: o.transaction_date ?? null, booked_at: o.booked_at ?? null }, after: { transaction_date: txn, reason: b.reason ?? null } }, requestId);
      return { ok: true, transaction_date: txn };
    },
  },
];
void add; void sum; void can;
