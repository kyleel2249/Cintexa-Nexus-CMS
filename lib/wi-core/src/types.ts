/**
 * Website Intelligence Engine - shared contracts.
 *
 * Everything in this package is isomorphic (no Node-only imports) so the API server, the
 * dashboard and the PDF generator all reason about audits with the same definitions.
 */

export const SCORING_VERSION = "1.0.0";
export const AUDIT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Categories and weights
// ---------------------------------------------------------------------------

export const CATEGORY_IDS = [
  "seo",
  "performance",
  "functionality",
  "ux",
  "security",
  "content",
  "accessibility",
  "infrastructure",
  "analytics",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  seo: "SEO and search readiness",
  performance: "Performance",
  functionality: "Functionality and completeness",
  ux: "UX/UI and responsive design",
  security: "Security and privacy posture",
  content: "Content quality and trust",
  accessibility: "Accessibility",
  infrastructure: "Infrastructure and reliability",
  analytics: "Analytics and maintenance",
};

export const CATEGORY_SHORT_LABELS: Record<CategoryId, string> = {
  seo: "SEO",
  performance: "Performance",
  functionality: "Functionality",
  ux: "UX / Responsive",
  security: "Security",
  content: "Content",
  accessibility: "Accessibility",
  infrastructure: "Infrastructure",
  analytics: "Analytics",
};

/** Initial weights. Administrators may change them as long as they total 100. */
export const DEFAULT_WEIGHTS: Record<CategoryId, number> = {
  seo: 20,
  performance: 15,
  functionality: 15,
  ux: 12,
  security: 12,
  content: 8,
  accessibility: 7,
  infrastructure: 6,
  analytics: 5,
};

// ---------------------------------------------------------------------------
// Statuses, severities, provenance
// ---------------------------------------------------------------------------

export const TEST_STATUSES = [
  "passed",
  "failed",
  "warning",
  "informational",
  "not_applicable",
  "not_tested",
  "blocked",
  "inconclusive",
] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Where a result came from. The product never blends these together:
 *  - measured      : a value the engine measured itself (timings, sizes, status codes)
 *  - observed      : something read from the live site (headers, markup, text)
 *  - inferred      : a heuristic conclusion; always carries medium/low confidence
 *  - user_supplied : taken from the audit form or an authorised owner integration
 *  - unavailable   : the data could not be obtained; no result is implied
 */
export type Provenance = "measured" | "observed" | "inferred" | "user_supplied" | "unavailable";
export type Confidence = "high" | "medium" | "low";
export type Effort = "XS" | "S" | "M" | "L" | "XL";

export const EFFORT_HOURS: Record<Effort, [number, number]> = {
  XS: [0.25, 1],
  S: [1, 4],
  M: [4, 12],
  L: [12, 40],
  XL: [40, 120],
};

export type Horizon = "immediate" | "short" | "strategic";

// ---------------------------------------------------------------------------
// Audit configuration
// ---------------------------------------------------------------------------

export const WEBSITE_TYPES = [
  "corporate",
  "software",
  "ecommerce",
  "blog",
  "saas",
  "portfolio",
  "education",
  "nonprofit",
  "local_business",
  "membership",
] as const;
export type WebsiteType = (typeof WEBSITE_TYPES)[number];

export const WEBSITE_TYPE_LABELS: Record<WebsiteType, string> = {
  corporate: "Corporate / business",
  software: "Software / technology company",
  ecommerce: "E-commerce store",
  blog: "Blog / publishing",
  saas: "SaaS product / web application",
  portfolio: "Portfolio / personal",
  education: "Educational platform",
  nonprofit: "Nonprofit / institutional",
  local_business: "Local business",
  membership: "Membership / customer portal",
};

export type Device = "mobile" | "desktop";
export type AuditProfile = "standard" | "comprehensive" | "advanced";

export interface AuditModules {
  seo: boolean;
  performance: boolean;
  accessibility: boolean;
  security: boolean;
  content: boolean;
  functionality: boolean;
  structuredData: boolean;
  localSeo: boolean;
  ecommerce: boolean;
  business: boolean;
  analytics: boolean;
}

export const MODULE_KEYS = [
  "seo",
  "performance",
  "accessibility",
  "security",
  "content",
  "functionality",
  "structuredData",
  "localSeo",
  "ecommerce",
  "business",
  "analytics",
] as const satisfies readonly (keyof AuditModules)[];

