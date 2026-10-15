import { useEffect, useState } from "react";
import { Trash2, Play } from "lucide-react";
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "@workspace/wi-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { useCatalog, useIntegrations, useMeta, useMonitorMutations, useMonitors, useSaveSettings, useWiSettings } from "@/lib/website-intelligence/api";
import { ErrorNote, Loading, Panel, fmtDate, label } from "./components";

export default function SettingsPage() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  return (
    <div className="space-y-5">
      <MonitorsPanel />
      <IntegrationsPanel />
      {admin ? <AdminPanel /> : <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">Scoring weights, limits and host policy are managed by administrators.</p>}
      <CatalogPanel />
    </div>
  );
}

function MonitorsPanel() {
  const monitors = useMonitors();
  const mut = useMonitorMutations();
  const [url, setUrl] = useState("");
  const [freq, setFreq] = useState("weekly");
  const [emails, setEmails] = useState("");
  const [drop, setDrop] = useState(5);
  const [ok, setOk] = useState(false);
  return (
    <Panel title="Continuous monitoring" description="Re-audits a site on a schedule and alerts on score drops and new critical findings (webhook and optional email). Runs on the API host; it needs an always-on server.">
      <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); mut.create.mutate({ url: /^https?:/i.test(url) ? url : `https://${url}`, profile: "standard", frequency: freq, notifyEmails: emails.split(/[,\s]+/).filter(Boolean), scoreDropThreshold: drop, authorization: { confirmed: ok } }, { onSuccess: () => { setUrl(""); setOk(false); } }); }}>
        <Input className="md:col-span-2" placeholder="https://www.example.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Monitor URL" />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={freq} onChange={(e) => setFreq(e.target.value)} aria-label="Frequency"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
        <Input placeholder="Alert emails (comma separated)" value={emails} onChange={(e) => setEmails(e.target.value)} aria-label="Alert emails" />
        <label className="flex items-center gap-2 text-xs">Alert at drop of<Input type="number" min={1} max={50} className="h-9 w-16" value={drop} onChange={(e) => setDrop(Number(e.target.value))} />pts</label>
        <label className="flex items-start gap-2 text-xs md:col-span-4"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />I own this website or am authorised by its owner to audit it on a schedule.</label>
        <Button type="submit" size="sm" disabled={!url.trim() || !ok || mut.create.isPending}>Add monitor</Button>
      </form>
      {mut.create.error && <div className="mt-2"><ErrorNote error={mut.create.error} /></div>}
      <div className="mt-4">
        {monitors.isLoading ? <Loading /> : !monitors.data?.length ? <p className="text-sm text-muted-foreground">No monitors yet.</p> : (
          <ul className="divide-y">{monitors.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><div className="font-medium">{m.hostname}</div><div className="text-xs text-muted-foreground">{label(m.frequency)} - next {fmtDate(m.nextRunAt)} - last {fmtDate(m.lastRunAt)} - alert at -{m.notify.scoreDropThreshold} pts</div></div>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={m.enabled} onChange={(e) => mut.patch.mutate({ id: m.id, patch: { enabled: e.target.checked } })} />Enabled</label>
              <Button size="sm" variant="outline" onClick={() => mut.run.mutate(m.id)} disabled={mut.run.isPending}><Play className="mr-1 h-3.5 w-3.5" />Run now</Button>
              <Button size="sm" variant="ghost" aria-label={`Delete monitor ${m.hostname}`} onClick={() => mut.remove.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}</ul>
        )}
        {(mut.run.error || mut.patch.error || mut.remove.error) && <ErrorNote error={mut.run.error ?? mut.patch.error ?? mut.remove.error} />}
      </div>
    </Panel>
  );
}

