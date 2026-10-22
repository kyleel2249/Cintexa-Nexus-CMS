import {
  AUDIT_SCHEMA_VERSION, SCORING_VERSION, STAGE_IDS, buildRecommendations, compareAudits, computeScores, deriveFindings, getTest, normalizeUrl, parseAuditUrl, scorePage, testsForConfig,
  type AuditConfig, type AuditLimits, type CheckResult, type CoverageReport, type EnvironmentRecord, type PageFacts, type StageId, type StageState, type TestDefinition, type TestStatus,
} from "@workspace/wi-core";
import { analyzeAccessibilityPage, analyzeContentPage, analyzeSecurityFunctionalPage } from "./analyze-quality";
import { analyzePerfPage, analyzeSchemaPage, analyzeSeoPage, collectSchemaItems } from "./analyze-seo";
import { Collector, measured } from "./check";
import type { AuditContext, PageSummary } from "./context";
import { crawl, type CrawlItem, type CrawlStats } from "./crawler";
import { extractEmails, extractPhones } from "./detect";
import { shingles } from "./html";
import { extractPage, toFacts } from "./page-data";
import { ENGINE_USER_AGENT, header, type SafeFetchResult } from "./net-types";
import { getPorts, resolvePublic, store } from "./ports";
import { emptyProgress } from "./repo";
import { runInfra, type InfraOutcome } from "./site-infra";
import { runBusinessSite, runFunctionalitySite, runPerformanceSite } from "./site-misc";
import { runRobotsAndSitemap, runSeoCrosspage } from "./site-seo";
import { runSecurity } from "./site-security";
import { maybeAutoDiscover } from "./competitor-discovery";
import { reconcileAfterAudit } from "./recommendation-lifecycle";
import { finalizeRetest } from "./retest";

export const ENGINE_VERSION = "1.0.0";

/** Credentials are held in memory only for the life of the audit and are never persisted. */
const credentials = new Map<string, string>();
export function holdCredential(auditId: string, value: string): void { credentials.set(auditId, value); }

const aborters = new Map<string, AbortController>();
export function abortAudit(id: string): void { aborters.get(id)?.abort(); }
export function isRunning(id: string): boolean { return aborters.has(id); }

class StageTracker {
  private stages: StageState[];
  constructor(private readonly auditId: string, initial: StageState[]) { this.stages = initial.length ? initial : STAGE_IDS.map((id) => ({ id, status: "pending" as const })); }
  get(): StageState[] { return this.stages; }
  async set(id: StageId, status: StageState["status"], extra: Partial<StageState> = {}): Promise<void> {
    const s = this.stages.find((x) => x.id === id) as StageState;
    s.status = status;
    if (status === "running") s.startedAt = new Date().toISOString();
    if (status === "completed" || status === "failed" || status === "skipped" || status === "cancelled") s.completedAt = new Date().toISOString();
    Object.assign(s, extra);
    await store.patchAudit(this.auditId, { stage: id, stages: this.stages, heartbeat: true });
  }
}

export interface RunResult { status: "completed" | "partial" | "failed" | "cancelled" }