export interface AuthorizationRecord {
  confirmed: boolean;
  statement: string;
  confirmedBy: string;
  confirmedAt: string;
}

export interface AuthenticatedScope {
  enabled: boolean;
  /** Explicit second confirmation that authenticated testing is permitted. */
  confirmed: boolean;
  /** Only requests whose path starts with one of these prefixes carry the credential. */
  allowedPathPrefixes: string[];
  /** Name of the request header the credential is sent in, e.g. "Authorization" or "Cookie". */
  headerName: string;
  /** True when a credential was supplied. The credential itself is never persisted. */
  credentialSupplied: boolean;
}

export interface AuditConfig {
  url: string;
  name?: string;
  websiteType: WebsiteType;
  objective?: string;
  market?: string;
  audience?: string;
  language?: string;
  importantPages: string[];
  maxDepth: number;
  maxPages: number;
  concurrency: number;
  devices: Device[];
  profile: AuditProfile;
  modules: AuditModules;
  /** Verify outbound links with a HEAD request. Off by default: it touches third-party hosts. */
  externalLinkCheck: boolean;
  /** Extra hostnames (besides the audited one and its www/apex twin) that may be crawled. */
  permittedHosts: string[];
  authenticated: AuthenticatedScope;
  report: { language: string; brandName?: string; confidentiality?: string };
  authorization: AuthorizationRecord;
  /** Present on targeted retests: only these tests are scored and the audit is tied to the findings being verified. */
  retest?: { parentAuditId: string; fingerprints: string[]; testIds: string[] };
  /** Free-form workspace / client label used by agencies to group audits. */
  workspace?: string;
}

export interface AuditLimits {
  maxPages: number;
  maxDepth: number;
  maxConcurrency: number;
  maxDurationMs: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxScreenshots: number;
  maxExternalLinks: number;
  maxAssetProbes: number;
  perHostDelayMs: number;
  maxActiveAuditsPerUser: number;
  maxAuditsPerUserPerHour: number;
  maxGlobalConcurrentAudits: number;
  retentionDays: number;
}

export const DEFAULT_LIMITS: AuditLimits = {
  maxPages: 200,
  maxDepth: 6,
  maxConcurrency: 6,
  maxDurationMs: 20 * 60 * 1000,
  requestTimeoutMs: 15_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxScreenshots: 12,
  maxExternalLinks: 40,
  maxAssetProbes: 40,
  perHostDelayMs: 120,
  maxActiveAuditsPerUser: 3,
  maxAuditsPerUserPerHour: 12,
  maxGlobalConcurrentAudits: 2,
  retentionDays: 365,
};

export const PROFILE_PRESETS: Record<AuditProfile, { label: string; description: string; maxPages: number; maxDepth: number; externalLinkCheck: boolean; devices: Device[] }> = {
  standard: {
    label: "Standard",
    description: "Fast, passive review of up to 25 pages: crawlability, on-page SEO, security headers, content and static accessibility checks.",
    maxPages: 25,
    maxDepth: 2,
    externalLinkCheck: false,
    devices: ["mobile"],
  },
  comprehensive: {
    label: "Comprehensive",
    description: "Up to 100 pages, both device profiles, outbound link verification and the full test catalogue.",
    maxPages: 100,
    maxDepth: 4,
    externalLinkCheck: true,
    devices: ["mobile", "desktop"],
  },
  advanced: {
    label: "Advanced",
    description: "Deepest crawl within configured limits. Optional authorised authenticated scope and browser-rendered checks when a browser worker is connected.",
    maxPages: 200,
    maxDepth: 6,
    externalLinkCheck: true,
    devices: ["mobile", "desktop"],
  },
};

export function defaultModules(): AuditModules {
  return {
    seo: true,
    performance: true,
    accessibility: true,
    security: true,
    content: true,
    functionality: true,
    structuredData: true,
    localSeo: true,
    ecommerce: true,
    business: true,
    analytics: true,
  };
}

// ---------------------------------------------------------------------------
// Test catalogue
// ---------------------------------------------------------------------------

export interface Reference {
  title: string;
  url: string;
}

export interface TestImpact {
  user?: string;
  search?: string;
  business?: string;
  security?: string;
}

