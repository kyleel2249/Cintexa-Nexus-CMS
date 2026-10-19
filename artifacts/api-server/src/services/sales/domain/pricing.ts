import type { SalesRole } from "../core/types";
import type { SalesSettings } from "../core/settings";
import { cmp, mulQty, ratioPercent, sub, gt, lt, add } from "../core/money";

export interface BookEntry {
  productId: number;
  minQuantity: string;
  unitPrice: string;
}
export interface PriceBook {
  id: number;
  accountId: number | null;
  isDefault: boolean;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  currency: string;
  entries: BookEntry[];
}
export interface Promotion {
  id: number;
  productId: number | null;
  category: string | null;
  discountPercent: string;
  startsOn: string;
  endsOn: string;
  active: boolean;
}

export interface ResolvedPrice {
  listPrice: string;
  unitPrice: string;
  source: "customer_price_book" | "price_book" | "base_price";
  priceBookId: number | null;
  /** best applicable promotion (suggested discount, not baked into unitPrice) */
  promotion: { id: number; percent: string } | null;
}

const validOn = (b: { validFrom: string | null; validTo: string | null }, on: string) => (!b.validFrom || b.validFrom <= on) && (!b.validTo || b.validTo >= on);

function tier(entries: BookEntry[], productId: number, qty: string): BookEntry | null {
  const candidates = entries.filter((e) => e.productId === productId && cmp(e.minQuantity, qty) <= 0).sort((a, b) => cmp(b.minQuantity, a.minQuantity));
  return candidates[0] ?? null;
}

/** qty entries use up to 4dp; money.cmp is 2dp so compare qty with a local decimal comparer */
function cmpQty(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function tierQty(entries: BookEntry[], productId: number, qty: string): BookEntry | null {
  const candidates = entries.filter((e) => e.productId === productId && cmpQty(e.minQuantity, qty) <= 0).sort((a, b) => cmpQty(b.minQuantity, a.minQuantity));
  return candidates[0] ?? null;
}
void tier;

export function resolvePrice(args: {
  product: { id: number; basePrice: string; category: string | null };
  quantity: string;
  accountId: number | null;
  currency: string;
  priceBooks: PriceBook[];
  promotions: Promotion[];
  on: string;
}): ResolvedPrice {
  const { product, quantity, accountId, currency, on } = args;
  const books = args.priceBooks.filter((b) => b.active && b.currency === currency && validOn(b, on));
  let unitPrice = product.basePrice;
  let source: ResolvedPrice["source"] = "base_price";
  let priceBookId: number | null = null;

  const customer = books.filter((b) => accountId !== null && b.accountId === accountId);
  const general = books.filter((b) => b.accountId === null).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id);
  for (const b of customer) {
    const e = tierQty(b.entries, product.id, quantity);
    if (e) {
      unitPrice = e.unitPrice;
      source = "customer_price_book";
      priceBookId = b.id;
      break;
    }
  }
  if (source === "base_price") {
    for (const b of general) {
      const e = tierQty(b.entries, product.id, quantity);
      if (e) {
        unitPrice = e.unitPrice;
        source = "price_book";
        priceBookId = b.id;
        break;
      }
    }
  }

  let promotion: ResolvedPrice["promotion"] = null;
  for (const p of args.promotions) {
    if (!p.active || on < p.startsOn || on > p.endsOn) continue;
    if (!((p.productId !== null && p.productId === product.id) || (p.productId === null && p.category !== null && p.category === product.category))) continue;
    if (!promotion || Number(p.discountPercent) > Number(promotion.percent)) promotion = { id: p.id, percent: p.discountPercent };
  }
  return { listPrice: product.basePrice, unitPrice, source, priceBookId, promotion };
}

export type ApprovalReason = "discount_exceeds_limit" | "margin_below_minimum" | "credit_limit_exceeded" | "order_over_threshold" | "price_below_list";

export interface ApprovalFinding {
  code: ApprovalReason;
  message: string;
}

export function discountLimitFor(role: SalesRole, cfg: SalesSettings["discounts"]): number {
  switch (role) {
    case "sales_rep": return cfg.repMaxPercent;
    case "sales_manager": return cfg.managerMaxPercent;
    case "sales_director":
    case "sales_admin": return cfg.directorMaxPercent;
    default: return 0;
  }
}

export interface ApprovalInput {
  ownerRole: SalesRole;
  /** the largest discount percentage on any single line, 0-100 */
  maxLineDiscountPercent: number;
  marginPercent: number | null;
  total: string;
  creditLimit: string | null;
  openExposure: string;
  /** orders only */
  orderApprovalThreshold?: string;
  /** any line sold below its list price (before explicit discount) */
  belowList?: boolean;
}

export function evaluateApproval(input: ApprovalInput, cfg: SalesSettings["discounts"], orderCfg?: SalesSettings["orders"]): ApprovalFinding[] {
  const out: ApprovalFinding[] = [];
  const limit = discountLimitFor(input.ownerRole, cfg);
  if (input.maxLineDiscountPercent > limit) out.push({ code: "discount_exceeds_limit", message: `A line is discounted ${input.maxLineDiscountPercent}%, above the ${limit}% limit for this role` });
  if (input.belowList) out.push({ code: "price_below_list", message: "A line is priced below its list price" });
  if (input.marginPercent !== null && input.marginPercent < cfg.minMarginPercent) out.push({ code: "margin_below_minimum", message: `Margin ${input.marginPercent}% is below the ${cfg.minMarginPercent}% minimum` });
  if (cfg.creditCheck && input.creditLimit !== null && gt(add(input.openExposure, input.total), input.creditLimit)) {
    out.push({ code: "credit_limit_exceeded", message: `Open exposure plus this document exceeds the credit limit of ${input.creditLimit}` });
  }
  const threshold = input.orderApprovalThreshold ?? orderCfg?.approvalThreshold;
  if (threshold && gt(input.total, threshold)) out.push({ code: "order_over_threshold", message: `Total exceeds the ${threshold} approval threshold` });
  return out;
}

/** Can a person with `role` approve a document that triggered these findings? */
export function approverCanApprove(role: SalesRole, findings: ApprovalFinding[], maxLineDiscountPercent: number, cfg: SalesSettings["discounts"]): { ok: boolean; reason?: string } {
  if (!["sales_manager", "sales_director", "sales_admin", "finance"].includes(role)) return { ok: false, reason: "Your role cannot approve pricing exceptions" };
  for (const f of findings) {
    if (f.code === "discount_exceeds_limit" || f.code === "price_below_list") {
      if (role === "finance") return { ok: false, reason: "Finance cannot approve discount exceptions" };
      if (maxLineDiscountPercent > discountLimitFor(role, cfg)) return { ok: false, reason: `Discount ${maxLineDiscountPercent}% exceeds your approval limit of ${discountLimitFor(role, cfg)}%` };
    }
    if (f.code === "margin_below_minimum" && role === "sales_manager") return { ok: false, reason: "Margin exceptions need a Sales Director or Administrator" };
    if (f.code === "credit_limit_exceeded" && role === "sales_manager") return { ok: false, reason: "Credit exceptions need Finance, a Sales Director or an Administrator" };
    if (f.code === "order_over_threshold" && role === "sales_manager") return { ok: false, reason: "Orders over the approval threshold need a Sales Director, Finance or an Administrator" };
  }
  return { ok: true };
}

export function lineMarginPercent(net: string, cost: string | null): number | null {
  if (cost === null) return null;
  return ratioPercent(sub(net, cost), net);
}

export { mulQty, lt };