function IntegrationsPanel() {
  const q = useIntegrations();
  return (
    <Panel title="Integrations" description="Each adapter reports its real state. Nothing is simulated.">
      {q.isLoading ? <Loading /> : (
        <ul className="grid gap-2 md:grid-cols-2">{(q.data ?? []).map((i) => (
          <li key={i.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{i.name}</span><span className={i.status === "available" ? "text-xs text-emerald-400" : "text-xs text-amber-400"}>{i.status === "available" ? "Available" : i.status === "unreachable" ? "Unreachable" : "Not configured"}</span></div><p className="mt-1 text-xs text-muted-foreground">{i.detail}</p></li>
        ))}</ul>
      )}
    </Panel>
  );
}

function AdminPanel() {
  const meta = useMeta();
  const settings = useWiSettings(true);
  const save = useSaveSettings();
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [allowed, setAllowed] = useState("");
  const [blocked, setBlocked] = useState("");
  const [flags, setFlags] = useState({ aiExplanations: true, allowAuthenticatedScope: false, allowPublicShare: true });
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setWeights(s.weights); setLimits(s.limits); setAllowed(s.allowedHosts.join("\n")); setBlocked(s.blockedHosts.join("\n"));
    setFlags({ aiExplanations: s.aiExplanations, allowAuthenticatedScope: s.allowAuthenticatedScope, allowPublicShare: s.allowPublicShare });
  }, [settings.data]);
  if (settings.isLoading) return <Loading />;
  if (settings.error) return <ErrorNote error={settings.error} />;
  const total = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const list = (s: string) => s.split(/[\n,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const LIMIT_LABELS: Record<string, string> = { maxPages: "Max pages", maxDepth: "Max depth", maxConcurrency: "Max concurrency", maxDurationMs: "Max duration (ms)", requestTimeoutMs: "Request timeout (ms)", maxResponseBytes: "Max response bytes", maxExternalLinks: "Max external link checks", maxAssetProbes: "Max asset probes", perHostDelayMs: "Delay per host (ms)", maxActiveAuditsPerUser: "Active audits per user", maxAuditsPerUserPerHour: "Audits per user per hour", maxGlobalConcurrentAudits: "Concurrent audits (global)", retentionDays: "Retention (days)", maxScreenshots: "Max screenshots" };
  return (
    <Panel title="Administration" description={`Scoring version ${meta.data?.scoringVersion ?? ""}. Changing weights affects new audits only; stored audits keep the version they were scored with.`}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate({ weights: weights as Record<CategoryId, number>, limits, allowedHosts: list(allowed), blockedHosts: list(blocked), ...flags }); }}>
        <fieldset><legend className="text-sm font-medium">Category weights <span className={total === 100 ? "text-emerald-400" : "text-red-400"}>(total {total}, must be 100)</span></legend>
          <div className="mt-2 grid gap-2 md:grid-cols-3">{CATEGORY_IDS.map((c) => <label key={c} className="flex items-center justify-between gap-2 text-sm">{CATEGORY_LABELS[c]}<Input type="number" min={0} max={100} className="h-8 w-20" value={weights[c] ?? 0} onChange={(e) => setWeights({ ...weights, [c]: Number(e.target.value) })} /></label>)}</div>
        </fieldset>
        <fieldset><legend className="text-sm font-medium">Limits</legend>
          <div className="mt-2 grid gap-2 md:grid-cols-3">{Object.entries(limits).map(([k, v]) => <label key={k} className="flex items-center justify-between gap-2 text-sm">{LIMIT_LABELS[k] ?? k}<Input type="number" className="h-8 w-28" value={v} onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) })} /></label>)}</div>
        </fieldset>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">Allowed hosts (empty = any public host)<textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} value={allowed} onChange={(e) => setAllowed(e.target.value)} /></label>
          <label className="space-y-1 text-sm">Blocked hosts<textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} value={blocked} onChange={(e) => setBlocked(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          {([["aiExplanations", "AI-assisted explanations"], ["allowAuthenticatedScope", "Allow authenticated scope"], ["allowPublicShare", "Allow read-only client links"]] as const).map(([k, t]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} />{t}</label>)}
        </div>
        {save.error && <ErrorNote error={save.error} />}
        {save.isSuccess && <p className="text-sm text-emerald-400" role="status">Settings saved.</p>}
        <Button type="submit" disabled={total !== 100 || save.isPending}>{save.isPending ? "Saving" : "Save settings"}</Button>
      </form>
    </Panel>
  );
}

function CatalogPanel() {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const catalog = useCatalog(cat || undefined);
  const tests = (catalog.data?.tests ?? []).filter((t) => !q || `${t.id} ${t.title} ${t.measures}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title="Test catalogue" description="Every test states what it measures, how, and what counts as a pass or a failure.">
      <div className="mb-3 flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="Search tests" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" /><select className="h-9 rounded-md border bg-background px-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></div>
      {catalog.isLoading ? <Loading /> : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground"><tr><th className="p-2">Test</th><th className="p-2">Severity</th><th className="p-2">Scope</th><th className="p-2">Needs</th></tr></thead>
          <tbody className="divide-y">{tests.map((t) => <tr key={t.id}><td className="p-2"><div className="font-medium">{t.title}</div><div className="text-xs text-muted-foreground">{t.id} - {t.measures}</div></td><td className="p-2 capitalize">{t.severity}{t.gate ? " (gate)" : ""}</td><td className="p-2">{t.scope}</td><td className="p-2 text-xs">{t.requires ? label(t.requires) : "-"}</td></tr>)}</tbody></table></div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{tests.length} of {catalog.data?.total ?? 0} tests shown.</p>
    </Panel>
  );
}
