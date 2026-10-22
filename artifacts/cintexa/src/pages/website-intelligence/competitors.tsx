import { useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCompetitorMutations, useCompetitors, type WiCompetitor } from "@/lib/website-intelligence/api";
import { AuditStatusBadge, EmptyState, ErrorNote, Loading, Panel, fmtDate } from "./components";

const STATUS_TEXT: Record<WiCompetitor["status"], string> = { pending: "Pending review", approved: "Approved", rejected: "Rejected", unverifiable: "Could not be verified" };
const pctText = (v: number | null) => (v === null ? "not measured" : `${Math.round(v * 100)}%`);

function Evidence({ c }: { c: WiCompetitor }) {
  const b = c.breakdown;
  return (
    <div className="space-y-2 border-t bg-muted/20 p-3 text-xs">
      <p><span className="font-medium">Why this classification: </span>{c.classificationReason}</p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex justify-between"><dt className="text-muted-foreground">Search overlap</dt><dd>{pctText(b.searchOverlap)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Content similarity</dt><dd>{pctText(b.contentSimilarity)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Geographic overlap</dt><dd>{pctText(b.geographicOverlap)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Evidence quality</dt><dd>{pctText(b.evidenceQuality)}</dd></div>
      </dl>
      {b.capReason && <p className="text-amber-700 dark:text-amber-400">Confidence capped at {Math.round((b.cap ?? 0) * 100)}%: {b.capReason}</p>}
      {b.notes.map((n) => <p key={n} className="text-muted-foreground">{n}</p>)}
      <ul className="space-y-1">
        {c.evidence.slice(0, 8).map((e, i) => (
          <li key={`${e.kind}-${i}`} className="flex gap-2"><span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{e.kind.replace(/_/g, " ")}</span><span className="break-words">{e.detail}</span></li>
        ))}
      </ul>
      <p className="text-muted-foreground">First discovered {fmtDate(c.firstDiscoveredAt)}. {c.lastVerifiedAt ? `Last verified ${fmtDate(c.lastVerifiedAt)}.` : "Not verified against the live site yet."}</p>
    </div>
  );
}

