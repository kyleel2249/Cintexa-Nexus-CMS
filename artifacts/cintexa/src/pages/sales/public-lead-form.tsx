import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { publicCall, SalesApiError } from "@/lib/sales/api";
import { Input, Textarea, Field, Checkbox, Spinner } from "@/components/sales/ui";

/** Public lead-capture form (no sign-in). Includes a honeypot field and records consent only when the visitor ticks it. */
export default function PublicLeadForm({ token }: { token: string }) {
  const [meta, setMeta] = useState<{ name: string; requireConsent: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ first_name: "", last_name: "", email: "", phone: "", company: "", message: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    publicCall<{ name: string; requireConsent: boolean }>("GET", `/lead-forms/${encodeURIComponent(token)}`).then((r) => { if (!off) setMeta(r); }).catch((e: SalesApiError) => { if (!off) setError(e.status === 404 ? "This form is not available." : e.message); });
    return () => { off = true; };
  }, [token]);

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setFormError(null); setIssues({});
    const params = new URLSearchParams(window.location.search);
    const body: Record<string, unknown> = { consent };
    for (const [k, val] of Object.entries(v)) if (val.trim()) body[k] = val.trim();
    for (const k of ["utm_source", "utm_medium", "utm_campaign"]) { const x = params.get(k); if (x) body[k] = x.slice(0, 100); }
    try {
      await publicCall("POST", `/lead-forms/${encodeURIComponent(token)}/submit`, body);
      setDone(true);
    } catch (err) {
      const e2 = err as SalesApiError;
      if (e2.issues?.length) setIssues(Object.fromEntries(e2.issues.map((i) => [i.path, i.message])));
      setFormError(e2.issues?.length ? "Please check the highlighted fields." : e2.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-lg">
        {error ? <div role="alert" className="rounded-lg border bg-card p-8 text-center"><h1 className="text-xl font-semibold">Form unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p></div>
          : !meta ? <div className="flex justify-center py-20"><Spinner className="h-6 w-6" /></div>
          : done ? <div role="status" className="rounded-lg border bg-card p-8 text-center"><h1 className="text-xl font-semibold">Thank you</h1><p className="mt-2 text-sm text-muted-foreground">We have received your details and will be in touch.</p></div> : (
          <form onSubmit={submit} className="rounded-lg border bg-card p-6 shadow-sm" noValidate>
            <h1 className="mb-4 text-xl font-semibold">{meta.name}</h1>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="First name" required error={issues.first_name}><Input value={v.first_name} onChange={set("first_name")} maxLength={80} autoComplete="given-name" required /></Field>
              <Field label="Last name" error={issues.last_name}><Input value={v.last_name} onChange={set("last_name")} maxLength={80} autoComplete="family-name" /></Field>
              <Field label="Email" error={issues.email}><Input type="email" value={v.email} onChange={set("email")} autoComplete="email" /></Field>
              <Field label="Phone" error={issues.phone}><Input type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" /></Field>
              <Field label="Company" className="sm:col-span-2" error={issues.company}><Input value={v.company} onChange={set("company")} maxLength={160} autoComplete="organization" /></Field>
              <Field label="How can we help?" className="sm:col-span-2" error={issues.message}><Textarea rows={4} value={v.message} onChange={set("message")} maxLength={2000} /></Field>
            </div>
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} /></label></div>
            <Checkbox label={`I agree to be contacted about my enquiry${meta.requireConsent ? "" : " (optional)"}`} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            {issues.consent && <p role="alert" className="text-[11px] text-rose-500">{issues.consent}</p>}
            <p className="mb-3 text-xs text-muted-foreground">Please give an email address or a phone number.</p>
            {formError && <p role="alert" className="mb-3 text-sm text-rose-500">{formError}</p>}
            <Button type="submit" disabled={busy || !v.first_name.trim()}>{busy ? "Sending…" : "Send"}</Button>
          </form>
        )}
      </div>
    </main>
  );
}
