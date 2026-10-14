import type { CategoryId, Effort, Reference, Severity, TestDefinition, TestImpact, WebsiteType, AuditModules } from "./types";

/** Compact authoring shape. `defineTest` expands it into a full TestDefinition. */
export interface TestSeed {
  title: string;
  measures: string;
  sev: Severity;
  scope?: "site" | "page";
  module: keyof AuditModules;
  method?: string;
  pass: string;
  partial?: string;
  fail: string;
  evidence?: string;
  exclusions?: string;
  why?: string;
  user?: string;
  search?: string;
  business?: string;
  security?: string;
  fix: string;
  how: string;
  effort: Effort;
  verify?: string;
  refs: Reference[];
  wcag?: string[];
  dep?: string[];
  types?: WebsiteType[];
  req?: TestDefinition["requires"];
  gate?: boolean;
  block?: boolean;
}

const DEFAULT_VERIFY = "Re-run the audit (or a targeted retest of this finding) and confirm the test now passes on every affected URL.";

const DEFAULT_METHOD: Record<"site" | "page", string> = {
  site: "Observed directly from live HTTP responses for the audited host.",
  page: "Observed from the HTTP response and parsed HTML of each crawled page.",
};

export function defineTest(id: string, category: CategoryId, subcategory: string, tags: string[], s: TestSeed): TestDefinition {
  const scope = s.scope ?? "page";
  const impact: TestImpact = {};
  if (s.user) impact.user = s.user;
  if (s.search) impact.search = s.search;
  if (s.business) impact.business = s.business;
  if (s.security) impact.security = s.security;
  const def: TestDefinition = {
    id,
    category,
    subcategory,
    tags,
    title: s.title,
    measures: s.measures,
    scope,
    severity: s.sev,
    method: s.method ?? DEFAULT_METHOD[scope],
    pass: s.pass,
    fail: s.fail,
    evidenceRequired: s.evidence ?? "URL, the observed value and the expected value.",
    rationale: s.why ?? `Defined so that ${s.measures.charAt(0).toLowerCase()}${s.measures.slice(1)} can be compared against a documented, repeatable standard.`,
    impact,
    fix: s.fix,
    implementation: s.how,
    effort: s.effort,
    verify: s.verify ?? DEFAULT_VERIFY,
    refs: s.refs,
    module: s.module,
  };
  if (s.partial) def.partial = s.partial;
  if (s.exclusions) def.exclusions = s.exclusions;
  if (s.wcag) def.wcag = s.wcag;
  if (s.dep) def.dependsOn = s.dep;
  if (s.types) def.appliesToTypes = s.types;
  if (s.req) def.requires = s.req;
  if (s.gate) def.gate = true;
  if (s.block) def.blocking = true;
  return def;
}

const ref = (title: string, url: string): Reference => ({ title, url });

