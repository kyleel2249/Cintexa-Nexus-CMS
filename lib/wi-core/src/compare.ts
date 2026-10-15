import { CATEGORY_IDS, CATEGORY_LABELS, type AuditComparison, type CategoryId, type Finding, type PageFacts, type ScoreBreakdown, type Severity, type TestStatus } from "./types";

export interface ComparableAudit {
  id: string;
  scores: ScoreBreakdown | null;
  findings: Pick<Finding, "fingerprint" | "title" | "severity" | "category" | "kind">[];
  pages: Pick<PageFacts, "url" | "status" | "title" | "metaDescription">[];
  /** Aggregate test status by test id (used for security headers and similar). */
  testStatuses: Record<string, TestStatus>;
  environment?: string;
}

const HEADER_TESTS: Record<string, string> = {
  "sec.hsts": "Strict-Transport-Security",
  "sec.csp": "Content-Security-Policy",
  "sec.frame": "Clickjacking protection",
  "sec.nosniff": "X-Content-Type-Options",
  "sec.referrer": "Referrer-Policy",
  "sec.permissions": "Permissions-Policy",
};

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

const ok = (s: TestStatus | undefined) => s === "passed";

export function compareAudits(current: ComparableAudit, previous: ComparableAudit): AuditComparison {
  const cs = current.scores;
  const ps = previous.scores;
  const versionMismatch = Boolean(cs && ps && cs.version !== ps.version);
  const curDefects = current.findings.filter((f) => f.kind === "defect");
  const prevDefects = previous.findings.filter((f) => f.kind === "defect");
  const curSet = new Map(curDefects.map((f) => [f.fingerprint, f]));
  const prevSet = new Map(prevDefects.map((f) => [f.fingerprint, f]));
  const pick = (f: Pick<Finding, "fingerprint" | "title" | "severity" | "category">) => ({ fingerprint: f.fingerprint, title: f.title, severity: f.severity, category: f.category });
  const bySeverity = (a: { severity: Severity }, b: { severity: Severity }) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);

  const newFindings = curDefects.filter((f) => !prevSet.has(f.fingerprint)).map(pick).sort(bySeverity);
  const resolvedFindings = prevDefects.filter((f) => !curSet.has(f.fingerprint)).map(pick).sort(bySeverity);
  const recurringFindings = curDefects.filter((f) => prevSet.has(f.fingerprint)).map(pick).sort(bySeverity);

  const categoryDeltas = CATEGORY_IDS.map((category: CategoryId) => {
    const c = cs?.categories.find((x) => x.category === category)?.score ?? null;
    const p = ps?.categories.find((x) => x.category === category)?.score ?? null;
    return { category, label: CATEGORY_LABELS[category], current: c, previous: p, delta: c !== null && p !== null ? Math.round((c - p) * 10) / 10 : null };
  });

  const regressions: AuditComparison["regressions"] = [];
  const improvements: AuditComparison["improvements"] = [];
  for (const d of categoryDeltas) {
    if (d.delta === null) continue;
    if (d.delta <= -3) regressions.push({ label: `${d.label} score`, previous: String(d.previous), current: String(d.current) });
    else if (d.delta >= 3) improvements.push({ label: `${d.label} score`, previous: String(d.previous), current: String(d.current) });
  }
  for (const f of newFindings) if (f.severity === "critical" || f.severity === "high") regressions.push({ label: `New ${f.severity} finding: ${f.title}`, previous: "not present", current: "present" });
  for (const f of resolvedFindings) if (f.severity === "critical" || f.severity === "high") improvements.push({ label: `Resolved ${f.severity} finding: ${f.title}`, previous: "present", current: "not present" });

  const curUrls = new Set(current.pages.map((p) => p.url));
  const prevUrls = new Set(previous.pages.map((p) => p.url));
  const pagesAdded = [...curUrls].filter((u) => !prevUrls.has(u)).slice(0, 200);
  const pagesRemoved = [...prevUrls].filter((u) => !curUrls.has(u)).slice(0, 200);

  const broken = (a: ComparableAudit) => new Set(a.pages.filter((p) => p.status !== null && p.status >= 400).map((p) => p.url));
  const curBroken = broken(current);
  const prevBroken = broken(previous);
  const metaCov = (a: ComparableAudit) => {
    const ok2xx = a.pages.filter((p) => p.status !== null && p.status >= 200 && p.status < 300);
    return ok2xx.length ? Math.round((ok2xx.filter((p) => p.title && p.metaDescription).length / ok2xx.length) * 1000) / 10 : null;
  };

  const securityHeaderChanges: AuditComparison["securityHeaderChanges"] = [];
  for (const [id, header] of Object.entries(HEADER_TESTS)) {
    const a = previous.testStatuses[id];
    const b = current.testStatuses[id];
    if (!a || !b || ok(a) === ok(b)) continue;
    securityHeaderChanges.push({ header, previous: ok(a) ? "configured" : "missing or weak", current: ok(b) ? "configured" : "missing or weak" });
    (ok(b) ? improvements : regressions).push({ label: `${header}`, previous: ok(a) ? "configured" : "missing or weak", current: ok(b) ? "configured" : "missing or weak" });
  }

  const envA = previous.environment ?? "unknown";
  const envB = current.environment ?? "unknown";
  return {
    currentId: current.id,
    previousId: previous.id,
    scoringVersionCurrent: cs?.version ?? "n/a",
    scoringVersionPrevious: ps?.version ?? "n/a",
    scoringVersionMismatch: versionMismatch,
    environmentNote: envA === envB ? `Both audits ran in the same measurement environment (${envB}).` : `Measurement environments differ (previous: ${envA}; current: ${envB}); performance differences may reflect the environment, not the site.`,
    overallDelta: cs?.overall != null && ps?.overall != null ? Math.round((cs.overall - ps.overall) * 10) / 10 : null,
    categoryDeltas,
    newFindings,
    resolvedFindings,
    recurringFindings,
    regressions,
    improvements,
    pagesAdded,
    pagesRemoved,
    brokenLinks: { previous: prevBroken.size, current: curBroken.size, newlyBroken: [...curBroken].filter((u) => !prevBroken.has(u)).slice(0, 100) },
    metadataCoverage: { previous: metaCov(previous), current: metaCov(current) },
    securityHeaderChanges,
  };
}

/** Marks lineage (new / recurring) for the current findings relative to the previous audit. */
export function lineageFor(fingerprint: string, previousFingerprints: ReadonlySet<string> | null): "new" | "recurring" | null {
  if (!previousFingerprints) return null;
  return previousFingerprints.has(fingerprint) ? "recurring" : "new";
}
