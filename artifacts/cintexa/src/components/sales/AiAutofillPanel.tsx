import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Loader2, ExternalLink, RefreshCw, X, Check, Trash2, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Term, Hint } from "./Hint";
import type { FieldDef, Values } from "./forms";
import { researchApi, TERMINAL, type Evidence, type JobView, type ResearchStatus } from "@/lib/sales/research-api";

export type AutofillKind = "lead" | "account" | "contact" | "competitor";
/** canonical research field -> form field name, per form. Anything not listed is never written into that form. */
const MAP: Record<AutofillKind, Record<string, string>> = {
  lead: { company_name: "company", email: "email", phone: "phone", industry: "industry", country: "country", products_services: "product_interest", description: "notes" },
  account: { company_name: "name", website: "website", email: "email", phone: "phone", industry: "industry", address: "address_line", city: "city", region: "region", country: "country", postal_code: "postal_code", tags: "tags", description: "notes" },
  contact: {},
  competitor: { company_name: "name", website: "website", description: "positioning", products_services: "value_proposition" },
};
const NAME_FIELD: Record<AutofillKind, string> = { lead: "company", account: "name", contact: "", competitor: "name" };
const LABEL: Record<string, string> = { company_name: "Company name", website: "Website", email: "Email", phone: "Phone", industry: "Industry", country: "Country", products_services: "Products & services", description: "Description", address: "Address", city: "City", region: "Region", postal_code: "Postal code", tags: "Tags", leadership: "Leadership" };

type RowStatus = "new" | "update" | "same" | "conflicting";
interface Row { canonical: string; target: FieldDef; options: Evidence[]; ev: Evidence; value: string; existing: string; status: RowStatus; invalid: string | null }

const conf = (e: Evidence) => Number(e.confidence);
const band = (c: number) => (c >= 0.8 ? "High" : c >= 0.55 ? "Medium" : "Low");
const bandCls = (c: number) => (c >= 0.8 ? "text-emerald-500" : c >= 0.55 ? "text-amber-500" : "text-rose-500");
const squash = (s: string) => s.toLowerCase().replace(/[\s+().\-]/g, "");

