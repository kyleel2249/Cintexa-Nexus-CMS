import { v, parse } from "../core/validate";
import { created, noContent, type Route } from "../core/router";
import { notFound, conflict, badRequest, validationFailed } from "../core/errors";
import { audit } from "../core/audit";
import { redactCost, can } from "../core/rbac";
import { pageOf, orderBy, str } from "../core/http";
import { cmp } from "../core/money";
import { resolvePrice, type PriceBook, type Promotion } from "../domain/pricing";
import { Where, buildUpdate } from "./common";
import { businessDate } from "../core/time";
import type { Queryable } from "../core/types";

const KINDS = ["product", "service", "bundle"] as const;
const productFields = {
  sku: v.string({ min: 1, max: 60, pattern: /^[A-Za-z0-9._\-\/]+$/, patternMessage: "SKU may contain letters, digits and . _ - /" }), name: v.string({ min: 2, max: 160 }), description: v.optional(v.string({ max: 4000, raw: true })),
  category: v.optional(v.string({ max: 80 })), kind: v.withDefault(v.enumOf(KINDS), "product"), unit: v.withDefault(v.string({ min: 1, max: 20 }), "each"), base_price: v.money(), cost_price: v.optional(v.money()),
  currency: v.withDefault(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ }), "USD"), tax_rate: v.withDefault(v.number({ min: 0, max: 100 }), 0), track_stock: v.withDefault(v.boolean(), false),
  external_ref: v.optional(v.string({ max: 80 })), variant_of: v.optional(v.id()), variant_label: v.optional(v.string({ max: 80 })),
};
const productCreate = v.object(productFields);
const productPatch = v.object({
  name: v.optional(v.string({ min: 2, max: 160 })), description: v.nullable(v.string({ max: 4000, raw: true })), category: v.nullable(v.string({ max: 80 })), unit: v.optional(v.string({ min: 1, max: 20 })),
  base_price: v.optional(v.money()), cost_price: v.nullable(v.money()), tax_rate: v.optional(v.number({ min: 0, max: 100 })), status: v.optional(v.enumOf(["active", "discontinued"] as const)),
  track_stock: v.optional(v.boolean()), external_ref: v.nullable(v.string({ max: 80 })), variant_label: v.nullable(v.string({ max: 80 })),
});
const PRODUCT_COLS: Record<string, string> = { name: "name", description: "description", category: "category", unit: "unit", base_price: "base_price", cost_price: "cost_price", tax_rate: "tax_rate", status: "status", track_stock: "track_stock", external_ref: "external_ref", variant_label: "variant_label" };

export async function loadPriceContext(q: Queryable, productIds: number[], on: string): Promise<{ books: PriceBook[]; promos: Promotion[] }> {
  const books = (await q.query<any>("SELECT id, account_id, is_default, active, valid_from, valid_to, currency FROM sales_price_books WHERE archived_at IS NULL AND active")).rows;
  const entries = productIds.length ? (await q.query<any>(`SELECT price_book_id, product_id, min_quantity::text, unit_price::text FROM sales_price_book_entries WHERE product_id IN (${productIds.map(Number).join(",")})`)).rows : [];
  const promos = (await q.query<any>("SELECT id, product_id, category, discount_percent::text, starts_on, ends_on, active FROM sales_promotions WHERE archived_at IS NULL AND active AND starts_on <= $1::date AND ends_on >= $1::date", [on])).rows;
  const d = (x: unknown) => (x ? String(x).slice(0, 10) : null);
  return {
    books: books.map((b) => ({ id: b.id, accountId: b.account_id, isDefault: b.is_default, active: b.active, validFrom: d(b.valid_from), validTo: d(b.valid_to), currency: b.currency, entries: entries.filter((e: any) => e.price_book_id === b.id).map((e: any) => ({ productId: e.product_id, minQuantity: e.min_quantity, unitPrice: e.unit_price })) })),
    promos: promos.map((p) => ({ id: p.id, productId: p.product_id, category: p.category, discountPercent: p.discount_percent, startsOn: d(p.starts_on)!, endsOn: d(p.ends_on)!, active: p.active })),
  };
}

