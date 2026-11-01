/** The eight order documents. Each is generated from the saved order (GET /orders/:id/agreement), never from sample data. */
import { Pdf, ACCENTS, NAVY, fmt, dmy } from "./pdf";

export interface Agreement {
  order: { id: number; number: string; status: string; currency: string; subtotal: string; discount_total: string; tax_total: string; total: string; paid_total: string; payment_status: string; payment_terms_days: number; notes: string | null; created_at: string; confirmed_at: string | null; booking_date: string | null };
  package: null | { package_code: string; snapshot: { name: string; description: string; features: { text: string; optional: boolean; included: boolean }[]; catalogue: { price: string; upfront_percent: string; upfront_note: string | null; instalments: number; frequency: string }; terms: string | null; code: string }; original_price: string; agreed_price: string; requirements: string | null; custom_terms: string | null; modifications: any[] };
  lines: { description: string; quantity: string; unit_price: string; discount_percent: string | number; total: string }[];
  payments: { id: string | number; amount: string; method: string; reference: string | null; received_on: string; status: string; recorded_by: string; notes: string | null }[];
  account: { name: string; number: string; email: string | null; phone: string | null; address_line: string | null; city: string | null; country: string | null } | null;
  contact: { first_name: string; last_name: string | null; email: string | null; phone: string | null; job_title: string | null } | null;
  owner: { display_name: string; email: string } | null;
  summary: { currency: string; total: string; planTotal: string; planMatchesTotal: boolean; upfrontExpected: string; upfrontReceived: string; totalPaid: string; outstanding: string; instalmentsTotal: number; instalmentsPaid: number; instalmentsPending: number; instalmentsOverdue: number; completionPercent: number; nextDue: { label: string; due_on: string; outstanding: string; status: string } | null; schedule: { seq: number; kind: string; label: string; due_on: string; amount: string; allocated: string; outstanding: string; status: string; note: string | null }[] };
  generated_at: string;
}
export type DocKey = "confirmation" | "quotation" | "proposal" | "payment_plan" | "schedule" | "receipt" | "statement" | "agreement";
export const ORDER_DOCS: { key: DocKey; label: string; needsPackage?: boolean }[] = [
  { key: "confirmation", label: "Sales order confirmation" }, { key: "quotation", label: "Customer quotation" }, { key: "proposal", label: "Website package proposal", needsPackage: true },
  { key: "payment_plan", label: "Payment plan" }, { key: "schedule", label: "Instalment schedule" }, { key: "receipt", label: "Payment receipt" }, { key: "statement", label: "Outstanding balance statement" }, { key: "agreement", label: "Customer agreement", needsPackage: true },
];
const T = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const accentOf = (a: Agreement) => ACCENTS[(a.package && ({ basic: "blue", seo_growth: "green", seo_ai_support: "purple", premium: "orange" } as any)[a.package.package_code]) || "navy"] ?? NAVY;