export interface TestDefinition {
  id: string;
  category: CategoryId;
  subcategory: string;
  /** Tag keys used for the additional scores (technical_seo, on_page_seo, mobile, conversion ...). */
  tags: string[];
  title: string;
  /** What the test measures. */
  measures: string;
  scope: "site" | "page";
  /** Severity when the test fails. A warning is reported one level lower. */
  severity: Severity;
  method: string;
  pass: string;
  partial?: string;
  fail: string;
  evidenceRequired: string;
  exclusions?: string;
  rationale: string;
  impact: TestImpact;
  fix: string;
  implementation: string;
  effort: Effort;
  verify: string;
  refs: Reference[];
  wcag?: string[];
  /** Test ids that should be fixed first (used to order the roadmap). */
  dependsOn?: string[];
  /** Restricts when the test applies. Empty/omitted = always. */
  appliesToTypes?: WebsiteType[];
  /** Module switch that enables this test. */
  module: keyof AuditModules;
  /** Requires a real browser or an external service; reported as not_tested/blocked when absent. */
  requires?: "browser" | "pagespeed" | "owner" | "integration";
  /** Raises the readiness gate when it fails (critical security/privacy/availability/payment). */
  gate?: boolean;
  /** Marks problems that actively prevent indexing or break a user journey. */
  blocking?: boolean;
}

export interface Evidence {
  kind: "header" | "html" | "url" | "measurement" | "text" | "json" | "status";
  label: string;
  value: string;
}

export interface CheckResult {
  testId: string;
  status: TestStatus;
  /** Page or resource the result is about. Absent for site-level tests. */
  url?: string;
  actual?: string;
  expected?: string;
  evidence?: Evidence[];
  provenance: Provenance;
  confidence: Confidence;
  observedAt: string;
  /** Why a result is blocked / inconclusive / not tested, or extra context. */
  note?: string;
  device?: Device;
  /** Relative importance of the page this result came from (homepage / key pages count more). */
  pageWeight?: number;
}

// ---------------------------------------------------------------------------
// Findings and recommendations (derived from check results)
// ---------------------------------------------------------------------------

export type FindingKind = "defect" | "limitation" | "observation";
export type VerificationState = "verified" | "probable" | "unverified";

export interface Finding {
  fingerprint: string;
  testId: string;
  category: CategoryId;
  subcategory: string;
  tags: string[];
  title: string;
  kind: FindingKind;
  status: TestStatus;
  severity: Severity;
  confidence: Confidence;
  provenance: Provenance;
  verification: VerificationState;
  description: string;
  affectedUrls: string[];
  affectedCount: number;
  applicableCount: number;
  evidence: Evidence[];
  expected?: string;
  actual?: string;
  observedAt: string;
  impact: TestImpact;
  measurementMethod: string;
  rootCause: string;
  fix: string;
  implementation: string;
  effort: Effort;
  verify: string;
  refs: Reference[];
  wcag?: string[];
  dependsOn: string[];
  priorityScore: number;
  horizon: Horizon;
  gate: boolean;
  blocking: boolean;
  note?: string;
}

export interface Recommendation {
  fingerprint: string;
  testId: string;
  rank: number;
  title: string;
  category: CategoryId;
  severity: Severity;
  horizon: Horizon;
  priorityScore: number;
  problem: string;
  evidenceSummary: string;
  affectedUrls: string[];
  correction: string;
  implementation: string;
  expectedOutcome: string;
  effort: Effort;
  effortHours: [number, number];
  dependencies: string[];
  riskOfInaction: string;
  verification: string;
  refs: Reference[];
  verification_state: VerificationState;
}