function coerce(def: FieldDef, raw: string, existing: string, canonical: string): { value: string; invalid: string | null } {
  let v = raw.trim();
  if (canonical === "tags" && existing.trim()) v = [...new Set([...existing.split(",").map((x) => x.trim()).filter(Boolean), ...v.split(",").map((x) => x.trim()).filter(Boolean)])].join(", ");
  if (def.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { value: v, invalid: "Not a valid email address" };
  if (def.type === "tel" && v.replace(/\D/g, "").length < 7) return { value: v, invalid: "Not a valid phone number" };
  if (def.type === "url" && !/^https?:\/\/\S+$/.test(v)) return { value: v, invalid: "Not a valid web address" };
  if (def.type === "select") { const o = def.options?.find((x) => x.value.toLowerCase() === v.toLowerCase() || x.label.toLowerCase() === v.toLowerCase()); return o ? { value: o.value, invalid: null } : { value: v, invalid: "Not one of the allowed choices" }; }
  const max = def.type === "textarea" ? 2000 : 300;
  if (v.length > max) v = v.slice(0, max - 1).trimEnd() + "…";
  return { value: v, invalid: null };
}

export function AiAutofillPanel({ kind, fields, values, setValue, entityId }: { kind: AutofillKind; fields: FieldDef[]; values: Values; setValue: (name: string, v: string) => void; entityId?: number }) {
  const [status, setStatus] = useState<ResearchStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [website, setWebsite] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [view, setView] = useState<JobView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [alt, setAlt] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"fields" | "seo" | "sources">("fields");
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const hasWebsiteField = fields.some((f) => f.name === "website");

  useEffect(() => { if (open && !status && !statusErr) researchApi.status().then(setStatus).catch((e) => setStatusErr(e?.message ?? "Research is not available")); }, [open, status, statusErr]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const poll = useCallback((id: number) => {
    const tick = async () => {
      try {
        const v = await researchApi.get(id); setView(v);
        if (!TERMINAL.includes(v.job.status)) timer.current = window.setTimeout(tick, 1500);
        else setBusy(false);
      } catch (e: any) { setErr(e?.message ?? "Lost contact with the server"); setBusy(false); }
    };
    void tick();
  }, []);

  const nameValue = NAME_FIELD[kind] ? String(values[NAME_FIELD[kind]] ?? "").trim() : "";
  const siteValue = hasWebsiteField ? String(values.website ?? "").trim() : website.trim();

  async function run(refresh = false) {
    setErr(null); setNote(null); setPicked({}); setAlt({}); setView(null); setBusy(true);
    try {
      const r = await researchApi.start({ company_name: nameValue || undefined, website: siteValue || undefined, country: String(values.country ?? "") || undefined, refresh, entity_type: entityId ? kind === "competitor" ? undefined : kind : undefined, entity_id: entityId });
      setJobId(r.jobId); if (r.cached) setNote("Showing a recent research result for this company (use Refresh research for newer information).");
      poll(r.jobId);
    } catch (e: any) { setErr(e?.message ?? "Research could not start"); setBusy(false); }
  }

  const rows: Row[] = useMemo(() => {
    if (!view || view.job.status === "failed" || view.job.status === "cancelled") return [];
    const out: Row[] = [];
    const byField = new Map<string, Evidence[]>();
    for (const e of view.evidence) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);
    for (const [canonical, target] of Object.entries(MAP[kind])) {
      const def = fields.find((f) => f.name === target && !f.disabled && (!f.when || f.when(values)));
      const opts = byField.get(canonical === "company_name" ? "company_name" : canonical);
      if (!def || !opts?.length) continue;
      const ev = opts[(alt[canonical] ?? 0) % opts.length]!;
      const existing = String(values[def.name] ?? "");
      const { value, invalid } = coerce(def, ev.value, existing, canonical);
      const same = existing.trim() !== "" && squash(existing) === squash(value);
      out.push({ canonical, target: def, options: opts, ev, value, existing, invalid, status: same ? "same" : ev.verification === "conflicting" && existing.trim() ? "conflicting" : existing.trim() ? "update" : "new" });
    }
    return out;
  }, [view, kind, fields, values, alt]);

  const people = useMemo(() => (kind === "contact" && view ? view.evidence.filter((e) => e.field === "leadership") : []), [kind, view]);
  const defaultPick = (r: Row) => r.status === "new" && !r.invalid && conf(r.ev) >= 0.55 && r.ev.kind !== "hypothesis";
  useEffect(() => { if (view?.job.status === "awaiting_review" || view?.job.status === "completed") setPicked((p) => (Object.keys(p).length ? p : Object.fromEntries(rows.map((r) => [r.canonical, defaultPick(r)])))); /* eslint-disable-next-line */ }, [view?.job.status, rows.length]);

  const record = (d: { field: string; action: "applied" | "rejected" | "cleared"; previous?: string }[]) => { if (jobId && d.length) void researchApi.decide(jobId, d).catch(() => undefined); };
  function apply(list: Row[]) {
    const ok = list.filter((r) => !r.invalid);
    ok.forEach((r) => setValue(r.target.name, r.value));
    record(ok.map((r) => ({ field: r.canonical, action: "applied" as const, previous: r.existing || undefined })));
    setNote(`${ok.length} value${ok.length === 1 ? "" : "s"} copied into the form. Review them, then press Save - nothing is stored until you do.`);
    setPicked({});
  }
  function usePerson(e: Evidence) {
    const [nm, ...t] = e.value.split(" - "); const parts = nm!.trim().split(/\s+/);
    if (fields.some((f) => f.name === "first_name")) setValue("first_name", parts[0] ?? "");
    if (fields.some((f) => f.name === "last_name")) setValue("last_name", parts.slice(1).join(" "));
    if (t.length && fields.some((f) => f.name === "job_title")) setValue("job_title", t.join(" - "));
    record([{ field: "leadership", action: "applied" }]); setNote("Name and title copied into the form. Check them before saving.");
  }
  const picks = rows.filter((r) => picked[r.canonical] && !r.invalid);
  const eligible = rows.filter((r) => r.status === "new" && !r.invalid && r.ev.kind !== "hypothesis");
  const running = busy && view && !TERMINAL.includes(view.job.status);
  const noInput = kind === "contact" ? !siteValue && !nameValue : !nameValue && !siteValue;
  const contactHelp = kind === "contact";

  return (
    <div className="mb-4 rounded-lg border bg-secondary/30">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /><Term icon term="AI Autofill">AI Autofill</Term>
        <span className="text-xs font-normal text-muted-foreground">Research the company on the public web and propose values - you decide what to keep</span>
        <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-sm">
          {statusErr && <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-600">Web research is not reachable: {statusErr} It needs the API server (see docs/sales-management/AI_RESEARCH.md).</p>}
          {status && !status.enabled && <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">An administrator has switched web research off.</p>}
          {status?.setup && <p className="text-xs text-muted-foreground">{status.setup}</p>}
          {!hasWebsiteField && (
            <label className="block text-xs"><span className="mb-1 block font-medium text-muted-foreground">Company website (optional) <Hint term="Website" /></span>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
          )}
          <p className="text-xs text-muted-foreground">{contactHelp ? "Reads the company's public website to list publicly named leaders. Personal emails and phone numbers are never guessed." : "Uses the company name and website above. Only public pages are read; existing values are never overwritten unless you choose to."} <Hint term="Public pages only" /></p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void run(false)} disabled={busy || noInput || (status ? !status.enabled : false)}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}<Term term="Research Company">Research company</Term></Button>
            {view && TERMINAL.includes(view.job.status) && <Button type="button" size="sm" variant="outline" onClick={() => void run(true)} disabled={busy}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /><Term term="Refresh research">Refresh research</Term></Button>}
            {running && jobId && <Button type="button" size="sm" variant="outline" onClick={() => void researchApi.cancel(jobId).then(() => poll(jobId))}><X className="mr-1.5 h-3.5 w-3.5" />Cancel</Button>}
            {noInput && <span className="self-center text-xs text-muted-foreground">Enter {NAME_FIELD[kind] ? "the company name or " : ""}a website first.</span>}
          </div>
          {err && <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-500">{err}</p>}
          {note && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-600">{note}</p>}
          {view && (
            <div aria-live="polite">
              {running && <div><div className="h-1.5 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${view.job.progress}%` }} /></div><p className="mt-1 text-xs text-muted-foreground"><Term term={view.job.status}>{view.job.status.replace(/_/g, " ")}</Term> - {view.job.stageDetail ?? "working"}</p></div>}
              {view.job.status === "failed" && <p role="alert" className="flex gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-500"><AlertTriangle className="h-4 w-4 shrink-0" />{view.job.error}</p>}
              {view.job.status === "cancelled" && <p className="text-xs text-muted-foreground">Research cancelled. Nothing was changed.</p>}
              {view.result && !running && view.job.status !== "failed" && view.job.status !== "cancelled" && (
                <>
                  <div role="tablist" className="mb-2 flex gap-1 border-b text-xs">
                    {([["fields", "Suggested values"], ["seo", "SEO & AEO"], ["sources", "Sources"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("border-b-2 px-2 py-1.5", tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground")}>{l}</button>)}
                  </div>
                  {view.job.ageMinutes !== null && view.job.ageMinutes > 5 && <p className="mb-2 text-xs text-muted-foreground">This research is {view.job.ageMinutes < 90 ? `${view.job.ageMinutes} minutes` : `${Math.round(view.job.ageMinutes / 60)} hours`} old.</p>}
                  {tab === "fields" && (
                    <>
                      {contactHelp ? (
                        people.length ? <ul className="space-y-1">{people.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 rounded border bg-background p-2"><span><strong>{p.value}</strong><span className="block text-[11px] text-muted-foreground">{p.excerpt} · {p.source_domain}</span></span><Button type="button" size="sm" variant="outline" onClick={() => usePerson(p)}>Use this person</Button></li>)}</ul> : <p className="text-xs text-muted-foreground">The website does not publicly name its leaders, so nothing was proposed. Nothing is guessed.</p>
                      ) : rows.length === 0 ? <p className="text-xs text-muted-foreground">Nothing in this form could be filled with reliable evidence.</p> : (
                        <div className="overflow-x-auto"><table className="w-full text-xs">
                          <thead><tr className="border-b text-left text-muted-foreground"><th className="w-6" /><th className="py-1 pr-2">Field</th><th className="pr-2">Proposed</th><th className="pr-2">Status</th><th className="pr-2"><Term term="Confidence">Confidence</Term></th><th><Term term="Evidence">Source</Term></th></tr></thead>
                          <tbody>{rows.map((r) => (
                            <tr key={r.canonical} className="border-b align-top last:border-0">
                              <td className="py-1.5"><input type="checkbox" aria-label={`Use ${LABEL[r.canonical]}`} disabled={!!r.invalid || r.status === "same"} checked={!!picked[r.canonical] && !r.invalid} onChange={(e) => setPicked((p) => ({ ...p, [r.canonical]: e.target.checked }))} /></td>
                              <td className="py-1.5 pr-2 font-medium">{r.target.label}</td>
                              <td className="max-w-[16rem] break-words py-1.5 pr-2"><span>{r.value}</span>{r.existing && r.status !== "same" && <span className="block text-[11px] text-muted-foreground">Now: {r.existing}</span>}{r.invalid && <span className="block text-[11px] text-rose-500">{r.invalid} - not applied</span>}{r.options.length > 1 && <button type="button" className="mt-0.5 text-[11px] text-primary hover:underline" onClick={() => setAlt((a) => ({ ...a, [r.canonical]: (a[r.canonical] ?? 0) + 1 }))}>Show alternative ({r.options.length})</button>}</td>
                              <td className="py-1.5 pr-2 whitespace-nowrap"><Term term={r.status === "update" ? "Update" : r.status}>{r.status === "update" ? "Differs" : r.status === "conflicting" ? "Conflict" : r.status === "same" ? "Same" : "New"}</Term></td>
                              <td className="py-1.5 pr-2 whitespace-nowrap"><span className={bandCls(conf(r.ev))}>{band(conf(r.ev))} {Math.round(conf(r.ev) * 100)}%</span><span className="block text-[11px] text-muted-foreground"><Term term={r.ev.verification}>{r.ev.verification.replace("_", " ")}</Term> · <Term term={r.ev.kind}>{r.ev.kind}</Term></span></td>
                              <td className="py-1.5">{r.ev.source_url ? <a href={r.ev.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-primary hover:underline">{r.ev.source_domain ?? "source"}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a> : "-"}<span className="block max-w-[12rem] text-[11px] text-muted-foreground">{r.ev.excerpt}</span></td>
                            </tr>))}</tbody>
                        </table></div>
                      )}
                      {!contactHelp && rows.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button type="button" size="sm" onClick={() => apply(picks)} disabled={picks.length === 0}><Check className="mr-1.5 h-3.5 w-3.5" /><Term term="Apply selected">Apply selected</Term> ({picks.length})</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => apply(eligible)} disabled={eligible.length === 0}><Term term="Accept all">Accept all new</Term> ({eligible.length})</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { record(rows.map((r) => ({ field: r.canonical, action: "cleared" as const }))); setView(null); setJobId(null); setPicked({}); setNote("AI drafts cleared."); }}><Trash2 className="mr-1.5 h-3.5 w-3.5" /><Term term="Clear AI drafts">Clear AI drafts</Term></Button>
                        </div>
                      )}
                      <details className="mt-3 text-[11px] text-muted-foreground"><summary className="cursor-pointer">How is confidence scored?</summary>Confidence starts from the source type (structured data 85%, page text 70%, search snippet 40%, derived 35%), adds up to 15% when other pages agree, adjusts for whether an address belongs to the company's own domain, and loses 2% per 30 days of age. It is a transparent score, not a probability. "Fact" was read directly; "estimate" is reasoned; "hypothesis" is only an idea to test.</details>
                    </>
                  )}
                  {tab === "seo" && (
                    <div className="space-y-3 text-xs">
                      {view.result.seoAeo?.observed.length ? <ul className="space-y-1">{view.result.seoAeo.observed.map((f) => <li key={f.id} className="rounded border bg-background p-2"><span className="mr-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] uppercase"><Term term={f.area.toUpperCase()}>{f.area}</Term></span><span className={cn("mr-1.5 text-[10px] uppercase", f.severity === "high" ? "text-rose-500" : f.severity === "medium" ? "text-amber-500" : "text-muted-foreground")}>{f.severity}</span><strong>{f.observed}</strong><span className="block text-muted-foreground">{f.why}</span></li>)}</ul> : <p className="text-muted-foreground">No problems were observed on the pages that were read.</p>}
                      {!!view.result.seoAeo?.aeoQuestions.length && <div><p className="mb-1 font-medium"><Term term="AEO topics">Suggested question topics</Term></p><ul className="list-disc space-y-0.5 pl-4">{view.result.seoAeo.aeoQuestions.map((q) => <li key={q.question}>{q.question}<span className="block text-[11px] text-muted-foreground">{q.basis}</span></li>)}</ul></div>}
                      {!!view.result.hypotheses.length && <div><p className="mb-1 font-medium"><Term term="Hypothesis">Sales hypotheses (to confirm with the customer)</Term></p><ul className="space-y-1">{view.result.hypotheses.map((h) => <li key={h.service} className="rounded border border-dashed p-2"><strong>{h.service}</strong>: {h.hypothesis}<span className="block text-[11px] text-muted-foreground">Because we observed: {h.because.join(", ").replace(/_/g, " ")}</span></li>)}</ul></div>}
                      <p className="text-[11px] text-muted-foreground">{view.result.seoAeo?.note}</p>
                    </div>
                  )}
                  {tab === "sources" && (
                    <div className="space-y-2 text-xs">
                      {view.result.websiteDiscovery && <p>Website found through {view.result.websiteDiscovery.provider} search: {view.result.websiteDiscovery.url}. Confirm it is the right company.</p>}
                      <ul className="space-y-0.5">{view.result.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{s.title || s.url}</a><span className="text-muted-foreground"> · read {new Date(s.fetchedAt).toLocaleString()}</span></li>)}</ul>
                      {!!view.result.skipped.length && <details><summary className="cursor-pointer text-muted-foreground">{view.result.skipped.length} page(s) not read</summary><ul className="mt-1 list-disc pl-4 text-muted-foreground">{view.result.skipped.map((s) => <li key={s.url}>{s.url} - {s.reason}</li>)}</ul></details>}
                      {view.result.warnings.map((w) => <p key={w} className="flex gap-1.5 text-amber-600"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</p>)}
                      <p className="text-[11px] text-muted-foreground">{view.result.method}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