function parties(p: Pdf, a: Agreement) {
  const c = a.account, k = a.contact, o = a.order;
  p.heading("Customer");
  p.kv([["Business", c?.name ?? "-"], ["Customer no.", c?.number ?? "-"], ["Contact", k ? `${k.first_name} ${k.last_name ?? ""}`.trim() + (k.job_title ? ` (${k.job_title})` : "") : "-"], ["Email", k?.email ?? c?.email ?? "-"], ["Phone", k?.phone ?? c?.phone ?? "-"], ["Address", [c?.address_line, c?.city, c?.country].filter(Boolean).join(", ") || "-"]]);
  p.heading("Order");
  p.kv([["Reference", o.number], ["Booking date", dmy(o.booking_date)], ["Status", T(o.status)], ["Payment status", T(o.payment_status)], ["Sales representative", a.owner?.display_name ?? "-"], ["Currency", `${o.currency === "GHS" ? "GHC (Ghana Cedi)" : o.currency}`], ["Entered on", dmy(o.created_at)], ["Confirmed on", o.confirmed_at ? dmy(o.confirmed_at) : "Not yet confirmed"]]);
}
function lines(p: Pdf, a: Agreement) {
  const o = a.order; p.heading("Items");
  p.table(["Description", "Qty", "Unit price", "Disc. %", "Total"], a.lines.map((l) => [l.description, String(Number(l.quantity)), fmt(l.unit_price, o.currency), String(Number(l.discount_percent)), fmt(l.total, o.currency)]), { align: ["left", "right", "right", "right", "right"], widths: [80, 15, 32, 17, 38] });
  p.totals([["Subtotal", fmt(o.subtotal, o.currency)], ...(Number(o.discount_total) ? [["Discount", "-" + fmt(o.discount_total, o.currency)] as [string, string]] : []), ["Tax", fmt(o.tax_total, o.currency)], ["Total", fmt(o.total, o.currency), true]]);
}
function schedule(p: Pdf, a: Agreement, withStatus: boolean) {
  const o = a.order, s = a.summary; p.heading("Payment schedule");
  p.kv([["Total agreed", fmt(o.total, o.currency)], ["Upfront", fmt(s.upfrontExpected, o.currency)], ["Remaining balance", fmt((Number(o.total) * 100 - Math.round(Number(s.upfrontExpected) * 100)) / 100 + "", o.currency)], ["Scheduled payments", String(s.schedule.length)]]);
  p.table(withStatus ? ["#", "Payment", "Due date", "Amount", "Paid", "Outstanding", "Status"] : ["#", "Payment", "Due date", "Amount"], s.schedule.map((i) => withStatus ? [String(i.seq), i.label, dmy(i.due_on), fmt(i.amount, o.currency), fmt(i.allocated, o.currency), fmt(i.outstanding, o.currency), T(i.status)] : [String(i.seq), i.label, dmy(i.due_on), fmt(i.amount, o.currency)]),
    { align: withStatus ? ["center", "left", "left", "right", "right", "right", "left"] : ["center", "left", "left", "right"], foot: [["", "Total", "", fmt(s.planTotal, o.currency), ...(withStatus ? [fmt(s.totalPaid, o.currency), fmt(s.outstanding, o.currency), ""] : [])]] });
}
function features(p: Pdf, a: Agreement) {
  const k = a.package!; p.heading("Package"); p.text(k.snapshot.name, { bold: true, size: 12 }); p.text(k.snapshot.description, { muted: true });
  p.text("Included features", { bold: true }); p.bullets(k.snapshot.features.filter((f) => f.included).map((f) => f.text));
  const removed = k.snapshot.features.filter((f) => !f.included); if (removed.length) { p.text("Not included in this agreement", { bold: true }); p.bullets(removed.map((f) => f.text)); }
}
function mods(p: Pdf, a: Agreement) {
  const k = a.package!, o = a.order, rows = k.modifications.map((m: any) => m.type === "price_change" ? ["Agreed price", `${fmt(m.from, o.currency)} -> ${fmt(m.to, o.currency)}`] : m.type === "discount_percent" ? ["Discount", `${m.value}%`] : m.type === "discount_amount" ? ["Discount", fmt(m.value, o.currency)] : m.type === "extra_item" ? ["Additional item", `${m.description} (${Number(m.quantity)} x ${fmt(m.unit_price, o.currency)})`] : m.type === "feature_removed" ? ["Feature removed", `#${m.position}`] : ["Payment terms changed", `Upfront ${fmt(m.upfront, o.currency)}, ${m.instalments} instalments`]);
  p.heading("Package price"); p.kv([["Catalogue price", fmt(k.original_price, o.currency)], ["Agreed price", fmt(k.agreed_price, o.currency)], ["Upfront", `${k.snapshot.catalogue.upfront_percent}% - ${k.snapshot.catalogue.upfront_note ?? ""}`], ["Standard instalments", `${k.snapshot.catalogue.instalments} x ${k.snapshot.catalogue.frequency}`]]);
  if (rows.length) { p.text("Negotiated changes to the standard package", { bold: true }); p.table(["Change", "Detail"], rows as string[][]); }
}
function terms(p: Pdf, a: Agreement) {
  p.heading("Terms & conditions"); const k = a.package;
  p.text(k?.snapshot.terms ?? `Payment terms: ${a.order.payment_terms_days} days. All prices are in ${a.order.currency === "GHS" ? "Ghana Cedis (GHC)" : a.order.currency}. Terms & conditions apply.`);
  if (k?.custom_terms) { p.text("Additional terms agreed with the customer", { bold: true }); p.text(k.custom_terms); }
  if (k?.requirements) { p.text("Customer / project requirements", { bold: true }); p.text(k.requirements); }
  if (a.order.notes) { p.text("Notes", { bold: true }); p.text(a.order.notes); }
}

