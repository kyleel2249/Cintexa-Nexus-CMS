import { createHash, randomBytes } from "node:crypto";
import { v, parse } from "../core/validate";
import { created, html, PUBLIC_ACTOR, type Route, type DomainEvent } from "../core/router";
import { notFound, conflict, badRequest, validationFailed, forbidden, unprocessable } from "../core/errors";
import { audit } from "../core/audit";
import { nextNumber } from "../core/numbering";
import { can, redactCost } from "../core/rbac";
import { pageOf, orderBy, str, d10 } from "../core/http";
import { lineTotals, documentTotals, effectiveDiscountPercent, cmp, sub, add, mulQty } from "../core/money";
import { resolvePrice, evaluateApproval, approverCanApprove, type ApprovalFinding } from "../domain/pricing";
import { assertTransition, QUOTATION_TRANSITIONS } from "../domain/state-machines";
import { businessDate } from "../core/time";
import { enqueue } from "../integrations/outbox";
import { Where, scopeSql, loadOwned } from "./common";
import { loadPriceContext } from "./catalog";
import { visibleAccount } from "./accounts";
import { notify } from "./activities";
import type { Actor, Queryable } from "../core/types";
import type { SalesSettings } from "../core/settings";

const lineIn = v.object({
  product_id: v.optional(v.id()), description: v.optional(v.string({ min: 1, max: 500 })), quantity: v.number({ min: 0.0001, max: 1e9 }), unit_price: v.optional(v.money()),
  discount_percent: v.withDefault(v.number({ min: 0, max: 100 }), 0), discount_amount: v.optional(v.money()), tax_rate: v.optional(v.number({ min: 0, max: 100 })),
});
type LineInput = { product_id?: number; description?: string; quantity: number; unit_price?: string; discount_percent: number; discount_amount?: string; tax_rate?: number };
const createBody = v.object({
  account_id: v.id(), contact_id: v.optional(v.id()), opportunity_id: v.optional(v.id()), currency: v.optional(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ })), validity_date: v.optional(v.date()),
  payment_terms_days: v.optional(v.int({ min: 0, max: 365 })), terms: v.optional(v.string({ max: 6000, raw: true })), delivery_terms: v.optional(v.string({ max: 2000, raw: true })), notes: v.optional(v.string({ max: 4000, raw: true })),
  lines: v.array(lineIn, { min: 1, max: 200 }),
});
const patchBody = v.object({
  contact_id: v.nullable(v.id()), validity_date: v.optional(v.date()), payment_terms_days: v.optional(v.int({ min: 0, max: 365 })), terms: v.nullable(v.string({ max: 6000, raw: true })),
  delivery_terms: v.nullable(v.string({ max: 2000, raw: true })), notes: v.nullable(v.string({ max: 4000, raw: true })), lines: v.optional(v.array(lineIn, { min: 1, max: 200 })),
});

export interface BuiltLine {
  position: number; product_id: number | null; description: string; quantity: string; unit_price: string; list_price: string | null; discount_percent: string; discount_amount: string; tax_rate: string;
  unit_cost: string | null; gross: string; discount: string; net: string; tax: string; total: string; belowList: boolean;
}