export async function runAudit(auditId: string): Promise<RunResult> {
  const row = await store.getAuditRow(auditId);
  if (!row) return { status: "failed" };
  const cfg = row.config as AuditConfig;
  const ports = getPorts();
  const settings = await ports.settings.load();
  const limits: AuditLimits = settings.limits;
  const controller = new AbortController();
  aborters.set(auditId, controller);
  const started = Date.now();
  const tracker = new StageTracker(auditId, row.stages ?? []);
  const log = (level: "info" | "warn" | "error", stage: string, message: string, data?: unknown) => { void store.addEvent(auditId, level, stage, message, data); };
  const progress = emptyProgress();
  const count = { requests: 0 };
  let cancelled = false;
  let failedStages = 0;

  const poll = setInterval(async () => {
    try {
      if (await store.isCancelRequested(auditId)) { cancelled = true; controller.abort(); }
      else await store.patchAudit(auditId, { heartbeat: true });
    } catch { /* keep going */ }
  }, 3000);
  let deadlineHit = false;
  const deadline = setTimeout(() => { deadlineHit = true; log("warn", "crawl", "Maximum audit duration reached; finishing with the data collected so far."); controller.abort(); }, limits.maxDurationMs);
  // abortAudit() (user cancel from this process) aborts the controller directly; the poll below covers other processes.
  controller.signal.addEventListener("abort", () => { if (!deadlineHit) cancelled = true; });

  const permitted = [...new Set((cfg.permittedHosts ?? []).map((h) => h.toLowerCase()))];
  const host = new URL(cfg.url).hostname.toLowerCase();
  const credential = credentials.get(auditId);
  const authScope = cfg.authenticated;
  const auth = authScope?.enabled && authScope.confirmed && credential && authScope.allowedPathPrefixes.length && settings.allowAuthenticatedScope
    ? { headerName: authScope.headerName || "Authorization", value: credential, pathPrefixes: authScope.allowedPathPrefixes, origin: new URL(cfg.url).origin }
    : null;

  const ctx: AuditContext = {
    auditId, cfg, limits, host, origin: new URL(cfg.url).origin, signal: controller.signal, auth, userAgent: ENGINE_USER_AGENT, log, count,
    fetchOpts: () => ({ timeoutMs: limits.requestTimeoutMs, maxBytes: limits.maxResponseBytes, userAgent: ENGINE_USER_AGENT, signal: controller.signal, auth, scope: (u) => u.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") || permitted.includes(u.hostname.toLowerCase()) }),
    home: null, homeFetch: null, startUrl: cfg.url, robots: null, robotsFetch: null, sitemap: null, summaries: new Map(), performance: [],
  };

  const retestIds = cfg.retest ? new Set(cfg.retest.testIds) : null;
  const siteC = new Collector(undefined);
  const pageCollectors = new Map<string, Collector>();
  let infra: InfraOutcome = { reachable: false, startUrl: cfg.url, httpsAvailable: false, homeFetch: null, cdn: null, errorBody: "", homeSetCookies: [] };
  const state: { crawl: CrawlStats | null } = { crawl: null };
  const skippedPages: { url: string; reason: string }[] = [];
  const browser = await ports.browser.health();

  const stage = async (id: StageId, fn: () => Promise<string | void>, fatal = false): Promise<boolean> => {
    if (controller.signal.aborted && cancelled) { await tracker.set(id, "cancelled"); return false; }
    await tracker.set(id, "running");
    log("info", id, `Started: ${id}`);
    try {
      const note = await fn();
      await tracker.set(id, "completed", note ? { note } : {});
      return true;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      failedStages++;
      log("error", id, `Stage failed: ${msg}`);
      await tracker.set(id, fatal ? "failed" : "failed", { error: msg.slice(0, 300) });
      return false;
    }
  };

  const finish = async (status: "completed" | "partial" | "failed" | "cancelled", error?: string): Promise<RunResult> => {
    clearInterval(poll);
    clearTimeout(deadline);
    aborters.delete(auditId);
    credentials.delete(auditId);
    await store.patchAudit(auditId, { status, stage: null, error: error ?? null, completedAt: new Date(), progress, heartbeat: true });
    log(status === "failed" ? "error" : "info", "report_prep", `Audit ${status}${error ? `: ${error}` : ""}`);
    try { await finalizeRetest(auditId); await ports.notifier.finished(auditId); } catch (e) { log("warn", "report_prep", `Notification failed: ${(e as Error).message}`); }
    try {
      if (await maybeAutoDiscover(auditId, (e) => log("warn", "report_prep", `Competitor discovery failed: ${e.message}`))) log("info", "report_prep", "Competitor discovery started in the background.");
    } catch (e) { log("warn", "report_prep", `Competitor discovery could not start: ${(e as Error).message}`); }
    return { status };
  };

  try {
    await store.patchAudit(auditId, { status: "running", startedAt: new Date(), heartbeat: true });

    // 1. validate_input
    const okInput = await stage("validate_input", async () => {
      const u = parseAuditUrl(cfg.url);
      if (!u.ok) throw new Error(u.error);
      if (!cfg.authorization?.confirmed) throw new Error("The authorization confirmation is missing.");
      if (!cfg.modules || !Object.values(cfg.modules).some(Boolean)) throw new Error("No audit module is enabled.");
      return "Input accepted.";
    }, true);
    if (!okInput) return finish("failed", tracker.get().find((s) => s.id === "validate_input")?.error ?? "Invalid input");

    // 2. scope_safety
    const okScope = await stage("scope_safety", async () => {
      await resolvePublic(host);
      for (const h of permitted) await resolvePublic(h);
      if (authScope?.enabled) {
        if (!settings.allowAuthenticatedScope) throw new Error("Authenticated scope is disabled by the platform administrator.");
        if (!authScope.confirmed || !authScope.allowedPathPrefixes.length) throw new Error("Authenticated scope requires explicit confirmation and at least one allowed path prefix.");
        if (!credential) log("warn", "scope_safety", "Authenticated scope was requested but the credential is no longer available (it is never stored); continuing without authentication.");
      }
      return `Host ${host} resolves to public addresses only.${auth ? " Authenticated scope active for the listed path prefixes." : ""}`;
    }, true);
    if (!okScope) return finish("failed", tracker.get().find((s) => s.id === "scope_safety")?.error ?? "Scope check failed");

    // 3. reachability (+ 4. domain & redirects, produced by the same inspection)
    await stage("reachability", async () => {
      infra = await runInfra(ctx, siteC);
      ctx.homeFetch = infra.homeFetch;
      ctx.startUrl = normalizeUrl(infra.startUrl) ?? infra.startUrl;
      progress.requests = count.requests;
      if (!infra.reachable) throw new Error("The website could not be reached; dependent tests are reported as blocked.");
      return `Reachable via ${infra.startUrl}`;
    });
    await tracker.set("domain_redirects", infra.reachable ? "running" : "skipped", infra.reachable ? {} : { note: "Skipped: the site was not reachable." });
    if (infra.reachable) await tracker.set("domain_redirects", "completed", { note: `${infra.homeFetch?.redirects.length ?? 0} redirect hop(s) from the supplied URL.` });

    let seeds: CrawlItem[] = [];
    if (infra.reachable && !controller.signal.aborted) {
      // 5. discovery
      await stage("discovery", async () => {
        await runRobotsAndSitemap(ctx, siteC);
        seeds.push({ url: ctx.startUrl, depth: 0, important: true, source: "seed" });
        for (const p of cfg.importantPages ?? []) { const n = normalizeUrl(p, ctx.origin); if (n) seeds.push({ url: n, depth: 1, important: true, source: "seed" }); }
        const maxPages = Math.min(cfg.maxPages, limits.maxPages);
        for (const u of (ctx.sitemap?.urls ?? []).slice(0, maxPages * 2)) seeds.push({ url: u, depth: 1, important: false, source: "sitemap", from: undefined });
        progress.discovered = seeds.length;
        progress.requests = count.requests;
        await store.patchAudit(auditId, { progress });
        return `${ctx.sitemap?.urls.length ?? 0} sitemap URL(s); robots.txt ${ctx.robots ? "found" : "not found"}.`;
      });

      // 6. crawl
      await stage("crawl", async () => {
        const maxPages = Math.min(cfg.maxPages, limits.maxPages);
        const important = new Set((cfg.importantPages ?? []).map((p) => normalizeUrl(p, ctx.origin)).filter(Boolean) as string[]);
        let lastSave = 0;
        const cs = await crawl({
          startUrl: ctx.startUrl, siteHost: host, permittedHosts: permitted, maxPages, maxDepth: Math.min(cfg.maxDepth, limits.maxDepth), concurrency: Math.min(cfg.concurrency, limits.maxConcurrency),
          perHostDelayMs: Math.max(limits.perHostDelayMs, ctx.robots?.groups.find((g) => g.agents.includes("*"))?.crawlDelay ? Math.min(5000, (ctx.robots?.groups.find((g) => g.agents.includes("*"))?.crawlDelay ?? 0) * 1000) : 0),
          timeoutMs: limits.requestTimeoutMs, maxBytes: limits.maxResponseBytes, budgetMs: Math.max(30_000, limits.maxDurationMs - (Date.now() - started) - 60_000),
          userAgent: ENGINE_USER_AGENT, robots: ctx.robots, seeds, auth, signal: controller.signal,
          onPage: async (item, fetched) => handlePage(item, fetched, important),
          onProgress: (s) => {
            progress.discovered = s.discovered; progress.inspected = s.fetched; progress.failed = s.failed; progress.skipped = s.skippedRobots + s.skippedScope + s.skippedLimit; progress.requests = count.requests + s.requests;
            if (Date.now() - lastSave > 2500) { lastSave = Date.now(); void store.patchAudit(auditId, { progress, heartbeat: true }); }
          },
        });
        state.crawl = cs;
        progress.discovered = cs.discovered; progress.inspected = cs.fetched; progress.failed = cs.failed;
        progress.skipped = cs.skippedRobots + cs.skippedScope + cs.skippedLimit; progress.requests = count.requests + cs.requests;
        for (const s of cs.skipped) skippedPages.push(s);
        return `${cs.fetched} page(s) fetched${cs.limitHit ? `; stopped at the ${cs.limitHit} limit` : ""}.`;
      });
    } else {
      await tracker.set("discovery", "skipped", { note: "Skipped: the site was not reachable." });
      await tracker.set("crawl", "skipped", { note: "Skipped: the site was not reachable." });
    }

    async function handlePage(item: CrawlItem, fetched: SafeFetchResult, importantSet: Set<string>): Promise<{ links: string[] }> {
      const important = item.important || importantSet.has(item.url);
      const weight = item.depth === 0 ? 3 : important ? 2 : 1;
      const c = new Collector(item.url, weight);
      pageCollectors.set(item.url, c);
      const isStart = item.url === ctx.startUrl;
      const ct = header(fetched, "content-type");
      const html = fetched.ok && fetched.status !== null && (ct === null || /html|xml/i.test(ct));
      if (!fetched.ok || fetched.status === null) {
        c.fail("seo.http.status", { actual: fetched.error?.message ?? "No response", expected: "2xx", ...measured });
        ctx.summaries.set(item.url, emptySummary(item, weight, null, fetched));
        return { links: [] };
      }
      if (!html) {
        c.add("seo.http.status", fetched.status < 400 ? "passed" : "failed", { actual: `HTTP ${fetched.status} (${ct ?? "unknown type"})`, expected: "2xx", ...measured });
        ctx.summaries.set(item.url, emptySummary(item, weight, fetched.status, fetched));
        return { links: [] };
      }
      const p = extractPage({ requestedUrl: item.url, fetched, depth: item.depth, important, isHomepage: isStart, siteHost: host, permittedHosts: permitted, discoveredFrom: item.from });
      analyzeSeoPage(p, c); analyzeSchemaPage(p, c); analyzePerfPage(p, c); analyzeAccessibilityPage(p, c); analyzeSecurityFunctionalPage(p, c); analyzeContentPage(p, c);
      if (isStart) { ctx.home = p; }
      const facts = toFacts(p);
      const summary: PageSummary = {
        url: item.url, weight, facts, links: p.links.slice(0, 600), shingles: p.wordCount >= 120 ? shingles(p.text) : null, textSample: p.text.slice(0, 4000),
        phones: extractPhones(`${p.text} ${p.links.filter((l) => l.scheme === "tel").map((l) => l.href).join(" ")}`).slice(0, 4), emails: extractEmails(`${p.text} ${p.links.filter((l) => l.scheme === "mailto").map((l) => l.href).join(" ")}`).slice(0, 4),
        hasSearch: /type=["']search["']|role=["']search["']/i.test(p.html), schemaItems: collectSchemaItems(p).slice(0, 20),
        scriptUrls: p.scripts.map((s) => s.absolute).filter(Boolean) as string[], styleUrls: p.stylesheets.map((s) => s.absolute).filter(Boolean) as string[], imageUrls: p.images.map((i) => i.src).slice(0, 60),
        downloadUrls: p.links.filter((l) => /\.(pdf|zip|docx?|xlsx?|pptx?|csv|rar|7z)(\?|$)/i.test(l.href)).map((l) => l.href).slice(0, 20), iframeUrls: p.iframes.map((f) => f.src).filter(Boolean) as string[],
        isHtml: true, canonicalNorm: p.canonicals[0] ? normalizeUrl(p.canonicals[0]) : null, noindex: facts.indexable === false && facts.indexabilityReason === "noindex directive", discoveredFrom: item.from, hasMain: p.doc.root.children.length > 0,
      };
      ctx.summaries.set(item.url, summary);
      await store.savePage(auditId, facts, null);
      const links = p.links.filter((l) => l.internal && !l.fragmentOnly && (l.scheme === "http" || l.scheme === "https")).map((l) => l.href);
      return { links };
    }

    function emptySummary(item: CrawlItem, weight: number, status: number | null, f: SafeFetchResult): PageSummary {
      const facts = blankFacts(item, status, f);
      void store.savePage(auditId, facts, null, status === null ? f.error?.message : undefined);
      return { url: item.url, weight, facts, links: [], shingles: null, textSample: "", phones: [], emails: [], hasSearch: false, schemaItems: [], scriptUrls: [], styleUrls: [], imageUrls: [], downloadUrls: [], iframeUrls: [], isHtml: false, canonicalNorm: null, noindex: false, discoveredFrom: item.from, hasMain: false };
    }

    // 7. seo (cross-page)
    await stage("seo", async () => {
      if (!infra.reachable) return "Skipped.";
      await runSeoCrosspage(ctx, siteC, pageCollectors);
      return `${ctx.summaries.size} page(s) analysed.`;
    });

    // 8. performance
    const wantsPsi = !retestIds || [...retestIds].some((id) => /^(perf\.(cwv|lab|field|js_exec)|a11y\.contrast)/.test(id));
    let psiFailures: { id: string; title: string; count: number }[] = [];
    let psiContrast: number | null = null;
    let psiRan = false;
    let probes: Awaited<ReturnType<typeof runPerformanceSite>> = [];
    await stage("performance", async () => {
      if (!infra.reachable) return "Skipped.";
      probes = await runPerformanceSite(ctx, siteC);
      const target = ctx.startUrl;
      for (const device of wantsPsi ? (cfg.devices.length ? cfg.devices : (["mobile"] as const)) : []) {
        if (controller.signal.aborted) break;
        const run = await ports.pagespeed.run(target, device, controller.signal);
        ctx.performance.push(run.sample);
        if (run.sample.available) { psiRan = true; if (device === "mobile" || psiContrast === null) { psiFailures = run.axeFailures; psiContrast = run.contrastFailures; } }
        else log("warn", "performance", `PageSpeed (${device}) unavailable: ${run.sample.reason}`);
        recordPsi(siteC, run.sample);
      }
      if (wantsPsi && (!ctx.performance.length || !psiRan)) { for (const id of ["perf.cwv.lcp", "perf.cwv.cls", "perf.cwv.inp", "perf.lab.tbt", "perf.lab.fcp", "perf.js_execution", "perf.field.available"]) siteC.notTested(id, ctx.performance[0]?.reason ?? "PageSpeed Insights is not configured."); }
      await store.savePerformance(auditId, ctx.performance);
      return psiRan ? "Lab and field data collected through PageSpeed Insights." : "Lab and field data unavailable; HTTP-level measurements recorded.";
    });

    // 9. accessibility
    await stage("accessibility", async () => {
      if (!infra.reachable) return "Skipped.";
      if (psiRan && psiFailures.length) log("warn", "accessibility", `Lighthouse reported ${psiFailures.length} failing accessibility audit(s) on the homepage: ${psiFailures.map((f) => `${f.title} (${f.count})`).slice(0, 8).join("; ")}.`, { axe: psiFailures });
      if (psiRan && psiContrast !== null) siteC.add("a11y.contrast", psiContrast === 0 ? "passed" : "failed", { evidence: psiFailures.length ? [{ kind: "json", label: "Failing Lighthouse accessibility audits (homepage)", value: JSON.stringify(psiFailures.slice(0, 20)) }] : undefined, actual: psiContrast === 0 ? "No contrast failures reported by Lighthouse" : `${psiContrast} element(s) below the required contrast`, expected: "4.5:1 for body text", note: "Reported by Lighthouse (axe-core) through PageSpeed Insights for the homepage only.", provenance: "measured", confidence: "high" });
      const bw = browser.available ? await ports.browser.inspect(ctx.startUrl, cfg.devices, limits.maxScreenshots) : { available: false, reason: browser.reason, findings: [] };
      for (const f of bw.findings) {
        if (!getTest(f.testId)) continue;
        siteC.add(f.testId, f.status, { actual: f.actual, expected: f.expected, note: f.note, device: f.device, provenance: "measured", confidence: "high" });
      }
      if (!bw.available) log("info", "accessibility", `Browser-rendered accessibility checks not run: ${bw.reason}`);
      return bw.available ? "Static analysis plus browser worker checks." : "Static analysis only; browser-rendered checks not available.";
    });

    // 10. content_functionality
    await stage("content_functionality", async () => {
      if (!infra.reachable) return "Skipped.";
      await runFunctionalitySite(ctx, infra, probes, pageCollectors, siteC);
      await runBusinessSite(ctx, siteC);
      return "Links, media, content, conversion and business checks complete.";
    });

    // 11. security
    await stage("security", async () => {
      if (!infra.reachable) return "Skipped.";
      await runSecurity(ctx, infra, siteC);
      progress.requests = count.requests + (state.crawl?.requests ?? 0);
      return "Headers, cookies, exposure probes and privacy checks complete.";
    });

    // 12. normalize
    const tests = testsForConfig(cfg).filter((t) => !retestIds || retestIds.has(t.id));
    const allResults: CheckResult[] = [];
    await stage("normalize", async () => {
      const applicable = new Set(tests.map((t) => t.id));
      const pageResultsByUrl = new Map<string, CheckResult[]>();
      for (const [url, c] of pageCollectors) pageResultsByUrl.set(url, c.results.filter((r) => applicable.has(r.testId)));
      const siteResults = siteC.results.filter((r) => applicable.has(r.testId));
      const have = new Set<string>();
      for (const rs of pageResultsByUrl.values()) for (const r of rs) have.add(r.testId);
      for (const r of siteResults) have.add(r.testId);
      const filler = new Collector(undefined);
      for (const t of tests) {
        if (have.has(t.id)) continue;
        filler.add(t.id, missingStatus(t, infra.reachable, browser.available), { note: missingNote(t, infra.reachable, browser.reason) });
      }
      for (const [url, rs] of pageResultsByUrl) { await store.saveChecks(auditId, url, rs); allResults.push(...rs); }
      const siteAll = [...siteResults, ...filler.results];
      await store.saveChecks(auditId, "", siteAll);
      allResults.push(...siteAll);
      return `${allResults.length} result(s) recorded for ${tests.length} test(s).`;
    });

    // 13. scoring
    const scores = computeScores({ results: allResults, tests, weights: settings.weights, incomplete: failedStages > 0 || cancelled || state.crawl?.limitHit === "duration" });
    await stage("scoring", async () => {
      for (const [url, c] of pageCollectors) await store.updatePageScore(auditId, url, scorePage(c.results));
      await store.patchAudit(auditId, { scores });
      return `Overall ${scores.overall ?? "n/a"}${scores.provisional ? " (provisional)" : ""}; coverage ${Math.round(scores.coverage * 100)}%.`;
    });

    // 14. recommendations
    let findingsCount = 0;
    await stage("recommendations", async () => {
      const findings = deriveFindings({ hostname: host, results: allResults, tests });
      const prev = await store.previousCompleted(row.owner_id, host, auditId);
      const prevFindings = prev ? await store.loadFindings(prev.id) : [];
      const prevSet = new Set(prevFindings.filter((f) => f.kind === "defect").map((f) => f.fingerprint));
      const lineage = new Map(findings.filter((f) => f.kind === "defect").map((f) => [f.fingerprint, prev ? (prevSet.has(f.fingerprint) ? ("recurring" as const) : ("new" as const)) : null]));
      await store.replaceFindings(auditId, findings, lineage);
      await store.saveRecommendations(auditId, buildRecommendations(findings));
      if (prev) {
        await store.carryWorkflow(prev.id, auditId);
        await store.patchAudit(auditId, { previousAuditId: prev.id });
        if (row.kind === "audit") {
          try {
            const r = await reconcileAfterAudit(auditId, prev.id, allResults);
            if (r.carried || r.verified || r.failed) log("info", "recommendations", `Recommendation lifecycle: ${r.carried} carried, ${r.verified} verified by rescan, ${r.failed} failed, ${r.regressed} regressed.`);
          } catch (e) { log("warn", "recommendations", `Recommendation lifecycle reconciliation failed: ${(e as Error).message}`); }
        }
      }
      findingsCount = findings.filter((f) => f.kind === "defect").length;
      progress.findings = findingsCount;
      return `${findingsCount} finding(s), ${buildRecommendations(findings).length} recommendation(s).`;
    });

    // 15. report_prep
    const coverage: CoverageReport = {
      seedUrls: seeds.filter((s) => s.source === "seed").length, discovered: state.crawl?.discovered ?? 0, inspected: state.crawl?.fetched ?? 0, failed: state.crawl?.failed ?? 0,
      skippedRobots: state.crawl?.skippedRobots ?? 0, skippedScope: state.crawl?.skippedScope ?? 0, skippedLimit: state.crawl?.skippedLimit ?? 0, depthReached: state.crawl?.depthReached ?? 0,
      maxDepth: Math.min(cfg.maxDepth, limits.maxDepth), maxPages: Math.min(cfg.maxPages, limits.maxPages), sitemapUrls: ctx.sitemap?.urls.length ?? 0,
      sitemapOnly: (ctx.sitemap?.urls ?? []).filter((u) => !ctx.summaries.has(u)).length, durationMs: Date.now() - started, limitHit: state.crawl?.limitHit ?? null, skipped: skippedPages.slice(0, 200),
    };
    const environment: EnvironmentRecord = {
      engineVersion: ENGINE_VERSION, scoringVersion: SCORING_VERSION, schemaVersion: AUDIT_SCHEMA_VERSION, userAgent: ENGINE_USER_AGENT, nodeVersion: ports.runtime.version, location: ports.runtime.location,
      browserWorker: browser.available ? "connected" : ports.runtime.browserWorkerConfigured ? "unreachable" : "not_configured", pageSpeed: psiRan ? "available" : ports.pagespeed.configured ? "unreachable" : "not_configured", startedAt: new Date(started).toISOString(),
    };
    await stage("report_prep", async () => {
      await store.patchAudit(auditId, { coverage, environment });
      const prevId = (await store.getAudit(auditId))?.previousAuditId;
      if (prevId) await persistComparison(auditId, prevId, row.owner_id);
      return "Report data ready.";
    });

    if (cancelled) return finish("cancelled");
    const finalStatus = !infra.reachable ? "failed" : failedStages > 0 || scores.provisional && coverage.limitHit === "duration" ? "partial" : "completed";
    return finish(finalStatus, !infra.reachable ? "The website could not be reached." : undefined);
  } catch (err) {
    log("error", "report_prep", `Unexpected failure: ${(err as Error).message}`);
    return finish(cancelled ? "cancelled" : "failed", (err as Error).message);
  }
}

function blankFacts(item: CrawlItem, status: number | null, f: SafeFetchResult): PageFacts {
  return {
    url: item.url, finalUrl: f.finalUrl, depth: item.depth, status, redirects: f.redirects.length, contentType: header(f, "content-type"), htmlBytes: f.body.length, transferBytes: f.transferBytes, ttfbMs: f.ttfbMs, totalMs: f.totalMs, compression: f.contentEncoding, cacheControl: header(f, "cache-control"),
    title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0, canonical: null, robotsMeta: null, xRobotsTag: header(f, "x-robots-tag"), indexable: status !== null && status < 400 ? null : false, indexabilityReason: status === null ? (f.error?.message ?? "No response") : status >= 400 ? `HTTP ${status}` : "Not an HTML document", lang: null,
    h1Count: 0, headingCount: 0, wordCount: 0, readingEase: null, imagesTotal: 0, imagesMissingAlt: 0, imagesMissingDimensions: 0, internalLinks: 0, externalLinks: 0, schemaTypes: [], scriptCount: 0, stylesheetCount: 0, renderBlockingCount: 0, thirdPartyHosts: [], domNodes: 0, formCount: 0, important: item.important, discoveredFrom: item.from,
  };
}

function recordPsi(c: Collector, s: import("@workspace/wi-core").PerformanceSample): void {
  if (!s.available) { for (const id of ["perf.cwv.lcp", "perf.cwv.cls", "perf.lab.tbt", "perf.lab.fcp", "perf.js_execution"]) c.add(id, "not_tested", { note: `${s.device}: ${s.reason ?? "unavailable"}`, device: s.device }); return; }
  const lab = s.lab ?? {};
  const base = { provenance: "measured" as const, confidence: "high" as const, device: s.device, note: `Lab data, ${s.device}. ${s.environment ?? ""}`.trim() };
  const g = (id: string, v: number | undefined, good: number, poor: number, unit: string, label: string) => {
    if (v === undefined) return c.add(id, "inconclusive", { note: `${s.device}: ${label} was not reported.`, device: s.device });
    c.add(id, v <= good ? "passed" : v <= poor ? "warning" : "failed", { actual: `${unit === "ms" ? `${Math.round(v)} ms` : v.toFixed(3)}`, expected: `${good}${unit === "ms" ? " ms" : ""} or less`, ...base });
  };
  g("perf.cwv.lcp", lab.lcpMs, 2500, 4000, "ms", "LCP");
  g("perf.cwv.cls", lab.cls, 0.1, 0.25, "", "CLS");
  g("perf.lab.tbt", lab.tbtMs, 200, 600, "ms", "TBT");
  g("perf.lab.fcp", lab.fcpMs, 1800, 3000, "ms", "FCP");
  if (s.field) {
    c.add("perf.field.available", "passed", { actual: `${s.field.origin ? "Origin-level" : "URL-level"} Chrome UX Report data (${s.field.category ?? "no category"})`, ...base, note: `Field data, ${s.device}.` });
    if (s.field.inpMs !== undefined) c.add("perf.cwv.inp", s.field.inpMs <= 200 ? "passed" : s.field.inpMs <= 500 ? "warning" : "failed", { actual: `${s.field.inpMs} ms (75th percentile)`, expected: "200 ms or less", ...base, note: "Field data (real users)." });
    else c.add("perf.cwv.inp", "inconclusive", { note: "Field data exists but INP was not reported." });
  } else {
    c.add("perf.field.available", "failed", { actual: "No Chrome UX Report field data for this URL or origin", expected: "Field data available", ...base, note: "Real-user Core Web Vitals performance is not established by this report." });
    c.add("perf.cwv.inp", "not_tested", { note: "INP is measured only in field data, which is not published for this site." });
  }
  c.add("perf.js_execution", "not_tested", { note: "Boot-up time was not extracted from this run." });
}

function missingStatus(t: TestDefinition, reachable: boolean, browserUp: boolean): TestStatus {
  if (!reachable) return "blocked";
  if (t.requires === "browser") return browserUp ? "not_tested" : "not_tested";
  return t.requires ? "not_tested" : "not_tested";
}
function missingNote(t: TestDefinition, reachable: boolean, browserReason?: string): string {
  if (!reachable) return "The website could not be reached, so this test could not run.";
  switch (t.requires) {
    case "browser": return `Needs a real browser. ${browserReason ?? "The browser worker did not return a result."}`;
    case "pagespeed": return "Needs PageSpeed Insights data, which was not available.";
    case "owner": return "Needs evidence supplied by the site owner; it cannot be observed from outside.";
    case "integration": return "Needs an authorised integration that is not connected.";
    default: return "No result was produced for this test in this run.";
  }
}

export async function persistComparison(currentId: string, previousId: string, ownerId: string): Promise<void> {
  const [cur, prev] = await Promise.all([store.getAudit(currentId), store.getAudit(previousId)]);
  if (!cur || !prev) return;
  const [cf, pf, cp, pp, cr, pr] = await Promise.all([store.loadFindings(currentId), store.loadFindings(previousId), store.loadPages(currentId), store.loadPages(previousId), store.loadChecks(currentId), store.loadChecks(previousId)]);
  const statuses = (rs: CheckResult[]) => { const m: Record<string, TestStatus> = {}; for (const r of rs) { const cur0 = m[r.testId]; if (!cur0 || r.status === "failed") m[r.testId] = r.status; } return m; };
  const env = (a: typeof cur) => `${a.environment?.engineVersion ?? "?"}/${a.environment?.pageSpeed ?? "?"}`;
  const cmp = compareAudits(
    { id: cur.id, scores: cur.scores, findings: cf, pages: cp.map((p) => p.facts), testStatuses: statuses(cr), environment: env(cur) },
    { id: prev.id, scores: prev.scores, findings: pf, pages: pp.map((p) => p.facts), testStatuses: statuses(pr), environment: env(prev) },
  );
  await store.saveComparison(ownerId, currentId, previousId, cmp);
}

