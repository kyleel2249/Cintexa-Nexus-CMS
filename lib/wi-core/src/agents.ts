/**
 * Registry of the Website Intelligence agent roles. Each role is a deterministic unit of the engine with a clear responsibility.
 * `status` is stated honestly: "active" means the capability exists and runs; "partial" lists what is missing; "gated" means the
 * role is built only up to its approval gate and does not act on a site by itself.
 */
export type WiAgentStatus = "active" | "partial" | "gated";
export interface WiAgentInfo {
  id: string;
  name: string;
  group: "audit" | "competitive" | "action";
  purpose: string;
  /** Where in the product this agent's work is visible. */
  where: { label: string; href: string };
  status: WiAgentStatus;
  /** Plain statement of what it does not do. */
  limits: string;
  /** Approval rule, when it can change anything. */
  governance?: string;
}

export const WI_AGENTS: readonly WiAgentInfo[] = [
  { id: "discovery", name: "Discovery Agent", group: "audit", purpose: "Finds the pages, assets and technologies of a site by crawling it politely (robots.txt, SSRF protection, per-host delay).", where: { label: "New audit", href: "/website-intelligence/new" }, status: "active", limits: "Public pages only; crawl is capped by the audit limits." },
  { id: "master-audit", name: "Master Audit Agent", group: "audit", purpose: "Runs the test catalogue across the crawled sample and scores each category with versioned scoring.", where: { label: "Audits", href: "/website-intelligence/audits" }, status: "active", limits: "Unavailable tests are excluded and reported, never guessed." },
  { id: "dashboard", name: "Dashboard Agent", group: "audit", purpose: "Summarises portfolio health from stored audits.", where: { label: "Website Intelligence", href: "/website-intelligence" }, status: "active", limits: "Shows only measured audit data." },
  { id: "page-intelligence", name: "Page Intelligence Agent", group: "audit", purpose: "Analyses each page: SEO, content, accessibility, UX and technical signals with evidence.", where: { label: "Audits", href: "/website-intelligence/audits" }, status: "active", limits: "Passive analysis; no logged-in pages unless configured." },
  { id: "performance", name: "Performance Agent", group: "audit", purpose: "Collects lab performance data and PageSpeed results when a key is configured.", where: { label: "Audits", href: "/website-intelligence/audits" }, status: "partial", limits: "Lab data only, not field data. PageSpeed needs an API key; the browser worker is optional." },
  { id: "competitor-discovery", name: "Competitor Discovery Agent", group: "competitive", purpose: "Finds likely competitors from the site's own content using an approved search API, and keeps every candidate's evidence.", where: { label: "Audit → Competitors", href: "/website-intelligence/audits" }, status: "partial", limits: "Needs a search API key. Topic inference is term-based, not a language model.", governance: "Your approvals and rejections are never overridden by a rerun." },
  { id: "competitive-analysis", name: "Competitive Analysis Agent", group: "competitive", purpose: "Compares your site with measured competitor audits category by category.", where: { label: "Audit → Benchmarks", href: "/website-intelligence/audits" }, status: "partial", limits: "Site-level comparison only; page-level comparison is not built." },
  { id: "benchmarking", name: "Benchmarking Agent", group: "competitive", purpose: "Builds the benchmark report: peer median, difference, confidence and caveats, with non-comparable sites excluded and explained.", where: { label: "Audit → Benchmarks", href: "/website-intelligence/audits" }, status: "active", limits: "A peer median describes the chosen peers, not an industry.", governance: "Competitor audits start only after you confirm authorisation." },
  { id: "recommendations", name: "Recommendations Agent", group: "action", purpose: "Turns confirmed defects into prioritised recommendations with evidence, effort and verification steps, and proposes them for approval.", where: { label: "Recommendations", href: "/website-intelligence/audits" }, status: "active", limits: "Proposes only. It cannot approve, reject, defer or verify.", governance: "People decide; every decision is logged." },
  { id: "action", name: "Action Agent", group: "action", purpose: "Applies an approved recommendation. It may act only when the execution gate allows it.", where: { label: "Recommendations (approval workflow)", href: "/website-intelligence/audits" }, status: "gated", limits: "The approval gate and reporting path exist; the agent that applies changes to a site is not built, so nothing is changed automatically.", governance: "Runs only on an APPROVED recommendation with an approval under 30 days old." },
  { id: "monitoring", name: "Monitoring Agent", group: "action", purpose: "Re-runs audits on a schedule and records regressions.", where: { label: "Monitors", href: "/website-intelligence" }, status: "partial", limits: "Site monitors exist; competitor-change alerts and approval notifications are not built." },
  { id: "verification", name: "Verification Agent", group: "action", purpose: "Confirms a fix with an independent retest or rescan. Only a passing test verifies; an inconclusive result changes nothing.", where: { label: "Recommendations", href: "/website-intelligence/audits" }, status: "active", limits: "A passing test shows the checked condition holds on the sampled pages.", governance: "Cannot be set by the requester; manual verification needs an owner or admin note." },
];
