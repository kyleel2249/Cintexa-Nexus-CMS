import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateAudit, useMeta } from "@/lib/website-intelligence/api";
import { ApiError } from "@/lib/api";
import { ErrorNote, Loading, Panel, WI, label } from "./components";

const MODULE_LABELS: Record<string, string> = {
  seo: "Technical SEO and crawlability", performance: "Performance and Core Web Vitals", accessibility: "Accessibility (WCAG 2.2 AA, automated subset)", security: "Security and privacy configuration",
  content: "Content quality and trust", functionality: "Functionality, links and journeys", structuredData: "Structured data", localSeo: "Local SEO", ecommerce: "E-commerce checks", business: "Business and conversion", analytics: "Analytics and maintenance",
};

function Field({ id, title, hint, children, error }: { id: string; title: string; hint?: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{title}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
    </div>
  );
}

const select = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export default function NewAudit() {
  const meta = useMeta();
  const create = useCreateAudit();
  const [, nav] = useLocation();
  const m = meta.data;

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [websiteType, setWebsiteType] = useState("corporate");
  const [objective, setObjective] = useState("");
  const [market, setMarket] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState("");
  const [important, setImportant] = useState("");
  const [profile, setProfile] = useState("standard");
  const [maxPages, setMaxPages] = useState(25);
  const [maxDepth, setMaxDepth] = useState(2);
  const [devices, setDevices] = useState<string[]>(["mobile"]);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [externalLinks, setExternalLinks] = useState(false);
  const [permitted, setPermitted] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authConfirmed, setAuthConfirmed] = useState(false);
  const [authPaths, setAuthPaths] = useState("/account/");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [authCred, setAuthCred] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [brand, setBrand] = useState("");

  useEffect(() => { if (m) setModules(Object.fromEntries(m.modules.map((k) => [k, true]))); }, [m]);
  const choose = (id: string) => {
    setProfile(id);
    const p = m?.profiles[id];
    if (p) { setMaxPages(Math.min(p.maxPages, m?.limits.maxPages ?? p.maxPages)); setMaxDepth(Math.min(p.maxDepth, m?.limits.maxDepth ?? p.maxDepth)); setDevices(p.devices); setExternalLinks(p.externalLinkCheck); }
  };

  const fieldError = create.error instanceof ApiError ? (create.error.detail as { field?: string } | undefined)?.field : undefined;
  const urlLooksOk = useMemo(() => /^(https?:\/\/)?[^\s/]+\.[^\s/]+/.test(url.trim()), [url]);
  const canSubmit = urlLooksOk && authorized && !create.isPending && Object.values(modules).some(Boolean) && devices.length > 0 && (!authEnabled || (authConfirmed && authCred.trim()));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const list = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    create.mutate({
      url: /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, name, websiteType, objective, market, audience, language, importantPages: list(important), profile, maxPages, maxDepth, devices, modules, externalLinkCheck: externalLinks,
      permittedHosts: list(permitted), workspace: workspace || undefined, report: { brandName: brand || undefined },
      authorization: { confirmed: authorized },
      authenticated: authEnabled ? { enabled: true, confirmed: authConfirmed, allowedPathPrefixes: list(authPaths), headerName: authHeader, credential: authCred } : { enabled: false },
    }, { onSuccess: (a) => { setAuthCred(""); nav(`${WI}/audits/${a.id}`); } });
  };

  if (meta.isLoading) return <Loading />;
  if (meta.error) return <ErrorNote error={meta.error} />;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Panel title="1. Website" description="Only publicly reachable http(s) addresses are accepted. Private, loopback and cloud-metadata addresses are always refused.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="url" title="Website URL" error={fieldError === "url" ? create.error?.message : undefined} hint="Example: https://www.example.com">
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.example.com" inputMode="url" autoComplete="off" required />
          </Field>
          <Field id="name" title="Website name (optional)"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field id="type" title="Website type" hint="Changes which tests apply (for example e-commerce checks).">
            <select id="type" className={select} value={websiteType} onChange={(e) => setWebsiteType(e.target.value)}>{m?.websiteTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </Field>
          <Field id="language" title="Primary language (optional)"><Input id="language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" maxLength={40} /></Field>
          <Field id="objective" title="Business objective (optional)"><Input id="objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Generate qualified enquiries" maxLength={500} /></Field>
          <Field id="market" title="Target market (optional)"><Input id="market" value={market} onChange={(e) => setMarket(e.target.value)} maxLength={200} /></Field>
          <Field id="audience" title="Target audience (optional)"><Input id="audience" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} /></Field>
          <Field id="workspace" title="Client or workspace label (optional)" hint="Groups audits for agencies."><Input id="workspace" value={workspace} onChange={(e) => setWorkspace(e.target.value)} maxLength={80} /></Field>
        </div>
        <div className="mt-4"><Field id="important" title="Important pages (optional)" hint="One per line or comma-separated. Same site only. Key pages are weighted more and always crawled first."><Textarea id="important" rows={3} value={important} onChange={(e) => setImportant(e.target.value)} placeholder={"/pricing\n/contact"} /></Field></div>
      </Panel>

      <Panel title="2. Depth of audit">
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Audit profile">
          {Object.entries(m?.profiles ?? {}).map(([id, p]) => (
            <label key={id} className={`cursor-pointer rounded-lg border p-3 text-sm ${profile === id ? "border-primary bg-primary/5" : ""}`}>
              <input type="radio" name="profile" className="sr-only" checked={profile === id} onChange={() => choose(id)} />
              <div className="font-semibold">{p.label}</div><p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field id="maxPages" title="Maximum pages" hint={`Platform limit ${m?.limits.maxPages}`}><Input id="maxPages" type="number" min={1} max={m?.limits.maxPages} value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} /></Field>
          <Field id="maxDepth" title="Crawl depth" hint={`Platform limit ${m?.limits.maxDepth}`}><Input id="maxDepth" type="number" min={0} max={m?.limits.maxDepth} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} /></Field>
          <fieldset><legend className="text-sm font-medium">Devices</legend>
            <div className="mt-2 flex gap-4 text-sm">{["mobile", "desktop"].map((d) => <label key={d} className="flex items-center gap-1.5"><input type="checkbox" checked={devices.includes(d)} onChange={(e) => setDevices(e.target.checked ? [...devices, d] : devices.filter((x) => x !== d))} />{label(d)}</label>)}</div>
          </fieldset>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={externalLinks} onChange={(e) => setExternalLinks(e.target.checked)} /><span>Verify outbound links <span className="block text-xs text-muted-foreground">Sends a limited number of HEAD requests to third-party hosts.</span></span></label>
      </Panel>

      <Panel title="3. Modules" description="Disabled modules are reported as not tested and excluded from coverage.">
        <div className="grid gap-2 md:grid-cols-2">
          {Object.entries(modules).map(([k, on]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={(e) => setModules({ ...modules, [k]: e.target.checked })} />{MODULE_LABELS[k] ?? label(k)}</label>)}
        </div>
      </Panel>

      <Panel title="4. Authorization and scope" description="Auditing sends many requests to the site. You must be the owner or have the owner's permission.">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} required /><span>I own this website or am authorised by its owner to audit it. I understand the audit is passive and non-destructive: it respects robots.txt, never submits public forms and sends no exploit payloads.</span></label>
        {fieldError === "authorization" && <p className="mt-2 text-xs text-red-400" role="alert">{create.error?.message}</p>}
        <details className="mt-4 rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced scope</summary>
          <div className="mt-3 space-y-4">
            <Field id="permitted" title="Additional permitted hostnames" hint="Only list hosts you are also authorised to audit (for example a subdomain)."><Input id="permitted" value={permitted} onChange={(e) => setPermitted(e.target.value)} /></Field>
            <Field id="brand" title="Report brand name (optional)"><Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} /></Field>
            {m?.allowAuthenticatedScope ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={authEnabled} onChange={(e) => setAuthEnabled(e.target.checked)} />Include an authenticated area</label>
                {authEnabled && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-muted-foreground">The credential is sent only to the listed path prefixes, held in server memory for this run and never stored. Retries run unauthenticated.</p>
                    <Field id="authPaths" title="Allowed path prefixes"><Input id="authPaths" value={authPaths} onChange={(e) => setAuthPaths(e.target.value)} /></Field>
                    <Field id="authHeader" title="Header name"><Input id="authHeader" value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} /></Field>
                    <Field id="authCred" title="Credential (header value)"><Input id="authCred" type="password" autoComplete="off" value={authCred} onChange={(e) => setAuthCred(e.target.value)} /></Field>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={authConfirmed} onChange={(e) => setAuthConfirmed(e.target.checked)} />I explicitly authorise testing of these authenticated paths with this credential.</label>
                    {fieldError === "authenticated" && <p className="text-xs text-red-400" role="alert">{create.error?.message}</p>}
                  </div>
                )}
              </div>
            ) : <p className="text-xs text-muted-foreground">Authenticated scope is disabled by the platform administrator.</p>}
          </div>
        </details>
      </Panel>

      {create.error && fieldError !== "url" && fieldError !== "authorization" && fieldError !== "authenticated" && <ErrorNote error={create.error} />}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}><Play className="mr-2 h-4 w-4" />{create.isPending ? "Starting" : "Start audit"}</Button>
        <p className="text-xs text-muted-foreground">Estimated test catalogue: {m?.totalTests} tests across {m?.categories.length} categories.</p>
      </div>
    </form>
  );
}