export function buildOrderDoc(key: DocKey, a: Agreement, opt: { paymentId?: string | number } = {}): Pdf {
  const o = a.order, acc = accentOf(a), s = a.summary;
  if ((key === "proposal" || key === "agreement") && !a.package) throw new Error("This order has no website package, so this document is not available.");
  const title = { confirmation: "SALES ORDER CONFIRMATION", quotation: "CUSTOMER QUOTATION", proposal: "WEBSITE PACKAGE PROPOSAL", payment_plan: "PAYMENT PLAN", schedule: "INSTALMENT SCHEDULE", receipt: "PAYMENT RECEIPT", statement: "OUTSTANDING BALANCE STATEMENT", agreement: "CUSTOMER AGREEMENT" }[key];
  const p = new Pdf(title, o.number, acc, "p", `Booked ${dmy(o.booking_date)}`);
  if (key === "confirmation" || key === "quotation") { parties(p, a); if (a.package) features(p, a); lines(p, a); schedule(p, a, false); terms(p, a); if (key === "quotation") p.signatures(["Customer acceptance (name, signature, date)", "For CINTEXA"]); }
  if (key === "proposal") { parties(p, a); features(p, a); mods(p, a); lines(p, a); schedule(p, a, false); terms(p, a); }
  if (key === "payment_plan") { parties(p, a); if (a.package) { p.heading("Package"); p.text(a.package.snapshot.name, { bold: true }); } schedule(p, a, false); p.text(`Rounding: the final scheduled payment absorbs any rounding so the plan equals the agreed total exactly (${fmt(o.total, o.currency)}).`, { muted: true }); terms(p, a); }
  if (key === "schedule") { p.heading("Order"); p.kv([["Reference", o.number], ["Customer", a.account?.name ?? "-"], ["Booking date", dmy(o.booking_date)], ["Paid so far", fmt(s.totalPaid, o.currency)], ["Outstanding", fmt(s.outstanding, o.currency)], ["Completion", `${s.completionPercent}%`]]); schedule(p, a, true); p.text(`Paid ${s.instalmentsPaid} of ${s.instalmentsTotal} instalments | ${s.instalmentsOverdue} overdue | next due: ${s.nextDue ? `${s.nextDue.label}, ${dmy(s.nextDue.due_on)} (${fmt(s.nextDue.outstanding, o.currency)})` : "none"}`, { muted: true }); }
  if (key === "receipt") {
    const rec = a.payments.filter((x) => x.status === "recorded"); const idx = opt.paymentId !== undefined ? rec.findIndex((x) => String(x.id) === String(opt.paymentId)) : rec.length - 1;
    if (idx < 0) throw new Error("There is no recorded payment on this order to issue a receipt for.");
    const pay = rec[idx]!; const before = rec.slice(0, idx + 1).reduce((t, x) => t + Math.round(Number(x.amount) * 100), 0), balance = (Math.round(Number(o.total) * 100) - before) / 100;
    parties(p, a); p.heading("Payment received");
    p.kv([["Receipt for", `${o.number}-R${idx + 1}`], ["Amount received", fmt(pay.amount, o.currency)], ["Payment date", dmy(pay.received_on)], ["Method", T(pay.method)], ["Transaction reference", pay.reference ?? "-"], ["Recorded by", pay.recorded_by], ["Notes", pay.notes ?? "-"], ["Currency", o.currency]]);
    p.totals([["Order total", fmt(o.total, o.currency)], ["Paid to date (incl. this payment)", fmt(String(before / 100), o.currency)], ["Balance remaining", fmt(String(balance < 0 ? 0 : balance), o.currency), true]]);
    p.text("This receipt confirms a payment recorded by CINTEXA staff against the order above.", { muted: true }); p.signatures(["Received by (CINTEXA)"]);
  }
  if (key === "statement") {
    parties(p, a); p.heading("Balance"); p.totals([["Total agreed", fmt(o.total, o.currency)], ["Total paid", fmt(s.totalPaid, o.currency)], ["Outstanding balance", fmt(s.outstanding, o.currency), true]]);
    p.text(`${s.instalmentsOverdue} overdue | next due: ${s.nextDue ? `${s.nextDue.label} on ${dmy(s.nextDue.due_on)} - ${fmt(s.nextDue.outstanding, o.currency)}` : "nothing due"}`);
    schedule(p, a, true); p.heading("Payments received");
    const rec = a.payments.filter((x) => x.status === "recorded"); if (rec.length) p.table(["Date", "Reference", "Method", "Amount"], rec.map((x) => [dmy(x.received_on), x.reference ?? "-", T(x.method), fmt(x.amount, o.currency)]), { align: ["left", "left", "left", "right"] }); else p.text("No payments have been recorded yet.", { muted: true });
  }
  if (key === "agreement") {
    parties(p, a); features(p, a); mods(p, a); lines(p, a); schedule(p, a, true);
    p.heading("Payments received"); const rec = a.payments.filter((x) => x.status === "recorded"); if (rec.length) p.table(["Date", "Reference", "Method", "Amount"], rec.map((x) => [dmy(x.received_on), x.reference ?? "-", T(x.method), fmt(x.amount, o.currency)]), { align: ["left", "left", "left", "right"] }); else p.text("No payments recorded yet.", { muted: true });
    terms(p, a); p.signatures(["Customer (name, signature, date)", "Authorised for CINTEXA (name, signature, date)"]);
  }
  return p;
}
export const docFilename = (key: DocKey, a: Agreement) => `${a.order.number}-${key}.pdf`;
