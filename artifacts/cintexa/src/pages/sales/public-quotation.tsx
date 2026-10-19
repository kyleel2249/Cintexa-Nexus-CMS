import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { publicCall, SalesApiError } from "@/lib/sales/api";
import { dateOnly, money, num } from "@/lib/sales/format";
import { Input, Textarea, Field, Checkbox, Spinner } from "@/components/sales/ui";

interface Line { position: number; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string; net: string; tax: string; total: string }
interface Quote { number: string; version: number; status: string; customer: string; currency: string; validity_date: string; subtotal: string; discount_total: string; tax_total: string; total: string; terms: string | null; delivery_terms: string | null; payment_terms_days: number | null; lines: Line[]; contact: { display_name: string; email: string } | null; canRespond: boolean }

const STATUS_TEXT: Record<string, string> = { accepted: "You accepted this quotation.", rejected: "You declined this quotation.", expired: "This quotation has expired. Please contact us for an updated one.", cancelled: "This quotation is no longer available.", superseded: "A newer version of this quotation has been issued. Please contact us." };

/** Customer-facing quotation (no sign-in). Acceptance is recorded with name, time and the quoted total; it is not a verified e-signature. */
export default function PublicQuotation({ token }: { token: string }) {
  const [q, setQ] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    publicCall<Quote>("GET", `/quotations/${encodeURIComponent(token)}`).then((r) => { if (!off) setQ(r); }).catch((e: SalesApiError) => { if (!off) setError(e.status === 404 ? "This quotation link is invalid or has been withdrawn." : e.message); });
    return () => { off = true; };
  }, [token]);

  async function respond(kind: "accept" | "decline") {
    setBusy(true); setFormError(null);
    try {
      const r = await publicCall<{ message?: string }>("POST", `/quotations/${encodeURIComponent(token)}/${kind}`, kind === "accept" ? { name: name.trim(), agree } : { reason: reason.trim() || undefined });
      setDone(r.message ?? (kind === "accept" ? "Thank you. Your acceptance has been recorded." : "Your response has been recorded."));
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        {error ? <div role="alert" className="rounded-lg border bg-card p-8 text-center"><h1 className="text-xl font-semibold">Quotation unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p></div>
          : !q ? <div className="flex justify-center py-20"><Spinner className="h-6 w-6" /></div> : (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
              <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Quotation</p><h1 className="text-2xl font-semibold">{q.number}{q.version > 1 ? ` · v${q.version}` : ""}</h1><p className="text-sm text-muted-foreground">Prepared for {q.customer}</p></div>
              <div className="text-right text-sm"><p>Valid until <strong>{dateOnly(q.validity_date)}</strong></p>{q.contact && <p className="text-muted-foreground">{q.contact.display_name} · <a className="text-primary hover:underline" href={`mailto:${q.contact.email}`}>{q.contact.email}</a></p>}</div>
            </header>
            <div className="my-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">#</th><th className="pr-2">Description</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Unit price</th><th className="pr-2 text-right">Disc %</th><th className="text-right">Total</th></tr></thead>
                <tbody>{q.lines.map((l) => <tr key={l.position} className="border-b"><td className="py-2 pr-2">{l.position}</td><td className="pr-2">{l.description}</td><td className="pr-2 text-right">{num(Number(l.quantity), 2)}</td><td className="pr-2 text-right">{money(l.unit_price, q.currency)}</td><td className="pr-2 text-right">{Number(l.discount_percent) ? num(Number(l.discount_percent), 2) : "—"}</td><td className="text-right">{money(l.total, q.currency)}</td></tr>)}</tbody>
              </table>
            </div>
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{money(q.subtotal, q.currency)}</dd></div>
              {Number(q.discount_total) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd>-{money(q.discount_total, q.currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd>{money(q.tax_total, q.currency)}</dd></div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd>{money(q.total, q.currency)}</dd></div>
            </dl>
            {(q.terms || q.delivery_terms || q.payment_terms_days != null) && <section className="mt-6 text-sm"><h2 className="mb-1 font-semibold">Terms</h2>{q.payment_terms_days != null && <p>Payment terms: {q.payment_terms_days} days</p>}{q.delivery_terms && <p className="whitespace-pre-wrap">Delivery: {q.delivery_terms}</p>}{q.terms && <p className="whitespace-pre-wrap text-muted-foreground">{q.terms}</p>}</section>}
            <section className="mt-6 border-t pt-4" aria-live="polite">
              {done ? <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm">{done}</p>
                : !q.canRespond ? <p className="text-sm text-muted-foreground">{STATUS_TEXT[q.status] ?? "This quotation can no longer be answered online."}</p>
                : declining ? (
                  <div className="space-y-3"><Field label="Reason (optional)"><Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                    <div className="flex gap-2"><Button variant="outline" onClick={() => setDeclining(false)}>Back</Button><Button disabled={busy} onClick={() => void respond("decline")}>Decline quotation</Button></div></div>
                ) : (
                  <div className="space-y-3">
                    <h2 className="font-semibold">Accept this quotation</h2>
                    <Field label="Your full name" required><Input value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
                    <Checkbox label={`I accept this quotation for ${money(q.total, q.currency)}`} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                    <p className="text-xs text-muted-foreground">Your name, the time, and the quoted total are recorded as evidence of acceptance.</p>
                    {formError && <p role="alert" className="text-sm text-rose-500">{formError}</p>}
                    <div className="flex flex-wrap gap-2"><Button disabled={busy || name.trim().length < 2 || !agree} onClick={() => void respond("accept")}>{busy ? "Sending…" : "Accept quotation"}</Button><Button variant="ghost" onClick={() => setDeclining(true)}>Decline</Button></div>
                  </div>
                )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