/** Official documentation used as references. Only stable, vendor-maintained URLs are listed. */
export const R = {
  robots: ref("Google Search Central: robots.txt introduction", "https://developers.google.com/search/docs/crawling-indexing/robots/intro"),
  sitemaps: ref("Google Search Central: sitemaps overview", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview"),
  canonical: ref("Google Search Central: consolidate duplicate URLs", "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"),
  titleLink: ref("Google Search Central: title links", "https://developers.google.com/search/docs/appearance/title-link"),
  snippet: ref("Google Search Central: snippets and meta descriptions", "https://developers.google.com/search/docs/appearance/snippet"),
  robotsMeta: ref("Google Search Central: robots meta tag and X-Robots-Tag", "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag"),
  redirects: ref("Google Search Central: redirects and Google Search", "https://developers.google.com/search/docs/crawling-indexing/301-redirects"),
  hreflang: ref("Google Search Central: localized versions of pages", "https://developers.google.com/search/docs/specialty/international/localized-versions"),
  structured: ref("Google Search Central: structured data introduction", "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data"),
  richResults: ref("Google Rich Results Test", "https://search.google.com/test/rich-results"),
  schemaOrg: ref("Schema.org full hierarchy", "https://schema.org/docs/full.html"),
  jsSeo: ref("Google Search Central: JavaScript SEO basics", "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics"),
  images: ref("Google Search Central: image SEO best practices", "https://developers.google.com/search/docs/appearance/google-images"),
  links: ref("Google Search Central: make links crawlable", "https://developers.google.com/search/docs/crawling-indexing/links-crawlable"),
  helpful: ref("Google Search Central: creating helpful, reliable content", "https://developers.google.com/search/docs/fundamentals/creating-helpful-content"),
  localBusiness: ref("Google Search Central: LocalBusiness structured data", "https://developers.google.com/search/docs/appearance/structured-data/local-business"),
  product: ref("Google Search Central: Product structured data", "https://developers.google.com/search/docs/appearance/structured-data/product-snippet"),
  breadcrumb: ref("Google Search Central: breadcrumb structured data", "https://developers.google.com/search/docs/appearance/structured-data/breadcrumb"),
  vitals: ref("web.dev: Web Vitals", "https://web.dev/articles/vitals"),
  lcp: ref("web.dev: Largest Contentful Paint", "https://web.dev/articles/lcp"),
  cls: ref("web.dev: Cumulative Layout Shift", "https://web.dev/articles/cls"),
  inp: ref("web.dev: Interaction to Next Paint", "https://web.dev/articles/inp"),
  ttfb: ref("web.dev: Time to First Byte", "https://web.dev/articles/ttfb"),
  tbt: ref("web.dev: Total Blocking Time", "https://web.dev/articles/tbt"),
  fcp: ref("web.dev: First Contentful Paint", "https://web.dev/articles/fcp"),
  renderBlocking: ref("web.dev: eliminate render-blocking resources", "https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources"),
  cache: ref("web.dev: prevent unnecessary network requests with the HTTP cache", "https://web.dev/articles/http-cache"),
  compression: ref("web.dev: reduce network payloads using text compression", "https://web.dev/articles/reduce-network-payloads-using-text-compression"),
  thirdParty: ref("web.dev: efficiently load third-party JavaScript", "https://web.dev/articles/efficiently-load-third-party-javascript"),
  domSize: ref("Lighthouse: avoid an excessive DOM size", "https://developer.chrome.com/docs/lighthouse/performance/dom-size"),
  imagesPerf: ref("web.dev: learn images", "https://web.dev/learn/images"),
  lazy: ref("web.dev: browser-level image lazy loading", "https://web.dev/articles/browser-level-image-lazy-loading"),
  fonts: ref("web.dev: best practices for fonts", "https://web.dev/articles/font-best-practices"),
  wcag: ref("W3C: WCAG 2.2", "https://www.w3.org/TR/WCAG22/"),
  wcagU: (slug: string, title: string) => ref(`W3C: Understanding ${title}`, `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`),
  aria: ref("W3C: WAI-ARIA Authoring Practices", "https://www.w3.org/WAI/ARIA/apg/"),
  owaspHeaders: ref("OWASP: HTTP Headers Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html"),
  owaspSecureHeaders: ref("OWASP Secure Headers Project", "https://owasp.org/www-project-secure-headers/"),
  owaspTop10: ref("OWASP Top 10", "https://owasp.org/Top10/"),
  owaspTls: ref("OWASP: Transport Layer Security Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html"),
  owaspSession: ref("OWASP: Session Management Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html"),
  owaspCsp: ref("OWASP: Content Security Policy Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html"),
  owaspSecrets: ref("OWASP: Secrets Management Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html"),
  owaspError: ref("OWASP: Error Handling Cheat Sheet", "https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html"),
  mdnHsts: ref("MDN: Strict-Transport-Security", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security"),
  mdnCsp: ref("MDN: Content Security Policy", "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP"),
  mdnXfo: ref("MDN: X-Frame-Options", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options"),
  mdnNosniff: ref("MDN: X-Content-Type-Options", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options"),
  mdnReferrer: ref("MDN: Referrer-Policy", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy"),
  mdnPermissions: ref("MDN: Permissions-Policy", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy"),
  mdnCookies: ref("MDN: Using HTTP cookies", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies"),
  mdnMixed: ref("MDN: mixed content", "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content"),
  mdnSri: ref("MDN: Subresource Integrity", "https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity"),
  mdnViewport: ref("MDN: viewport meta tag", "https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag"),
  mdnSourceMaps: ref("MDN: source maps", "https://developer.mozilla.org/en-US/docs/Web/Security"),
  securityTxt: ref("RFC 9116: security.txt", "https://www.rfc-editor.org/rfc/rfc9116"),
  mdnForms: ref("MDN: web forms", "https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms"),
  gaConsent: ref("Google: consent mode", "https://developers.google.com/tag-platform/security/guides/consent"),
  ga4: ref("Google Analytics 4 documentation", "https://support.google.com/analytics/answer/10089681"),
  searchConsole: ref("Google Search Console help", "https://support.google.com/webmasters/answer/9128668"),
  uptime: ref("Google SRE Book: monitoring distributed systems", "https://sre.google/sre-book/monitoring-distributed-systems/"),
  gbp: ref("Google Business Profile help", "https://support.google.com/business"),
  ecomPolicies: ref("Google Merchant Center: return policy requirements", "https://support.google.com/merchants/answer/14011518"),
  rfc9110: ref("RFC 9110: HTTP semantics", "https://www.rfc-editor.org/rfc/rfc9110"),
  osv: ref("OSV: open source vulnerability database", "https://osv.dev/"),
  nvdJquery: ref("NVD: CVE-2020-11022 (jQuery)", "https://nvd.nist.gov/vuln/detail/CVE-2020-11022"),
  nvdBootstrap: ref("NVD: CVE-2019-8331 (Bootstrap)", "https://nvd.nist.gov/vuln/detail/CVE-2019-8331"),
  nvdLodash: ref("NVD: CVE-2021-23337 (lodash)", "https://nvd.nist.gov/vuln/detail/CVE-2021-23337"),
};