export default function CompetitorsView({ id }: { id: string }) {
  const q = useCompetitors(id);
  const m = useCompetitorMutations(id);
  const [url, setUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const data = q.data;
  const busy = m.discover.isPending || Boolean(data?.discoveryRunning);
  const latest = data?.runs[0];
  const approvedOrSelected = (data?.competitors ?? []).filter((c) => c.status === "approved" || (c.selected && c.status === "pending"));

  if (q.isLoading) return <Loading text="Loading competitors" />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Panel
        title="Competitor discovery"
        description="Competitors are inferred from what this audit found on your site and searched for with an approved search API. Every candidate keeps its evidence, and nothing you approve or reject is changed by a rerun."
        actions={<Button size="sm" variant="outline" disabled={busy} onClick={() => m.discover.mutate()}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{busy ? "Discovering" : "Run discovery"}</Button>}
      >
        {data.searchProvider?.status !== "available" && (
          <p role="status" className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span className="font-medium">Search-based discovery is not available. </span>{data.searchProvider?.detail ?? "A search provider is not configured on this host."}
            {data.searchProvider?.envVars.length ? <span className="text-muted-foreground"> Environment variables: {data.searchProvider.envVars.join(", ")}.</span> : null}
          </p>
        )}
        {m.discover.error && <ErrorNote error={m.discover.error} />}
        {latest && (
          <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
            <p>Last run {fmtDate(latest.startedAt)}: <span className="font-medium text-foreground">{latest.status}</span>{latest.provider ? ` via ${latest.provider}` : ""}{latest.summary?.candidatesFound !== undefined ? `, ${latest.summary.candidatesFound} candidate(s)` : ""}.</p>
            {latest.queries.length > 0 && <p>Searches used: {latest.queries.map((x) => `"${x}"`).join(", ")}</p>}
            {(latest.summary?.unavailable ?? []).map((u) => <p key={u} className="text-amber-700 dark:text-amber-400">{u}</p>)}
            {(latest.summary?.alternatives ?? []).map((u) => <p key={u}>Alternative: {u}</p>)}
            {(latest.summary?.droppedExclusions ?? []).length > 0 && <p>Excluded as not competitors: {latest.summary?.droppedExclusions?.map((d) => d.domain).join(", ")}.</p>}
          </div>
        )}
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); m.add.mutate({ url: /^https?:/i.test(url) ? url : `https://${url}` }, { onSuccess: () => setUrl("") }); }}>
          <Input className="max-w-sm" placeholder="Add a competitor, e.g. competitor.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Competitor website" />
          <Button type="submit" size="sm" disabled={!url.trim() || m.add.isPending}><Plus className="mr-1.5 h-3.5 w-3.5" />Add</Button>
        </form>
        {m.add.error && <ErrorNote error={m.add.error} />}
      </Panel>

      {data.competitors.length === 0 ? (
        <EmptyState title="No competitors yet" body={busy ? "Discovery is running. This page refreshes automatically." : "Run discovery once a search provider is configured, or add a competitor you already know about."} />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <ul className="divide-y">
            {data.competitors.map((c) => (
              <li key={c.domain} className={cn(c.status === "rejected" && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open === c.domain} onClick={() => setOpen(open === c.domain ? null : c.domain)}>
                    <span className="block truncate font-medium">{c.name ?? c.domain}{c.selected && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">In comparison</span>}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.domain} · {c.classificationLabel} · {STATUS_TEXT[c.status]}{c.userConfirmed ? " · confirmed by you" : ""}</span>
                  </button>
                  <span className="text-sm tabular-nums" title="Confidence combines search overlap, content similarity, geography and evidence quality">{Math.round(c.confidence * 100)}% confidence</span>
                  {c.benchmark && <AuditStatusBadge s={c.benchmark.status} />}
                  <select aria-label={`Classification for ${c.domain}`} className="rounded-md border bg-background px-2 py-1 text-xs" value={c.classification} onChange={(e) => m.update.mutate({ domain: c.domain, patch: { classification: e.target.value as WiCompetitor["classification"] } })}>
                    {data.classes.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                  <Button size="sm" variant={c.status === "approved" ? "default" : "outline"} aria-label={`Approve ${c.domain}`} onClick={() => m.update.mutate({ domain: c.domain, patch: { status: "approved" } })}><Check className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant={c.status === "rejected" ? "default" : "outline"} aria-label={`Reject ${c.domain}`} onClick={() => m.update.mutate({ domain: c.domain, patch: { status: "rejected" } })}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${c.domain}`} onClick={() => m.remove.mutate(c.domain)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                {open === c.domain && <Evidence c={c} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(m.update.error || m.remove.error) && <ErrorNote error={m.update.error ?? m.remove.error} />}

      {approvedOrSelected.length > 0 && (
        <Panel title="Measure the comparison set" description={`Runs a small passive audit of up to ${data.defaults.maxCompare} approved competitors (or the best-supported ones when none are approved) so they can be compared on the Benchmarks tab.`}>
          <label className="mb-2 flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I understand this requests only publicly reachable pages of each competitor, respects robots.txt, and samples a small number of pages.</label>
          <Button size="sm" disabled={!consent || m.benchmark.isPending} onClick={() => m.benchmark.mutate()}>{m.benchmark.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Benchmark {approvedOrSelected.length} competitor{approvedOrSelected.length === 1 ? "" : "s"}</Button>
          {m.benchmark.error && <ErrorNote error={m.benchmark.error} />}
          {m.benchmark.data && <p className="mt-2 text-xs text-muted-foreground">Started: {m.benchmark.data.started.join(", ") || "none"}.{m.benchmark.data.skipped.length ? ` Skipped: ${m.benchmark.data.skipped.map((s) => `${s.domain} (${s.reason})`).join("; ")}` : ""}</p>}
        </Panel>
      )}
    </div>
  );
}
