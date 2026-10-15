import type { PageData } from "./page-data";

export interface TechDetection {
  analytics: string[];
  trackers: string[];
  consent: string[];
  errorMonitoring: string[];
  tagManagers: string[];
}

const ANALYTICS: [RegExp, string][] = [
  [/googletagmanager\.com\/gtag\/js\?id=G-|gtag\(['"]config['"],\s*['"]G-/i, "Google Analytics 4"], [/google-analytics\.com\/(analytics|ga)\.js|UA-\d{4,}-\d+/i, "Google Analytics (Universal)"],
  [/plausible\.io\/js|data-domain=/i, "Plausible"], [/cdn\.matomo\.cloud|matomo\.js|piwik\.js|_paq\.push/i, "Matomo"], [/cdn\.usefathom\.com/i, "Fathom"], [/umami\.is|data-website-id=/i, "Umami"],
  [/static\.cloudflareinsights\.com\/beacon/i, "Cloudflare Web Analytics"], [/cdn\.segment\.com|analytics\.js\/v1/i, "Segment"], [/cdn\.mxpnl\.com|mixpanel/i, "Mixpanel"], [/cdn\.amplitude\.com/i, "Amplitude"],
  [/posthog/i, "PostHog"], [/simpleanalyticscdn\.com|scripts\.simpleanalyticscdn/i, "Simple Analytics"], [/vercel-insights|_vercel\/insights/i, "Vercel Analytics"],
];
const TAG_MANAGERS: [RegExp, string][] = [[/googletagmanager\.com\/gtm\.js\?id=GTM-|GTM-[A-Z0-9]{4,}/i, "Google Tag Manager"], [/tags\.tiqcdn\.com/i, "Tealium"], [/assets\.adobedtm\.com/i, "Adobe Launch"]];
const TRACKERS: [RegExp, string][] = [
  [/connect\.facebook\.net|fbq\(/i, "Meta Pixel"], [/doubleclick\.net|googleadservices\.com|googlesyndication\.com/i, "Google Ads"], [/snap\.licdn\.com|px\.ads\.linkedin\.com/i, "LinkedIn Insight"],
  [/analytics\.tiktok\.com/i, "TikTok Pixel"], [/static\.hotjar\.com|hotjar/i, "Hotjar"], [/clarity\.ms/i, "Microsoft Clarity"], [/sc-static\.net|snap\.com\/pixel/i, "Snap Pixel"],
  [/ct\.pinterest\.com|pintrk\(/i, "Pinterest Tag"], [/bat\.bing\.com/i, "Microsoft Advertising"], [/js\.hs-scripts\.com|js\.hsforms\.net/i, "HubSpot"], [/fullstory\.com/i, "FullStory"], [/criteo\.(com|net)/i, "Criteo"],
  [/googletagmanager\.com\/gtag\/js|google-analytics\.com/i, "Google Analytics"],
];
const CONSENT: [RegExp, string][] = [
  [/cookiebot\.com|Cookiebot/i, "Cookiebot"], [/onetrust\.com|cdn\.cookielaw\.org|optanon/i, "OneTrust"], [/osano\.com/i, "Osano"], [/iubenda\.com/i, "iubenda"], [/termly\.io/i, "Termly"],
  [/usercentrics\./i, "Usercentrics"], [/cookieconsent|cc-window|cookie-consent|cookie-banner|cookie-notice|cookie_notice|cmplz-|complianz|gdpr-cookie|cookieyes|cky-consent/i, "Cookie notice"], [/trustarc|truste\.com/i, "TrustArc"], [/civiccomputing|cookiecontrol/i, "Civic Cookie Control"],
  [/didomi\.io/i, "Didomi"], [/quantcast\.mgr|quantserve\.com\/choice/i, "Quantcast Choice"],
];
const ERRORS: [RegExp, string][] = [
  [/browser\.sentry-cdn\.com|sentry\.io|Sentry\.init/i, "Sentry"], [/bugsnag/i, "Bugsnag"], [/rollbar/i, "Rollbar"], [/datadoghq|DD_RUM|datadog-rum/i, "Datadog RUM"], [/newrelic|nr-data\.net/i, "New Relic"],
  [/logrocket/i, "LogRocket"], [/raygun/i, "Raygun"], [/trackjs/i, "TrackJS"], [/honeybadger/i, "Honeybadger"],
];

export function detectTech(p: PageData): TechDetection {
  const haystack = `${p.scripts.map((s) => `${s.absolute ?? ""} ${s.src ?? ""}`).join(" ")}\n${p.html.slice(0, 600_000)}`;
  const hit = (list: [RegExp, string][]) => [...new Set(list.filter(([re]) => re.test(haystack)).map(([, n]) => n))];
  return { analytics: hit(ANALYTICS), trackers: hit(TRACKERS), consent: hit(CONSENT), errorMonitoring: hit(ERRORS), tagManagers: hit(TAG_MANAGERS) };
}

const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{3,4})?\b/g;
export function extractPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(PHONE) ?? []) {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) out.add(digits);
  }
  return [...out].slice(0, 6);
}
export function extractEmails(text: string): string[] {
  return [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()))].filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e)).slice(0, 6);
}