export async function buildLines(q: Queryable, c: { accountId: number; currency: string; now: Date; settings: SalesSettings }, input: LineInput[]): Promise<{ lines: BuiltLine[]; totals: ReturnType<typeof documentTotals>; maxLineDiscountPercent: number; belowList: boolean }> {
  const on = businessDate(c.now, c.settings.business.timezone);
  const ids = [...new Set(input.map((l) => l.product_id).filter((x): x is number => !!x))];
  const ctx = await loadPriceContext(q, ids, on);
  const products = new Map<number, any>();
  for (const id of ids) {
    const p = (await q.query<any>("SELECT id, sku, name, base_price::text, cost_price::text, currency, category, tax_rate::text, status FROM sales_products WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
    if (!p) throw notFound(`Product ${id}`);
    if (p.status !== "active") throw conflict(`${p.sku} is discontinued and cannot be quoted`, "product_discontinued");
    if (p.currency !== c.currency) throw conflict(`${p.sku} is priced in ${p.currency}; this document is in ${c.currency}. Prices are never converted automatically.`, "currency_mismatch");
    products.set(id, p);
  }
  const lines: BuiltLine[] = [];
  let maxDisc = 0;
  let anyBelow = false;
  input.forEach((l, i) => {
    const p = l.product_id ? products.get(l.product_id) : null;
    if (!p && l.unit_price === undefined) throw validationFailed([{ path: `lines[${i}].unit_price`, message: "A line without a product needs a unit price" }]);
    if (!p && !l.description) throw validationFailed([{ path: `lines[${i}].description`, message: "A line without a product needs a description" }]);
    const resolved = p ? resolvePrice({ product: { id: p.id, basePrice: p.base_price, category: p.category }, quantity: String(l.quantity), accountId: c.accountId, currency: c.currency, priceBooks: ctx.books, promotions: ctx.promos, on }) : null;
    const unitPrice = l.unit_price ?? resolved!.unitPrice;
    const listPrice = resolved ? resolved.unitPrice : null;
    const belowList = listPrice !== null && cmp(unitPrice, listPrice) < 0;
    const t = lineTotals({ quantity: l.quantity, unitPrice, discountPercent: l.discount_percent, discountAmount: l.discount_amount, taxRate: l.tax_rate ?? p?.tax_rate ?? 0, unitCost: p?.cost_price ?? null }, c.settings.business.rounding);
    const eff = effectiveDiscountPercent(t.gross, t.discount);
    maxDisc = Math.max(maxDisc, eff);
    anyBelow = anyBelow || belowList;
    lines.push({
      position: i + 1, product_id: p?.id ?? null, description: l.description ?? p.name, quantity: String(l.quantity), unit_price: unitPrice, list_price: listPrice, discount_percent: String(l.discount_percent), discount_amount: l.discount_amount ?? "0.00",
      tax_rate: String(l.tax_rate ?? p?.tax_rate ?? 0), unit_cost: p?.cost_price ?? null, gross: t.gross, discount: t.discount, net: t.net, tax: t.tax, total: t.total, belowList,
    });
  });
  const totals = documentTotals(lines.map((l) => lineTotals({ quantity: l.quantity, unitPrice: l.unit_price, discountPercent: l.discount_percent, discountAmount: l.discount_amount, taxRate: l.tax_rate, unitCost: l.unit_cost }, c.settings.business.rounding)));
  return { lines, totals, maxLineDiscountPercent: maxDisc, belowList: anyBelow };
}

async function writeLines(q: Queryable, quotationId: number, lines: BuiltLine[]): Promise<void> {
  await q.query("DELETE FROM sales_quotation_lines WHERE quotation_id = $1", [quotationId]);
  for (const l of lines) {
    await q.query(
      `INSERT INTO sales_quotation_lines (quotation_id, position, product_id, description, quantity, unit_price, list_price, discount_percent, discount_amount, tax_rate, unit_cost, gross, discount, net, tax, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [quotationId, l.position, l.product_id, l.description, l.quantity, l.unit_price, l.list_price, l.discount_percent, l.discount_amount, l.tax_rate, l.unit_cost, l.gross, l.discount, l.net, l.tax, l.total],
    );
  }
}

async function writeTotals(q: Queryable, id: number, t: ReturnType<typeof documentTotals>): Promise<void> {
  await q.query(
    `UPDATE sales_quotations SET subtotal=$2, discount_total=$3, net_total=$4, tax_total=$5, total=$6, cost_total=$7, margin_percent=$8, effective_discount_percent=$9,
       requires_approval = FALSE, approval_reasons = '[]'::jsonb, updated_at = now() WHERE id = $1`,
    [id, t.subtotal, t.discountTotal, t.netTotal, t.taxTotal, t.total, t.costTotal, t.marginPercent, effectiveDiscountPercent(t.subtotal, t.discountTotal)],
  );
}

export async function openExposure(q: Queryable, accountId: number, currency: string): Promise<string> {
  const r = await q.query<{ x: string }>("SELECT COALESCE(sum(total - paid_total),0)::numeric(18,2)::text AS x FROM sales_orders WHERE account_id = $1 AND currency = $2 AND status <> 'cancelled' AND payment_status <> 'paid'", [accountId, currency]);
  return r.rows[0]!.x;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LIST = `x.id, x.number, x.version, x.status, x.account_id, a.name AS account_name, x.opportunity_id, x.owner_id, m.display_name AS owner_name, x.currency, x.total, x.validity_date, x.requires_approval, x.sent_at, x.accepted_at, x.created_at,
  (x.status IN ('sent','viewed','approved') AND x.validity_date < CURRENT_DATE) AS past_validity`;
const FROM = `FROM sales_quotations x JOIN sales_accounts a ON a.id = x.account_id LEFT JOIN sales_members m ON m.id = x.owner_id`;

async function loadQuotation(q: Queryable, actor: Actor, id: number, forUpdate = false): Promise<any> {
  return loadOwned<any>(q, actor, "sales_quotations", id, "Quotation", { forUpdate });
}

function isEditable(status: string) { return status === "draft" || status === "internal_review"; }

export const quotationRoutes: Route[] = [
  {
    method: "GET", path: "/quotations", permission: "quotations:read",
    async handler({ q, actor, query }) {
      const w = new Where().raw(scopeSql(actor, "x.owner_id")).raw("x.status <> 'superseded'");
      w.search(str(query, "q"), ["x.number", "a.name"]);
      if (str(query, "status")) w.and("x.status = ?", str(query, "status"));
      if (str(query, "account_id")) w.and("x.account_id = ?", parse(v.id(), str(query, "account_id")));
      if (str(query, "owner_id")) w.and("x.owner_id = ?", parse(v.id(), str(query, "owner_id")));
      if (str(query, "opportunity_id")) w.and("x.opportunity_id = ?", parse(v.id(), str(query, "opportunity_id")));
      if (str(query, "expiring_days")) w.and("x.status IN ('sent','viewed','approved') AND x.validity_date <= CURRENT_DATE + (?::int)", parse(v.int({ min: 0, max: 365 }), str(query, "expiring_days")));
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { created: "x.created_at", total: "x.total", validity: "x.validity_date", number: "x.number" }, "created");
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n ${FROM} WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query(`SELECT ${LIST} ${FROM} WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      return { items: r.rows, total, page, pageSize };
    },
  },
  {
    method: "POST", path: "/quotations", permission: "quotations:write", idempotent: true,
    async handler({ q, actor, body, now, settings, requestId, events }) {
      const b = parse(createBody, body);
      const account = await visibleAccount(q, actor, b.account_id);
      const currency = b.currency ?? account.currency ?? settings.business.currency;
      if (b.contact_id && !(await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", [b.contact_id, b.account_id])).rows[0]) throw badRequest("The contact does not belong to this account");
      if (b.opportunity_id) {
        const o = await loadOwned<any>(q, actor, "sales_opportunities", b.opportunity_id, "Opportunity", { extraWhere: "archived_at IS NULL" });
        if (o.account_id !== b.account_id) throw badRequest("The opportunity belongs to a different account");
      }
      const built = await buildLines(q, { accountId: b.account_id, currency, now, settings }, b.lines);
      const validity = b.validity_date ?? d10(new Date(now.getTime() + settings.quotations.validityDays * 86_400_000))!;
      if (validity < businessDate(now, settings.business.timezone)) throw validationFailed([{ path: "validity_date", message: "The validity date is in the past" }]);
      const number = await nextNumber(q, "quotation", now, { yearly: settings.numbering.yearly, prefix: settings.numbering.quotationPrefix });
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_quotations (number, version, account_id, contact_id, opportunity_id, owner_id, currency, payment_terms_days, terms, delivery_terms, notes, validity_date, created_by)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [number, b.account_id, b.contact_id ?? null, b.opportunity_id ?? null, actor.memberId || null, currency, b.payment_terms_days ?? account.payment_terms_days ?? 30, b.terms ?? settings.quotations.defaultTerms, b.delivery_terms ?? null, b.notes ?? null, validity, actor.label],
      );
      const id = r.rows[0]!.id;
      await q.query("UPDATE sales_quotations SET root_id = id WHERE id = $1", [id]);
      await writeLines(q, id, built.lines);
      await writeTotals(q, id, built.totals);
      await audit(q, actor, { action: "quotation.create", entityType: "quotation", entityId: id, summary: `Created quotation ${number} (${built.totals.total} ${currency})` }, requestId);
      events.push({ type: "quotation.created", entityType: "quotation", entityId: id } as DomainEvent);
      return created({ id, number, version: 1, total: built.totals.total });
    },
  },
  {
    method: "GET", path: "/quotations/:id", permission: "quotations:read",
    async handler({ q, actor, params, now, settings }) {
      const id = parse(v.id(), params.id);
      const x = await loadQuotation(q, actor, id);
      const lines = (await q.query<any>("SELECT l.*, p.sku FROM sales_quotation_lines l LEFT JOIN sales_products p ON p.id = l.product_id WHERE l.quotation_id = $1 ORDER BY l.position", [id])).rows;
      const account = (await q.query("SELECT id, name, number FROM sales_accounts WHERE id = $1", [x.account_id])).rows[0];
      const versions = (await q.query("SELECT id, version, status, total, created_at FROM sales_quotations WHERE root_id = $1 ORDER BY version", [x.root_id ?? id])).rows;
      const approvals = (await q.query("SELECT id, requested_by, decided_by, decision, reasons, comment, requested_at, decided_at FROM sales_quotation_approvals WHERE quotation_id = $1 ORDER BY id DESC", [id])).rows;
      const today = businessDate(now, settings.business.timezone);
      const order = (await q.query("SELECT id, number, status FROM sales_orders WHERE quotation_id = $1 AND status <> 'cancelled'", [id])).rows[0] ?? null;
      const { public_token_hash, ...safe } = x;
      void public_token_hash;
      return { quotation: redactCost(actor, { ...safe }), lines: lines.map((l) => redactCost(actor, l)), account, versions, approvals, order, pastValidity: ["sent", "viewed", "approved"].includes(x.status) && d10(x.validity_date)! < today, editable: isEditable(x.status) };
    },
  },
  {
    method: "PATCH", path: "/quotations/:id", permission: "quotations:write",
    async handler({ q, actor, params, body, now, settings, requestId }) {
      const id = parse(v.id(), params.id);
      const x = await loadQuotation(q, actor, id, true);
      if (!isEditable(x.status)) throw conflict(`A ${x.status} quotation cannot be edited. Create a new version instead.`, "quotation_locked");
      const b = parse(patchBody, body);
      if (b.contact_id && !(await q.query("SELECT 1 FROM sales_contacts WHERE id = $1 AND account_id = $2 AND archived_at IS NULL", [b.contact_id, x.account_id])).rows[0]) throw badRequest("The contact does not belong to this account");
      const sets: string[] = [];
      const p: unknown[] = [id];
      for (const k of ["contact_id", "validity_date", "payment_terms_days", "terms", "delivery_terms", "notes"] as const) if ((b as any)[k] !== undefined) { p.push((b as any)[k]); sets.push(`${k} = $${p.length}`); }
      if (b.validity_date && b.validity_date < businessDate(now, settings.business.timezone)) throw validationFailed([{ path: "validity_date", message: "The validity date is in the past" }]);
      if (sets.length) await q.query(`UPDATE sales_quotations SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, p);
      if (b.lines) {
        const built = await buildLines(q, { accountId: x.account_id, currency: x.currency, now, settings }, b.lines);
        await writeLines(q, id, built.lines);
        await writeTotals(q, id, built.totals);
      }
      await audit(q, actor, { action: "quotation.update", entityType: "quotation", entityId: id, summary: `Edited ${x.number} v${x.version}${b.lines ? " (lines replaced)" : ""}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/quotations/:id/submit", permission: "quotations:write",
    async handler({ q, actor, params, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const x = await loadQuotation(q, actor, id, true);
      if (!isEditable(x.status)) throw conflict(`This quotation is ${x.status}`, "invalid_state");
      const lines = (await q.query<any>("SELECT * FROM sales_quotation_lines WHERE quotation_id = $1", [id])).rows;
      if (!lines.length) throw unprocessable("Add at least one line before submitting", "no_lines");
      if (d10(x.validity_date)! < businessDate(now, settings.business.timezone)) throw unprocessable("The validity date has passed. Extend it before submitting.", "validity_passed");
      const acct = (await q.query<any>("SELECT credit_limit::text FROM sales_accounts WHERE id = $1", [x.account_id])).rows[0];
      const owner = x.owner_id ? (await q.query<{ role: any }>("SELECT role FROM sales_members WHERE id = $1", [x.owner_id])).rows[0] : null;
      const maxDisc = lines.reduce((m, l) => Math.max(m, effectiveDiscountPercent(l.gross, l.discount)), 0);
      const belowList = lines.some((l) => l.list_price !== null && cmp(l.unit_price, l.list_price) < 0);
      const findings = evaluateApproval({ ownerRole: owner?.role ?? actor.role, maxLineDiscountPercent: maxDisc, marginPercent: x.margin_percent === null ? null : Number(x.margin_percent), total: x.total, creditLimit: acct?.credit_limit ?? null, openExposure: await openExposure(q, x.account_id, x.currency), belowList }, settings.discounts, undefined);
      // the order threshold is enforced when the order is confirmed, not on the quotation
      const f = findings.filter((i) => i.code !== "order_over_threshold");
      if (f.length) {
        await q.query("UPDATE sales_quotations SET status = 'pending_approval', requires_approval = TRUE, approval_reasons = $2::text::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify(f)]);
        await q.query("INSERT INTO sales_quotation_approvals (quotation_id, requested_by, reasons) VALUES ($1,$2,$3::text::jsonb) ON CONFLICT DO NOTHING", [id, actor.label, JSON.stringify(f)]);
        const approvers = (await q.query<{ id: number }>("SELECT id FROM sales_members WHERE active AND role IN ('sales_manager','sales_director','sales_admin') AND id <> $1", [actor.memberId])).rows;
        for (const a of approvers) await notify(q, a.id, { kind: "approval", title: `Approval needed: ${x.number}`, body: f.map((i) => i.message).join("; "), link: `/sales/quotations/${id}`, severity: "warning", dedupeKey: `quote-approval:${id}:${x.version}` });
        await audit(q, actor, { action: "quotation.submit", entityType: "quotation", entityId: id, summary: `${x.number} needs approval: ${f.map((i) => i.code).join(", ")}`, after: f }, requestId);
        events.push({ type: "quotation.approval_requested", entityType: "quotation", entityId: id } as DomainEvent);
        return { ok: true, status: "pending_approval", findings: f };
      }
      await q.query("UPDATE sales_quotations SET status = 'approved', requires_approval = FALSE, approved_by = 'Within policy', approved_at = $2, updated_at = now() WHERE id = $1", [id, now.toISOString()]);
      await audit(q, actor, { action: "quotation.submit", entityType: "quotation", entityId: id, summary: `${x.number} approved automatically (within discount, margin and credit policy)` }, requestId);
      return { ok: true, status: "approved", findings: [] };
    },
  },
  {
    method: "POST", path: "/quotations/:id/approve", permission: "quotations:approve",
    async handler({ q, actor, params, body, now, settings, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ comment: v.optional(v.string({ max: 500 })) }), body ?? {});
      const x = await loadQuotation(q, actor, id, true);
      if (x.status !== "pending_approval") throw conflict(`This quotation is ${x.status}, not waiting for approval`, "invalid_state");
      const findings = (x.approval_reasons ?? []) as ApprovalFinding[];
      if (x.created_by === actor.label && actor.role !== "sales_admin") throw forbidden("You cannot approve your own quotation", "self_approval");
      const lines = (await q.query<any>("SELECT gross, discount FROM sales_quotation_lines WHERE quotation_id = $1", [id])).rows;
      const maxDisc = lines.reduce((m, l) => Math.max(m, effectiveDiscountPercent(l.gross, l.discount)), 0);
      const ok = approverCanApprove(actor.role, findings, maxDisc, settings.discounts);
      if (!ok.ok) throw forbidden(ok.reason ?? "You cannot approve this quotation", "approval_limit");
      await q.query("UPDATE sales_quotations SET status = 'approved', approved_by = $2, approved_at = $3, updated_at = now() WHERE id = $1", [id, actor.label, now.toISOString()]);
      await q.query("UPDATE sales_quotation_approvals SET decision = 'approved', decided_by = $2, comment = $3, decided_at = $4 WHERE quotation_id = $1 AND decision = 'pending'", [id, actor.label, b.comment ?? null, now.toISOString()]);
      if (x.owner_id) await notify(q, x.owner_id, { kind: "approval", title: `${x.number} approved`, body: b.comment, link: `/sales/quotations/${id}`, dedupeKey: `quote-approved:${id}:${x.version}` });
      await audit(q, actor, { action: "quotation.approve", entityType: "quotation", entityId: id, summary: `Approved ${x.number}`, after: { comment: b.comment } }, requestId);
      events.push({ type: "quotation.approved", entityType: "quotation", entityId: id } as DomainEvent);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/quotations/:id/reject-approval", permission: "quotations:approve",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ comment: v.string({ min: 3, max: 500 }) }), body);
      const x = await loadQuotation(q, actor, id, true);
      if (x.status !== "pending_approval") throw conflict(`This quotation is ${x.status}`, "invalid_state");
      await q.query("UPDATE sales_quotations SET status = 'draft', requires_approval = FALSE, updated_at = now() WHERE id = $1", [id]);
      await q.query("UPDATE sales_quotation_approvals SET decision = 'rejected', decided_by = $2, comment = $3, decided_at = $4 WHERE quotation_id = $1 AND decision = 'pending'", [id, actor.label, b.comment, now.toISOString()]);
      if (x.owner_id) await notify(q, x.owner_id, { kind: "approval", title: `${x.number} was not approved`, body: b.comment, link: `/sales/quotations/${id}`, severity: "warning", dedupeKey: `quote-rejected:${id}:${x.version}:${now.getTime()}` });
      await audit(q, actor, { action: "quotation.approval_rejected", entityType: "quotation", entityId: id, summary: `Rejected approval for ${x.number}: ${b.comment}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/quotations/:id/send", permission: "quotations:send",
    async handler({ q, actor, params, body, now, settings, deps, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ channel: v.withDefault(v.enumOf(["email", "link"] as const), "link"), to: v.optional(v.email()), message: v.optional(v.string({ max: 2000 })) }), body ?? {});
      const x = await loadQuotation(q, actor, id, true);
      if (!["approved", "sent", "viewed"].includes(x.status)) throw conflict(`A ${x.status} quotation cannot be sent. It must be approved first.`, "not_approved");
      if (d10(x.validity_date)! < businessDate(now, settings.business.timezone)) throw unprocessable("The validity date has passed. Create a new version with a new date.", "validity_passed");
      const token = randomBytes(32).toString("base64url");
      await q.query("UPDATE sales_quotations SET public_token_hash = $2, updated_at = now() WHERE id = $1", [id, hashToken(token)]);
      const link = `/q/${token}`;
      if (b.channel === "link") {
        if (x.status === "approved") await q.query("UPDATE sales_quotations SET status = 'sent', sent_at = $2, sent_via = 'manual_link', updated_at = now() WHERE id = $1", [id, now.toISOString()]);
        await audit(q, actor, { action: "quotation.send", entityType: "quotation", entityId: id, summary: `Created customer link for ${x.number}; shared manually` }, requestId);
        events.push({ type: "quotation.sent", entityType: "quotation", entityId: id } as DomainEvent);
        return { ok: true, status: x.status === "approved" ? "sent" : x.status, link, note: "The link is shown once. Copy it now and share it with the customer yourself." };
      }
      const to = b.to ?? (x.contact_id ? (await q.query<{ email: string | null; consent_email: boolean; unsubscribed_at: string | null }>("SELECT email, consent_email, unsubscribed_at FROM sales_contacts WHERE id = $1", [x.contact_id])).rows[0]?.email : null);
      if (!to) throw unprocessable("Choose a recipient email address", "no_recipient");
      const base = process.env.SALES_PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL;
      if (!base) throw conflict("Set SALES_PUBLIC_BASE_URL so the emailed link can be absolute", "no_public_base_url");
      if (!settings.integrations.email.enabled || !deps.integrations.email) throw conflict("Email is not connected. Use the link option and share it yourself, or connect an email provider in Sales Settings.", "email_not_connected");
      const url = `${base.replace(/\/$/, "")}${link}`;
      const account = (await q.query<{ name: string }>("SELECT name FROM sales_accounts WHERE id = $1", [x.account_id])).rows[0]!;
      await enqueue(q, { kind: "email.send", entityType: "quotation", entityId: id, idempotencyKey: `quote-email:${id}:${x.version}:${hashToken(to).slice(0, 12)}`, payload: { message: { to, subject: `Quotation ${x.number} from ${actor.name}`, html: `<p>Hello,</p><p>${esc(b.message ?? `Please find quotation ${x.number} for ${account.name}.`)}</p><p><a href="${esc(url)}">View and respond to the quotation</a></p><p>Valid until ${esc(d10(x.validity_date))}.</p>`, text: `${b.message ?? ""}\nView quotation ${x.number}: ${url}\nValid until ${d10(x.validity_date)}.` } } });
      await audit(q, actor, { action: "quotation.send", entityType: "quotation", entityId: id, summary: `Queued email of ${x.number} to ${to}` }, requestId);
      return { ok: true, status: x.status, queued: true, note: "Queued. The quotation is marked sent only after the email provider confirms delivery." };
    },
  },
  {
    method: "POST", path: "/quotations/:id/accept-manual", permission: "quotations:send",
    async handler({ q, actor, params, body, now, requestId, events }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ accepted_by_name: v.string({ min: 2, max: 120 }), evidence: v.string({ min: 3, max: 500 }) }), body);
      const x = await loadQuotation(q, actor, id, true);
      if (!["sent", "viewed", "approved"].includes(x.status)) throw conflict(`A ${x.status} quotation cannot be accepted`, "invalid_state");
      await q.query("UPDATE sales_quotations SET status = 'accepted', accepted_at = $2, accepted_by_name = $3, acceptance_evidence = $4::text::jsonb, updated_at = now() WHERE id = $1", [id, now.toISOString(), b.accepted_by_name, JSON.stringify({ kind: "recorded_by_staff", evidence: b.evidence, recorded_by: actor.label })]);
      await audit(q, actor, { action: "quotation.accept_manual", entityType: "quotation", entityId: id, summary: `${x.number} acceptance recorded by staff for ${b.accepted_by_name}: ${b.evidence}` }, requestId);
      events.push({ type: "quotation.accepted", entityType: "quotation", entityId: id } as DomainEvent);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/quotations/:id/reject", permission: "quotations:write",
    async handler({ q, actor, params, body, now, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ reason: v.string({ min: 3, max: 500 }) }), body);
      const x = await loadQuotation(q, actor, id, true);
      assertTransition("quotation", QUOTATION_TRANSITIONS, x.status, "rejected");
      await q.query("UPDATE sales_quotations SET status = 'rejected', rejected_at = $2, rejected_reason = $3, updated_at = now() WHERE id = $1", [id, now.toISOString(), b.reason]);
      await audit(q, actor, { action: "quotation.reject", entityType: "quotation", entityId: id, summary: `${x.number} rejected by customer: ${b.reason}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/quotations/:id/cancel", permission: "quotations:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ reason: v.optional(v.string({ max: 300 })) }), body ?? {});
      const x = await loadQuotation(q, actor, id, true);
      assertTransition("quotation", QUOTATION_TRANSITIONS, x.status, "cancelled");
      if ((await q.query("SELECT 1 FROM sales_orders WHERE quotation_id = $1 AND status <> 'cancelled'", [id])).rows[0]) throw conflict("An order exists for this quotation. Cancel the order first.", "has_order");
      await q.query("UPDATE sales_quotations SET status = 'cancelled', public_token_hash = NULL, updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "quotation.cancel", entityType: "quotation", entityId: id, summary: `Cancelled ${x.number}${b.reason ? `: ${b.reason}` : ""}` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/quotations/:id/revise", permission: "quotations:write",
    async handler({ q, actor, params, now, settings, requestId }) {
      const id = parse(v.id(), params.id);
      const x = await loadQuotation(q, actor, id, true);
      if (!["approved", "sent", "viewed", "rejected", "expired"].includes(x.status)) throw conflict(`A ${x.status} quotation is edited directly`, "invalid_state");
      if ((await q.query("SELECT 1 FROM sales_orders WHERE quotation_id = $1 AND status <> 'cancelled'", [id])).rows[0]) throw conflict("An order was created from this quotation", "has_order");
      const root = x.root_id ?? id;
      const next = (await q.query<{ v: number }>("SELECT max(version)::int + 1 AS v FROM sales_quotations WHERE root_id = $1", [root])).rows[0]!.v;
      const validity = d10(x.validity_date)! < businessDate(now, settings.business.timezone) ? d10(new Date(now.getTime() + settings.quotations.validityDays * 86_400_000))! : d10(x.validity_date)!;
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_quotations (number, version, root_id, supersedes_id, account_id, contact_id, opportunity_id, owner_id, currency, payment_terms_days, terms, delivery_terms, notes, validity_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [x.number, next, root, id, x.account_id, x.contact_id, x.opportunity_id, x.owner_id, x.currency, x.payment_terms_days, x.terms, x.delivery_terms, x.notes, validity, actor.label],
      );
      const nid = r.rows[0]!.id;
      await q.query(`INSERT INTO sales_quotation_lines (quotation_id, position, product_id, description, quantity, unit_price, list_price, discount_percent, discount_amount, tax_rate, unit_cost, gross, discount, net, tax, total)
        SELECT $2, position, product_id, description, quantity, unit_price, list_price, discount_percent, discount_amount, tax_rate, unit_cost, gross, discount, net, tax, total FROM sales_quotation_lines WHERE quotation_id = $1`, [id, nid]);
      await q.query(`UPDATE sales_quotations n SET subtotal = o.subtotal, discount_total = o.discount_total, net_total = o.net_total, tax_total = o.tax_total, total = o.total, cost_total = o.cost_total, margin_percent = o.margin_percent, effective_discount_percent = o.effective_discount_percent FROM sales_quotations o WHERE o.id = $1 AND n.id = $2`, [id, nid]);
      await q.query("UPDATE sales_quotations SET status = 'superseded', public_token_hash = NULL, updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "quotation.revise", entityType: "quotation", entityId: nid, summary: `Created ${x.number} v${next} superseding v${x.version}` }, requestId);
      return created({ id: nid, version: next });
    },
  },
  {
    method: "GET", path: "/quotations/:id/print", permission: "quotations:read", tx: false,
    async handler({ q, actor, params }) {
      const id = parse(v.id(), params.id);
      const x = await loadQuotation(q, actor, id);
      return html(await renderQuotation(q, id, x), `${x.number}-v${x.version}.html`);
    },
  },
  // ───── public customer link
  {
    method: "GET", path: "/public/quotations/:token", permission: null, public: true,
    async handler({ q, params, now, settings }) {
      const x = await byToken(q, params.token!);
      if (!x) throw notFound("Quotation");
      if (x.status === "sent") await q.query("UPDATE sales_quotations SET status = 'viewed', viewed_at = $2, updated_at = now() WHERE id = $1 AND status = 'sent'", [x.id, now.toISOString()]);
      if (x.status === "sent" && x.owner_id) await notify(q, x.owner_id, { kind: "quotation", title: `${x.number} was opened by the customer`, link: `/sales/quotations/${x.id}`, dedupeKey: `quote-viewed:${x.id}:${x.version}` });
      const lines = (await q.query("SELECT position, description, quantity, unit_price, discount_percent, tax_rate, net, tax, total FROM sales_quotation_lines WHERE quotation_id = $1 ORDER BY position", [x.id])).rows;
      const account = (await q.query<{ name: string }>("SELECT name FROM sales_accounts WHERE id = $1", [x.account_id])).rows[0]!;
      const owner = x.owner_id ? (await q.query<{ display_name: string; email: string }>("SELECT display_name, email FROM sales_members WHERE id = $1", [x.owner_id])).rows[0] : null;
      const expired = d10(x.validity_date)! < businessDate(now, settings.business.timezone) && ["sent", "viewed"].includes(x.status);
      return { number: x.number, version: x.version, status: expired ? "expired" : x.status === "sent" ? "viewed" : x.status, customer: account.name, currency: x.currency, validity_date: d10(x.validity_date), subtotal: x.subtotal, discount_total: x.discount_total, tax_total: x.tax_total, total: x.total, terms: x.terms, delivery_terms: x.delivery_terms, payment_terms_days: x.payment_terms_days, lines, contact: owner, canRespond: !expired && ["sent", "viewed"].includes(x.status) };
    },
  },
  {
    method: "POST", path: "/public/quotations/:token/accept", permission: null, public: true,
    async handler({ q, params, body, now, settings, ip, userAgent, requestId, events }) {
      const b = parse(v.object({ name: v.string({ min: 2, max: 120 }), agree: v.boolean() }), body);
      if (!b.agree) throw validationFailed([{ path: "agree", message: "Please confirm that you accept this quotation" }]);
      const x = await byToken(q, params.token!, true);
      if (!x) throw notFound("Quotation");
      if (!["sent", "viewed"].includes(x.status)) throw conflict(x.status === "accepted" ? "This quotation has already been accepted" : "This quotation can no longer be accepted", "invalid_state");
      if (d10(x.validity_date)! < businessDate(now, settings.business.timezone)) throw conflict("This quotation has expired. Please ask for a new one.", "expired");
      await q.query("UPDATE sales_quotations SET status = 'accepted', accepted_at = $2, accepted_by_name = $3, acceptance_evidence = $4::text::jsonb, updated_at = now() WHERE id = $1", [x.id, now.toISOString(), b.name, JSON.stringify({ kind: "customer_link", ip: ip ?? null, user_agent: userAgent ?? null, at: now.toISOString(), version: x.version, total: x.total, currency: x.currency })]);
      if (x.owner_id) await notify(q, x.owner_id, { kind: "quotation", title: `${x.number} accepted by ${b.name}`, link: `/sales/quotations/${x.id}`, severity: "info", dedupeKey: `quote-accepted:${x.id}` });
      await audit(q, PUBLIC_ACTOR, { action: "quotation.accept", entityType: "quotation", entityId: x.id, summary: `${x.number} accepted by ${b.name} through the customer link` }, requestId);
      events.push({ type: "quotation.accepted", entityType: "quotation", entityId: x.id } as DomainEvent);
      return { ok: true, message: "Thank you. Your acceptance has been recorded." };
    },
  },
  {
    method: "POST", path: "/public/quotations/:token/decline", permission: null, public: true,
    async handler({ q, params, body, now, requestId }) {
      const b = parse(v.object({ reason: v.optional(v.string({ max: 500 })) }), body ?? {});
      const x = await byToken(q, params.token!, true);
      if (!x) throw notFound("Quotation");
      if (!["sent", "viewed"].includes(x.status)) throw conflict("This quotation can no longer be declined", "invalid_state");
      await q.query("UPDATE sales_quotations SET status = 'rejected', rejected_at = $2, rejected_reason = $3, updated_at = now() WHERE id = $1", [x.id, now.toISOString(), b.reason ?? "Declined by customer"]);
      if (x.owner_id) await notify(q, x.owner_id, { kind: "quotation", title: `${x.number} was declined`, body: b.reason, link: `/sales/quotations/${x.id}`, severity: "warning", dedupeKey: `quote-declined:${x.id}` });
      await audit(q, PUBLIC_ACTOR, { action: "quotation.decline", entityType: "quotation", entityId: x.id, summary: `${x.number} declined through the customer link` }, requestId);
      return { ok: true };
    },
  },
];

async function byToken(q: Queryable, token: string, lock = false): Promise<any | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await q.query<any>(`SELECT * FROM sales_quotations WHERE public_token_hash = $1 ${lock ? "FOR UPDATE" : ""}`, [hashToken(token)]);
  return r.rows[0] ?? null;
}

export async function renderQuotation(q: Queryable, id: number, x: any): Promise<string> {
  const lines = (await q.query<any>("SELECT * FROM sales_quotation_lines WHERE quotation_id = $1 ORDER BY position", [id])).rows;
  const acct = (await q.query<any>("SELECT name, address_line, city, country FROM sales_accounts WHERE id = $1", [x.account_id])).rows[0];
  const row = (l: any) => `<tr><td>${l.position}</td><td>${esc(l.description)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${esc(l.unit_price)}</td><td class="n">${esc(l.discount)}</td><td class="n">${esc(l.tax)}</td><td class="n">${esc(l.total)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(x.number)} v${esc(x.version)}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;margin:40px auto;max-width:820px;padding:0 20px}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f5f5f5}.n{text-align:right}.tot td{border:0}.muted{color:#666}@media print{body{margin:0}}</style></head><body>
<h1>Quotation ${esc(x.number)}</h1><div class="muted">Version ${esc(x.version)} · Status ${esc(x.status)} · Valid until ${esc(d10(x.validity_date))}</div>
<p><strong>${esc(acct?.name)}</strong><br>${esc([acct?.address_line, acct?.city, acct?.country].filter(Boolean).join(", "))}</p>
<table><thead><tr><th>#</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Discount</th><th class="n">Tax</th><th class="n">Total (${esc(x.currency)})</th></tr></thead><tbody>${lines.map(row).join("")}</tbody></table>
<table class="tot" style="width:320px;margin-left:auto"><tr><td>Subtotal</td><td class="n">${esc(x.subtotal)}</td></tr><tr><td>Discount</td><td class="n">-${esc(x.discount_total)}</td></tr><tr><td>Tax</td><td class="n">${esc(x.tax_total)}</td></tr><tr><td><strong>Total ${esc(x.currency)}</strong></td><td class="n"><strong>${esc(x.total)}</strong></td></tr></table>
<p><strong>Payment terms:</strong> ${esc(x.payment_terms_days)} days</p>${x.delivery_terms ? `<p><strong>Delivery:</strong> ${esc(x.delivery_terms)}</p>` : ""}${x.terms ? `<p class="muted">${esc(x.terms)}</p>` : ""}
</body></html>`;
}
void sub; void add; void mulQty; void can;