export const catalogRoutes: Route[] = [
  {
    method: "GET", path: "/products", permission: "products:read",
    async handler({ q, actor, query }) {
      const w = new Where().raw("p.archived_at IS NULL");
      w.search(str(query, "q"), ["p.name", "p.sku", "p.category"]);
      for (const k of ["category", "kind", "status"]) if (str(query, k)) w.and(`p.${k} = ?`, str(query, k));
      const { page, pageSize, offset } = pageOf(query);
      const order = orderBy(query, { name: "p.name", sku: "p.sku", price: "p.base_price", created: "p.created_at" }, "name");
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_products p WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const r = await q.query<any>(`SELECT p.id, p.sku, p.name, p.category, p.kind, p.unit, p.base_price, p.cost_price, p.currency, p.tax_rate, p.status, p.track_stock, p.variant_of FROM sales_products p WHERE ${w.sql} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, w.params);
      const cats = (await q.query<{ category: string }>("SELECT DISTINCT category FROM sales_products WHERE archived_at IS NULL AND category IS NOT NULL ORDER BY category")).rows.map((c) => c.category);
      return { items: r.rows.map((x) => redactCost(actor, x)), total, page, pageSize, categories: cats };
    },
  },
  {
    method: "POST", path: "/products", permission: "products:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(productCreate, body);
      if (b.cost_price !== undefined && !can(actor, "cost:read")) throw badRequest("You cannot set cost prices");
      if (b.variant_of && !(await q.query("SELECT 1 FROM sales_products WHERE id = $1 AND archived_at IS NULL", [b.variant_of])).rows[0]) throw badRequest("The base product for this variant does not exist");
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_products (sku, name, description, category, kind, unit, base_price, cost_price, currency, tax_rate, track_stock, external_ref, variant_of, variant_label) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [b.sku, b.name, b.description ?? null, b.category ?? null, b.kind, b.unit, b.base_price, b.cost_price ?? null, b.currency, b.tax_rate, b.track_stock, b.external_ref ?? null, b.variant_of ?? null, b.variant_label ?? null],
      ).catch((e: any) => { if (e?.code === "23505") throw conflict(`SKU ${b.sku} already exists`, "duplicate_sku"); throw e; });
      await audit(q, actor, { action: "product.create", entityType: "product", entityId: r.rows[0]!.id, summary: `Created product ${b.sku}`, after: { ...b, cost_price: undefined } }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "GET", path: "/products/:id", permission: "products:read",
    async handler({ q, actor, params, deps, now, settings }) {
      const id = parse(v.id(), params.id);
      const p = (await q.query<any>("SELECT * FROM sales_products WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!p) throw notFound("Product");
      const bundle = p.kind === "bundle" ? (await q.query("SELECT b.product_id, b.quantity, c.sku, c.name FROM sales_bundle_items b JOIN sales_products c ON c.id = b.product_id WHERE b.bundle_id = $1", [id])).rows : [];
      const tiers = (await q.query("SELECT e.min_quantity, e.unit_price, b.name AS price_book, b.id AS price_book_id FROM sales_price_book_entries e JOIN sales_price_books b ON b.id = e.price_book_id WHERE e.product_id = $1 AND b.archived_at IS NULL ORDER BY b.name, e.min_quantity", [id])).rows;
      const variants = (await q.query("SELECT id, sku, variant_label, base_price FROM sales_products WHERE variant_of = $1 AND archived_at IS NULL", [id])).rows;
      let stock: unknown = { status: "not_integrated", message: "No inventory system is connected, so stock is not shown." };
      const inv = deps.integrations.inventory;
      if (p.track_stock && inv && settings.integrations.inventory.enabled) {
        try {
          const a = (await inv.availability([p.sku]))[p.sku] ?? null;
          stock = a ? { status: "ok", source: inv.name, asOf: now.toISOString(), ...a } : { status: "unknown", message: "The inventory system has no record of this SKU." };
        } catch { stock = { status: "unavailable", message: "The inventory system could not be reached." }; }
      }
      return { product: redactCost(actor, p), bundle, tiers, variants, stock };
    },
  },
  {
    method: "PATCH", path: "/products/:id", permission: "products:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(productPatch, body);
      if (b.cost_price !== undefined && !can(actor, "cost:read")) throw badRequest("You cannot change cost prices");
      const cur = (await q.query<any>("SELECT * FROM sales_products WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Product");
      const upd = buildUpdate(b as Record<string, unknown>, PRODUCT_COLS);
      if (!upd) return { ok: true };
      await q.query(`UPDATE sales_products SET ${upd.set}, updated_at = now() WHERE id = $1`, [id, ...upd.params]);
      // quotations/orders keep the price they were created with; only new documents see the change
      await audit(q, actor, { action: "product.update", entityType: "product", entityId: id, summary: `Updated product ${cur.sku}`, before: redactCost(actor, { ...cur }), after: redactCost(actor, { ...b } as Record<string, unknown>) }, requestId);
      return { ok: true };
    },
  },
  {
    method: "PUT", path: "/products/:id/bundle", permission: "products:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ items: v.array(v.object({ product_id: v.id(), quantity: v.number({ min: 0.0001, max: 100000 }) }), { max: 50 }) }), body);
      const p = (await q.query<any>("SELECT id, kind FROM sales_products WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!p) throw notFound("Product");
      if (p.kind !== "bundle") throw conflict("Only a product of kind 'bundle' has components", "not_a_bundle");
      if (new Set(b.items.map((i) => i.product_id)).size !== b.items.length) throw badRequest("Each component can be listed once");
      for (const i of b.items) {
        const c = (await q.query<any>("SELECT kind FROM sales_products WHERE id = $1 AND archived_at IS NULL", [i.product_id])).rows[0];
        if (!c) throw badRequest(`Component ${i.product_id} does not exist`);
        if (c.kind === "bundle") throw badRequest("A bundle cannot contain another bundle");
        if (i.product_id === id) throw badRequest("A bundle cannot contain itself");
      }
      await q.query("DELETE FROM sales_bundle_items WHERE bundle_id = $1", [id]);
      for (const i of b.items) await q.query("INSERT INTO sales_bundle_items (bundle_id, product_id, quantity) VALUES ($1,$2,$3)", [id, i.product_id, i.quantity]);
      await audit(q, actor, { action: "product.bundle", entityType: "product", entityId: id, summary: `Set ${b.items.length} bundle component(s)` }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/products/:id", permission: "products:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const p = (await q.query<any>("SELECT sku FROM sales_products WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!p) throw notFound("Product");
      // history keeps its own copy of sku/name on each line, so archiving never rewrites past documents
      await q.query("UPDATE sales_products SET archived_at = now(), status = 'discontinued', updated_at = now() WHERE id = $1", [id]);
      await audit(q, actor, { action: "product.archive", entityType: "product", entityId: id, summary: `Archived ${p.sku}` }, requestId);
      return noContent();
    },
  },
  {
    method: "POST", path: "/pricing/resolve", permission: "products:read",
    async handler({ q, actor, body, now, settings }) {
      const b = parse(v.object({ account_id: v.optional(v.id()), currency: v.optional(v.string({ min: 3, max: 3, upper: true })), items: v.array(v.object({ product_id: v.id(), quantity: v.number({ min: 0.0001, max: 1e9 }) }), { min: 1, max: 100 }) }), body);
      const on = businessDate(now, settings.business.timezone);
      const ctx = await loadPriceContext(q, b.items.map((i) => i.product_id), on);
      const out = [];
      for (const it of b.items) {
        const p = (await q.query<any>("SELECT id, sku, name, base_price::text, cost_price::text, currency, category, tax_rate::text FROM sales_products WHERE id = $1 AND archived_at IS NULL AND status = 'active'", [it.product_id])).rows[0];
        if (!p) throw notFound(`Product ${it.product_id}`);
        const currency = b.currency ?? p.currency;
        const price = resolvePrice({ product: { id: p.id, basePrice: p.base_price, category: p.category }, quantity: String(it.quantity), accountId: b.account_id ?? null, currency, priceBooks: ctx.books, promotions: ctx.promos, on });
        out.push(redactCost(actor, { product_id: p.id, sku: p.sku, name: p.name, quantity: it.quantity, currency, tax_rate: p.tax_rate, cost_price: p.cost_price, ...price }));
      }
      return { items: out };
    },
  },
  // ───── price books
  {
    method: "GET", path: "/price-books", permission: "products:read", tx: false,
    async handler({ q }) {
      const r = await q.query("SELECT b.id, b.name, b.currency, b.is_default, b.account_id, a.name AS account_name, b.valid_from, b.valid_to, b.active, (SELECT count(*)::int FROM sales_price_book_entries e WHERE e.price_book_id = b.id) AS entries FROM sales_price_books b LEFT JOIN sales_accounts a ON a.id = b.account_id WHERE b.archived_at IS NULL ORDER BY b.is_default DESC, b.name");
      return { items: r.rows };
    },
  },
  {
    method: "POST", path: "/price-books", permission: "pricebooks:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ name: v.string({ min: 2, max: 120 }), currency: v.withDefault(v.string({ min: 3, max: 3, upper: true, pattern: /^[A-Z]{3}$/ }), "USD"), is_default: v.withDefault(v.boolean(), false), account_id: v.optional(v.id()), valid_from: v.optional(v.date()), valid_to: v.optional(v.date()) }), body);
      if (b.valid_from && b.valid_to && b.valid_to < b.valid_from) throw validationFailed([{ path: "valid_to", message: "End date is before the start date" }]);
      if (b.is_default && b.account_id) throw badRequest("A customer-specific price book cannot be the default");
      if (b.is_default) await q.query("UPDATE sales_price_books SET is_default = FALSE WHERE currency = $1 AND is_default AND archived_at IS NULL", [b.currency]);
      const r = await q.query<{ id: number }>("INSERT INTO sales_price_books (name, currency, is_default, account_id, valid_from, valid_to) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [b.name, b.currency, b.is_default, b.account_id ?? null, b.valid_from ?? null, b.valid_to ?? null]);
      await audit(q, actor, { action: "price_book.create", entityType: "price_book", entityId: r.rows[0]!.id, summary: `Created price book ${b.name}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "GET", path: "/price-books/:id", permission: "products:read", tx: false,
    async handler({ q, params }) {
      const id = parse(v.id(), params.id);
      const book = (await q.query("SELECT * FROM sales_price_books WHERE id = $1 AND archived_at IS NULL", [id])).rows[0];
      if (!book) throw notFound("Price book");
      const entries = (await q.query("SELECT e.id, e.product_id, p.sku, p.name, e.min_quantity, e.unit_price, p.base_price FROM sales_price_book_entries e JOIN sales_products p ON p.id = e.product_id WHERE e.price_book_id = $1 ORDER BY p.name, e.min_quantity", [id])).rows;
      return { book, entries };
    },
  },
  {
    method: "PUT", path: "/price-books/:id/entries", permission: "pricebooks:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ entries: v.array(v.object({ product_id: v.id(), min_quantity: v.withDefault(v.number({ min: 0.0001, max: 1e9 }), 1), unit_price: v.money() }), { max: 5000 }) }), body);
      const book = (await q.query("SELECT id FROM sales_price_books WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!book) throw notFound("Price book");
      const seen = new Set<string>();
      for (const e of b.entries) {
        const k = `${e.product_id}:${e.min_quantity}`;
        if (seen.has(k)) throw badRequest(`Duplicate quantity tier for product ${e.product_id}`);
        seen.add(k);
      }
      await q.query("DELETE FROM sales_price_book_entries WHERE price_book_id = $1", [id]);
      for (const e of b.entries) await q.query("INSERT INTO sales_price_book_entries (price_book_id, product_id, min_quantity, unit_price) VALUES ($1,$2,$3,$4)", [id, e.product_id, e.min_quantity, e.unit_price]);
      await audit(q, actor, { action: "price_book.entries", entityType: "price_book", entityId: id, summary: `Replaced entries (${b.entries.length})` }, requestId);
      return { ok: true, count: b.entries.length };
    },
  },
  {
    method: "PATCH", path: "/price-books/:id", permission: "pricebooks:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ name: v.optional(v.string({ min: 2, max: 120 })), active: v.optional(v.boolean()), valid_from: v.nullable(v.date()), valid_to: v.nullable(v.date()), is_default: v.optional(v.boolean()) }), body);
      const cur = (await q.query<any>("SELECT * FROM sales_price_books WHERE id = $1 AND archived_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Price book");
      const from = b.valid_from === undefined ? cur.valid_from : b.valid_from;
      const to = b.valid_to === undefined ? cur.valid_to : b.valid_to;
      if (from && to && String(to).slice(0, 10) < String(from).slice(0, 10)) throw validationFailed([{ path: "valid_to", message: "End date is before the start date" }]);
      if (b.is_default && cur.account_id) throw badRequest("A customer-specific price book cannot be the default");
      if (b.is_default) await q.query("UPDATE sales_price_books SET is_default = FALSE WHERE currency = $1 AND is_default AND archived_at IS NULL AND id <> $2", [cur.currency, id]);
      const upd = buildUpdate(b as Record<string, unknown>, { name: "name", active: "active", valid_from: "valid_from", valid_to: "valid_to", is_default: "is_default" });
      if (upd) await q.query(`UPDATE sales_price_books SET ${upd.set}, updated_at = now() WHERE id = $1`, [id, ...upd.params]);
      await audit(q, actor, { action: "price_book.update", entityType: "price_book", entityId: id, summary: `Updated price book ${cur.name}`, after: b }, requestId);
      return { ok: true };
    },
  },
  // ───── promotions
  {
    method: "GET", path: "/promotions", permission: "products:read", tx: false,
    async handler({ q }) {
      return { items: (await q.query("SELECT p.id, p.name, p.product_id, pr.name AS product_name, p.category, p.discount_percent, p.starts_on, p.ends_on, p.active FROM sales_promotions p LEFT JOIN sales_products pr ON pr.id = p.product_id WHERE p.archived_at IS NULL ORDER BY p.starts_on DESC")).rows };
    },
  },
  {
    method: "POST", path: "/promotions", permission: "pricebooks:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(v.object({ name: v.string({ min: 2, max: 120 }), product_id: v.optional(v.id()), category: v.optional(v.string({ max: 80 })), discount_percent: v.number({ min: 0.01, max: 100 }), starts_on: v.date(), ends_on: v.date() }), body);
      if (!b.product_id && !b.category) throw validationFailed([{ path: "product_id", message: "Choose a product or a category" }]);
      if (b.ends_on < b.starts_on) throw validationFailed([{ path: "ends_on", message: "End date is before the start date" }]);
      const r = await q.query<{ id: number }>("INSERT INTO sales_promotions (name, product_id, category, discount_percent, starts_on, ends_on) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [b.name, b.product_id ?? null, b.category ?? null, b.discount_percent, b.starts_on, b.ends_on]);
      await audit(q, actor, { action: "promotion.create", entityType: "promotion", entityId: r.rows[0]!.id, summary: `Created promotion ${b.name}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "DELETE", path: "/promotions/:id", permission: "pricebooks:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_promotions SET archived_at = now(), active = FALSE WHERE id = $1 AND archived_at IS NULL RETURNING id", [id]);
      if (!r.rows[0]) throw notFound("Promotion");
      await audit(q, actor, { action: "promotion.archive", entityType: "promotion", entityId: id, summary: "Archived promotion" }, requestId);
      return noContent();
    },
  },
];
void cmp;
