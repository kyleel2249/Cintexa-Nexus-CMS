import type { AuditConfig, AuditLimits, PageFacts, PerformanceSample } from "@workspace/wi-core";
import type { PageData, LinkInfo } from "./page-data";
import type { Robots } from "./robots";
import type { SitemapResult } from "./sitemap";
import type { FetchAuth, SafeFetchOptions, SafeFetchResult } from "./safe-fetch";

/** Compact, memory-light record of a crawled page, kept for cross-page and site-level analysis. */
export interface PageSummary {
  url: string;
  weight: number;
  facts: PageFacts;
  links: LinkInfo[];
  shingles: Set<string> | null;
  textSample: string;
  phones: string[];
  emails: string[];
  hasSearch: boolean;
  schemaItems: Record<string, unknown>[];
  scriptUrls: string[];
  styleUrls: string[];
  imageUrls: string[];
  downloadUrls: string[];
  iframeUrls: string[];
  isHtml: boolean;
  canonicalNorm: string | null;
  noindex: boolean;
  discoveredFrom?: string;
  hasMain: boolean;
}

export interface AuditContext {
  auditId: string;
  cfg: AuditConfig;
  limits: AuditLimits;
  host: string;
  origin: string;
  signal: AbortSignal;
  fetchOpts: () => SafeFetchOptions;
  auth: FetchAuth | null;
  userAgent: string;
  log: (level: "info" | "warn" | "error", stage: string, message: string, data?: unknown) => void;
  count: { requests: number };
  // filled progressively
  home: PageData | null;
  homeFetch: SafeFetchResult | null;
  startUrl: string;
  robots: Robots | null;
  robotsFetch: SafeFetchResult | null;
  sitemap: SitemapResult | null;
  summaries: Map<string, PageSummary>;
  performance: PerformanceSample[];
}
