import { useEffect, useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation } from "@/lib/sales/hooks";
import { money, todayIso } from "@/lib/sales/format";
import { Modal, Field, Input, Textarea, MoneyInput } from "./ui";
import { AccountPicker } from "./pickers";
import { Hint } from "./Hint";
import { cn } from "@/lib/utils";

export interface Pkg { code: string; name: string; tagline: string; price: string; currency: string; upfront_percent: string; upfront_note: string | null; instalments: number; accent: string; terms: string | null; active: boolean; features: { position: number; text: string; optional: boolean }[]; upfront: string; balance: string; monthly: string; lastInstalment: string }
export const ACCENT: Record<string, { ring: string; head: string; chip: string }> = {
  blue: { ring: "border-blue-500", head: "bg-blue-600", chip: "text-blue-600" }, green: { ring: "border-green-600", head: "bg-green-600", chip: "text-green-600" },
  purple: { ring: "border-purple-600", head: "bg-purple-600", chip: "text-purple-600" }, orange: { ring: "border-orange-500", head: "bg-orange-500", chip: "text-orange-500" },
};
const cents = (v: string) => Math.round(Number(v || 0) * 100);

/** Create a sales order from a website package: choose, customise, preview the payment plan, save (order + frozen agreement + schedule in one step). */
export function WebsitePackageOrderModal({ open, onClose, packages, initialCode, onCreated }: { open: boolean; onClose: () => void; packages: Pkg[]; initialCode?: string; onCreated: (id: number) => void }) {
  const [acc, setAcc] = useState({ id: "", name: "" });
  const [code, setCode] = useState(initialCode ?? packages[0]?.code ?? "");
  const [booking, setBooking] = useState(todayIso());
  const [price, setPrice] = useState(""); const [disc, setDisc] = useState("");
  const [extras, setExtras] = useState<{ description: string; quantity: string; unit_price: string }[]>([]);
  const [req, setReq] = useState(""); const [terms, setTerms] = useState(""); const [notes, setNotes] = useState("");
  const [pct, setPct] = useState(""); const [n, setN] = useState(""); const [first, setFirst] = useState("");
  const [plan, setPlan] = useState<{ items: { seq: number; label: string; due_on: string; amount: string }[]; total: string; upfront: string; balance: string } | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const pkg = packages.find((p) => p.code === code);
  useEffect(() => { if (open && initialCode) setCode(initialCode); }, [open, initialCode]);
  useEffect(() => { setPrice(""); setPct(""); setN(""); }, [code]);
  const agreed = price || pkg?.price || "0";
  const afterDiscount = String((cents(agreed) - Math.round(cents(agreed) * (Number(disc || 0) / 100))) / 100);
  const extrasTotal = String(extras.reduce((t, e) => t + Math.round(Number(e.quantity || 0) * cents(e.unit_price)), 0) / 100);
  useEffect(() => {
    if (!open || !pkg) return; let live = true;
    const t = setTimeout(() => { sales.post<any>("/website-packages/preview", { package_code: code, agreed_price: afterDiscount, extras_total: extrasTotal, booking_date: booking, ...(pct ? { upfront_percent: Number(pct) } : {}), ...(n ? { instalments: Number(n) } : {}), ...(first ? { first_due_on: first } : {}) }).then((r) => { if (live) { setPlan(r); setPlanErr(null); } }).catch((e) => { if (live) { setPlan(null); setPlanErr(e?.message ?? "Invalid plan"); } }); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [open, code, afterDiscount, extrasTotal, booking, pct, n, first, pkg]);
  const m = useSalesMutation(() => sales.post<any>("/orders/package", { account_id: Number(acc.id), package_code: code, booking_date: booking, ...(price ? { agreed_price: price } : {}), ...(disc ? { discount_percent: Number(disc) } : {}), extras: extras.filter((e) => e.description && e.unit_price).map((e) => ({ description: e.description, quantity: Number(e.quantity || 1), unit_price: e.unit_price })), requirements: req || undefined, custom_terms: terms || undefined, notes: notes || undefined, ...(pct ? { upfront_percent: Number(pct) } : {}), ...(n ? { instalments: Number(n) } : {}), ...(first ? { first_due_on: first } : {}) }, { idempotent: true }), { invalidate: ["/orders", "/dashboard", "/fx"], success: "Order created", onSuccess: (r: any) => { onClose(); onCreated(r.id); } });
  return (
    <Modal open={open} onClose={onClose} size="xl" title="New website package order" description="Pick a package, adjust anything that was negotiated, check the payment plan, and save. The package is frozen on the order at today's catalogue terms." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.pending || !acc.id || !pkg || !!planErr} onClick={() => void m.run()}>Create order</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer account" required><AccountPicker value={acc.id} initialName={acc.name} onChange={(id, name) => setAcc({ id, name })} /></Field>
        <Field label="Booking date" required explain="Past, today or future. Reports record the sale on this date."><Input type="date" value={booking} onChange={(e) => setBooking(e.target.value)} /></Field>
      </div>
      <p className="mt-2 text-xs font-medium uppercase text-muted-foreground">Package</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Website package">
        {packages.filter((p) => p.active).map((p) => { const a = ACCENT[p.accent] ?? ACCENT.blue!; const on = p.code === code; return (
          <button key={p.code} type="button" role="radio" aria-checked={on} onClick={() => setCode(p.code)} className={cn("rounded-lg border-2 p-3 text-left transition", on ? `${a.ring} bg-secondary/50` : "border-border hover:border-muted-foreground")}>
            <span className={cn("flex items-center gap-1 text-xs font-semibold", a.chip)}>{on && <Check className="h-3 w-3" />}{p.name}</span><span className="mt-1 block text-lg font-semibold tabular-nums">{money(p.price, p.currency)}</span>
            <span className="block text-xs text-muted-foreground">{money(p.upfront, p.currency)} upfront · {p.instalments} × {money(p.monthly, p.currency)}</span></button>); })}
      </div>
      {pkg && <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">{pkg.features.map((f) => <li key={f.position}>✓ {f.text}</li>)}</ul>}
      <p className="mt-3 text-xs font-medium uppercase text-muted-foreground">Customise (optional)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Agreed price (catalogue ${pkg ? money(pkg.price, pkg.currency) : ""})`}><MoneyInput value={price} onChange={setPrice} placeholder={pkg?.price} /></Field>
        <Field label="Discount %" explain="Applied to the package price. Discounts normally apply to full upfront payments."><Input type="number" min={0} max={100} step="0.01" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
      </div>
      {extras.map((e, i) => <div key={i} className="mt-2 grid grid-cols-[1fr_5rem_8rem_2rem] items-end gap-2"><Field label={i === 0 ? "Additional service / custom item" : undefined}><Input value={e.description} onChange={(ev) => setExtras(extras.map((x, k) => k === i ? { ...x, description: ev.target.value } : x))} /></Field><Field label={i === 0 ? "Qty" : undefined}><Input type="number" min={0} value={e.quantity} onChange={(ev) => setExtras(extras.map((x, k) => k === i ? { ...x, quantity: ev.target.value } : x))} /></Field><Field label={i === 0 ? "Unit price" : undefined}><MoneyInput value={e.unit_price} onChange={(v) => setExtras(extras.map((x, k) => k === i ? { ...x, unit_price: v } : x))} /></Field><Button type="button" variant="ghost" size="sm" aria-label="Remove item" onClick={() => setExtras(extras.filter((_, k) => k !== i))}><X className="h-4 w-4" /></Button></div>)}
      <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setExtras([...extras, { description: "", quantity: "1", unit_price: "" }])}><Plus className="mr-1 h-3.5 w-3.5" />Add service, custom item or charge</Button>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Project requirements"><Textarea rows={2} value={req} onChange={(e) => setReq(e.target.value)} /></Field><Field label="Special terms for this customer"><Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field></div>
      <Field label="Internal notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <p className="mt-3 flex items-center text-xs font-medium uppercase text-muted-foreground">Payment plan<Hint text="Default: 50% upfront, the rest in equal monthly instalments. Change the percentage, the number of instalments or the first instalment date if agreed otherwise. The last payment absorbs rounding." /></p>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Upfront %"><Input type="number" min={0} max={100} step="0.01" value={pct} placeholder={pkg?.upfront_percent} onChange={(e) => setPct(e.target.value)} /></Field><Field label="Instalments"><Input type="number" min={0} max={60} value={n} placeholder={String(pkg?.instalments ?? "")} onChange={(e) => setN(e.target.value)} /></Field><Field label="First instalment date"><Input type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field></div>
      {planErr && <p role="alert" className="text-sm text-rose-500">{planErr}</p>}
      {plan && <div className="mt-2 rounded-md border p-3 text-sm"><p className="mb-1 font-medium">Total {money(plan.total, pkg?.currency)} · upfront {money(plan.upfront, pkg?.currency)} · balance {money(plan.balance, pkg?.currency)}</p><ul className="grid gap-x-4 sm:grid-cols-2">{plan.items.map((i) => <li key={i.seq} className="flex justify-between text-xs"><span>{i.label} · {i.due_on}</span><span className="tabular-nums">{money(i.amount, pkg?.currency)}</span></li>)}</ul><p className="mt-1 text-[11px] text-muted-foreground">Final amounts are calculated when the order is saved.</p></div>}
      {m.error && <p role="alert" className="mt-2 text-sm text-rose-500">{m.error.message}</p>}
    </Modal>
  );
}