export interface Roadmap {
  immediate: Recommendation[];
  short: Recommendation[];
  strategic: Recommendation[];
  /** Fingerprints in the order the work should be carried out. */
  sequence: string[];
  totalEffortHours: [number, number];
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface CategoryScore {
  category: CategoryId;
  label: string;
  weight: number;
  /** 0-100, or null when no applicable test produced a scoreable result. */
  score: number | null;
  applicableTests: number;
  completedTests: number;
  passedTests: number;
  failedTests: number;
  warningTests: number;
  /** blocked + inconclusive + not tested. Never counted as passes. */
  unavailableTests: number;
  informationalTests: number;
  /** completed / applicable, 0-1. */
  coverage: number;
  provisional: boolean;
}

export interface AdditionalScore {
  key: string;
  label: string;
  score: number | null;
  applicableTests: number;
  completedTests: number;
  coverage: number;
}

export type Band = "Exceptional" | "Excellent" | "Very good" | "Good, with improvements needed" | "Needs substantial improvement" | "Major remediation required";

export type ReadinessState = "ready" | "ready_with_improvements" | "conditional" | "not_ready" | "incomplete";

export interface Readiness {
  state: ReadinessState;
  label: string;
  /** Plain-language reasons, each tied to a documented rule. */
  reasons: string[];
  gatingFindings: string[];
}

export interface ScoreBreakdown {
  version: string;
  overall: number | null;
  provisional: boolean;
  band: Band | null;
  coverage: number;
  categories: CategoryScore[];
  additional: AdditionalScore[];
  readiness: Readiness;
  weights: Record<CategoryId, number>;
  formula: string;
  counts: Record<TestStatus, number>;
  severityCounts: Record<Severity, number>;
}

// ---------------------------------------------------------------------------
// Audit records
// ---------------------------------------------------------------------------

export const AUDIT_STATUSES = ["queued", "running", "completed", "partial", "failed", "cancelled"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const STAGE_IDS = [
  "validate_input",
  "scope_safety",
  "reachability",
  "domain_redirects",
  "discovery",
  "crawl",
  "seo",
  "performance",
  "accessibility",
  "content_functionality",
  "security",
  "normalize",
  "scoring",
  "recommendations",
  "report_prep",
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGE_LABELS: Record<StageId, string> = {
  validate_input: "Input validation",
  scope_safety: "Scope and safety validation",
  reachability: "Website reachability",
  domain_redirects: "Domain and redirect inspection",
  discovery: "Page discovery",
  crawl: "Page crawling",
  seo: "SEO analysis",
  performance: "Performance measurement",
  accessibility: "Accessibility analysis",
  content_functionality: "Content and functionality checks",
  security: "Security configuration review",
  normalize: "Data normalization",
  scoring: "Score calculation",
  recommendations: "Recommendation generation",
  report_prep: "Report preparation",
};

export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";

export interface StageState {
  id: StageId;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  note?: string;
}

export interface AuditProgress {
  discovered: number;
  inspected: number;
  failed: number;
  skipped: number;
  findings: number;
  requests: number;
}

export interface PageFacts {
  url: string;
  finalUrl: string;
  depth: number;
  status: number | null;
  redirects: number;
  contentType: string | null;
  htmlBytes: number;
  transferBytes: number;
  ttfbMs: number | null;
  totalMs: number | null;
  compression: string | null;
  cacheControl: string | null;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  indexable: boolean | null;
  indexabilityReason: string | null;
  lang: string | null;
  h1Count: number;
  headingCount: number;
  wordCount: number;
  readingEase: number | null;
  imagesTotal: number;
  imagesMissingAlt: number;
  imagesMissingDimensions: number;
  internalLinks: number;
  externalLinks: number;
  schemaTypes: string[];
  scriptCount: number;
  stylesheetCount: number;
  renderBlockingCount: number;
  thirdPartyHosts: string[];
  domNodes: number;
  formCount: number;
  important: boolean;
  discoveredFrom?: string;
  /** Present when the page was inspected through a browser worker. */
  rendered?: boolean;
}

export interface PageRecord {
  facts: PageFacts;
  checks: CheckResult[];
  score: number | null;
  skippedReason?: string;
}

export interface CoverageReport {
  seedUrls: number;
  discovered: number;
  inspected: number;
  failed: number;
  skippedRobots: number;
  skippedScope: number;
  skippedLimit: number;
  depthReached: number;
  maxDepth: number;
  maxPages: number;
  sitemapUrls: number;
  sitemapOnly: number;
  durationMs: number;
  limitHit: "pages" | "depth" | "duration" | null;
  skipped: { url: string; reason: string }[];
}

export interface PerformanceSample {
  device: Device;
  url: string;
  source: "pagespeed" | "http";
  available: boolean;
  reason?: string;
  fetchedAt: string;
  lab?: { lcpMs?: number; fcpMs?: number; cls?: number; tbtMs?: number; speedIndexMs?: number; ttfbMs?: number; performanceScore?: number };
  field?: { lcpMs?: number; inpMs?: number; cls?: number; fcpMs?: number; ttfbMs?: number; category?: string; origin: boolean } | null;
  environment?: string;
}

export interface EnvironmentRecord {
  engineVersion: string;
  scoringVersion: string;
  schemaVersion: number;
  userAgent: string;
  nodeVersion: string;
  location?: string;
  browserWorker: "connected" | "not_configured" | "unreachable";
  pageSpeed: "available" | "not_configured" | "unreachable";
  startedAt: string;
}

export interface AuditSummary {
  id: string;
  kind: "audit" | "benchmark" | "retest";
  hostname: string;
  url: string;
  name: string | null;
  websiteType: WebsiteType;
  profile: AuditProfile;
  status: AuditStatus;
  stage: StageId | null;
  stages: StageState[];
  progress: AuditProgress;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  ownerId: string;
  ownerEmail: string | null;
  scoringVersion: string;
  scores: ScoreBreakdown | null;
  previousAuditId: string | null;
  parentAuditId: string | null;
  error: string | null;
  config: AuditConfig;
  coverage: CoverageReport | null;
  environment: EnvironmentRecord | null;
  monitorId: string | null;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const FINDING_STATUSES = [
  "open",
  "triaged",
  "planned",
  "in_progress",
  "fixed",
  "retest_required",
  "verified",
  "accepted_risk",
  "dismissed",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  open: "Open",
  triaged: "Triaged",
  planned: "Planned",
  in_progress: "In progress",
  fixed: "Fixed",
  retest_required: "Retest required",
  verified: "Verified",
  accepted_risk: "Accepted risk",
  dismissed: "Dismissed",
};

export type RetestStatus = "none" | "passed" | "failed" | "inconclusive";

export interface FindingWorkflow {
  id: string;
  auditId: string;
  fingerprint: string;
  status: FindingStatus;
  owner: string | null;
  notes: string;
  /** Required when accepting a risk, dismissing, or manually verifying. */
  rationale: string | null;
  dueDate: string | null;
  retestStatus: RetestStatus;
  retestAuditId: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationMethod: "retest" | "manual" | null;
  /** Recurrence relative to the previous audit of the same site. */
  lineage: "new" | "recurring" | "resolved" | null;
  createdAt: string;
  updatedAt: string;
}

export interface FindingView extends Finding {
  id: string;
  workflow: FindingWorkflow;
}

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface RemediationTask {
  id: string;
  auditId: string;
  fingerprint: string | null;
  title: string;
  description: string;
  owner: string | null;
  dueDate: string | null;
  status: TaskStatus;
  horizon: Horizon;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface AuditComparison {
  currentId: string;
  previousId: string;
  scoringVersionCurrent: string;
  scoringVersionPrevious: string;
  scoringVersionMismatch: boolean;
  environmentNote: string;
  overallDelta: number | null;
  categoryDeltas: { category: CategoryId; label: string; current: number | null; previous: number | null; delta: number | null }[];
  newFindings: { fingerprint: string; title: string; severity: Severity; category: CategoryId }[];
  resolvedFindings: { fingerprint: string; title: string; severity: Severity; category: CategoryId }[];
  recurringFindings: { fingerprint: string; title: string; severity: Severity; category: CategoryId }[];
  regressions: { label: string; previous: string; current: string }[];
  improvements: { label: string; previous: string; current: string }[];
  pagesAdded: string[];
  pagesRemoved: string[];
  brokenLinks: { previous: number; current: number; newlyBroken: string[] };
  metadataCoverage: { previous: number | null; current: number | null };
  securityHeaderChanges: { header: string; previous: string; current: string }[];
}

// ---------------------------------------------------------------------------
// Bundles used by the dashboard, shared reports and the PDF generator
// ---------------------------------------------------------------------------

export interface AuditBundle {
  audit: AuditSummary;
  findings: FindingView[];
  recommendations: Recommendation[];
  roadmap: Roadmap;
  pages: Pick<PageRecord, "facts" | "score">[];
  performance: PerformanceSample[];
  tasks: RemediationTask[];
  previous: { id: string; completedAt: string | null; overall: number | null } | null;
  comparison: AuditComparison | null;
  generatedAt: string;
}

export const REPORT_TYPES = [
  "executive",
  "technical",
  "seo",
  "performance",
  "accessibility",
  "security",
  "conversion",
  "roadmap",
  "comparison",
  "full",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  executive: "Executive website audit",
  technical: "Full technical audit",
  seo: "SEO audit",
  performance: "Performance report",
  accessibility: "Accessibility report",
  security: "Security posture report",
  conversion: "Business conversion assessment",
  roadmap: "Remediation roadmap",
  comparison: "Before-and-after comparison",
  full: "Full comprehensive report",
};
