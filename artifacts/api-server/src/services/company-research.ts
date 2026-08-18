/**
 * Live public-web research for company name + website.
 * Extracts on-page signals only; labels evidence carefully.
 */

export type ResearchClaim = {
  claim: string;
  evidence: "VERIFIED" | "USER PROVIDED" | "INFERRED" | "UNKNOWN";
  source: string | null;
  date: string | null;
};

export type CompanyWebResearch = {
  companyName: string;
  website: string | null;
  researchedAt: string;
  pageTitle: string | null;
  metaDescription: string | null;
  headings: string[];
  emails: string[];
  phones: string[];
  socialLinks: string[];
  keywords: string[];
  aboutSnippet: string | null;
  companyInsights: ResearchClaim[];
  strategyHints: string[];
  assessmentHints: string[];
  fetchError?: string;
};

function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${prop}["'][^>]*content=["']([^"']+)["'][^>]*>|<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${prop}["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  return (m?.[1] || m?.[2] || null)?.trim() || null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() || null;
}

function extractHeadings(html: string, limit = 12): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    const t = stripTags(m[1]);
    if (t && t.length > 2 && t.length < 160) out.push(t);
  }
  return out;
}

function extractEmails(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    set.add(m[0].toLowerCase());
  }
  return [...set].slice(0, 8);
}

function extractPhones(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/g)) {
    const t = m[0].trim();
    if (t.replace(/\D/g, "").length >= 9) set.add(t);
  }
  return [...set].slice(0, 6);
}

function extractSocial(html: string): string[] {
  const set = new Set<string>();
  const re = /href=["'](https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|twitter|x|youtube|tiktok)\.com\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) set.add(m[1].split("?")[0]);
  return [...set].slice(0, 10);
}

function keywordHints(text: string): string[] {
  const bag = text.toLowerCase();
  const catalog = [
    "saas", "software", "platform", "ecommerce", "retail", "agency", "marketing",
    "fintech", "payments", "healthcare", "education", "logistics", "manufacturing",
    "subscription", "b2b", "b2c", "ai", "automation", "analytics", "crm",
  ];
  return catalog.filter((k) => bag.includes(k)).slice(0, 10);
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "CINTEXA-Nexus-Research/1.0 (+https://cintexa.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { html: html.slice(0, 500_000), finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

export async function researchCompanyWeb(input: {
  companyName: string;
  website?: string;
  industry?: string;
}): Promise<CompanyWebResearch> {
  const companyName = (input.companyName || "").trim() || "Company";
  const website = normalizeUrl(input.website || "");
  const today = new Date().toISOString().slice(0, 10);
  const base: CompanyWebResearch = {
    companyName,
    website,
    researchedAt: new Date().toISOString(),
    pageTitle: null,
    metaDescription: null,
    headings: [],
    emails: [],
    phones: [],
    socialLinks: [],
    keywords: [],
    aboutSnippet: null,
    companyInsights: [],
    strategyHints: [],
    assessmentHints: [],
  };

  base.companyInsights.push({
    claim: `Research subject: ${companyName}`,
    evidence: "USER PROVIDED",
    source: "Diagnostic profile",
    date: today,
  });

  if (!website) {
    base.companyInsights.push({
      claim: "No website supplied — public page extraction was not possible",
      evidence: "UNKNOWN",
      source: null,
      date: null,
    });
    base.strategyHints.push("Add the company website to enable live public-page research.");
    base.assessmentHints.push("Website presence and messaging clarity remain UNKNOWN without a URL.");
    return base;
  }

  try {
    const { html, finalUrl } = await fetchHtml(website);
    const title = extractTitle(html) || extractMeta(html, "og:title");
    const desc =
      extractMeta(html, "description") ||
      extractMeta(html, "og:description") ||
      extractMeta(html, "twitter:description");
    const headings = extractHeadings(html);
    const text = stripTags(html);
    const emails = extractEmails(text);
    const phones = extractPhones(text);
    const socialLinks = extractSocial(html);
    const keywords = keywordHints(`${title || ""} ${desc || ""} ${text.slice(0, 4000)}`);
    const aboutSnippet = desc || text.slice(0, 280) || null;

    base.pageTitle = title;
    base.metaDescription = desc;
    base.headings = headings;
    base.emails = emails;
    base.phones = phones;
    base.socialLinks = socialLinks;
    base.keywords = keywords;
    base.aboutSnippet = aboutSnippet;
    base.website = finalUrl;

    if (title) {
      base.companyInsights.push({
        claim: `Public page title: ${title}`,
        evidence: "VERIFIED",
        source: finalUrl,
        date: today,
      });
    }
    if (desc) {
      base.companyInsights.push({
        claim: `Meta description: ${desc}`,
        evidence: "VERIFIED",
        source: finalUrl,
        date: today,
      });
    }
    if (headings.length) {
      base.companyInsights.push({
        claim: `Primary on-page themes: ${headings.slice(0, 5).join(" · ")}`,
        evidence: "VERIFIED",
        source: finalUrl,
        date: today,
      });
    }
    if (socialLinks.length) {
      base.companyInsights.push({
        claim: `Public social profiles linked from site: ${socialLinks.join(", ")}`,
        evidence: "VERIFIED",
        source: finalUrl,
        date: today,
      });
    }
    if (keywords.length) {
      base.companyInsights.push({
        claim: `Keyword signals on public site: ${keywords.join(", ")}`,
        evidence: "INFERRED",
        source: finalUrl,
        date: today,
      });
    }
    if (emails.length) {
      base.companyInsights.push({
        claim: `Contact emails found on public pages: ${emails.join(", ")}`,
        evidence: "VERIFIED",
        source: finalUrl,
        date: today,
      });
    }

    // Strategy & assessment from live signals
    if (desc) {
      base.strategyHints.push(`Align messaging and offers with the public value proposition: “${desc.slice(0, 140)}”.`);
      base.assessmentHints.push("Marketing positioning can be scored from the public meta description and hero themes.");
    }
    if (socialLinks.length) {
      base.strategyHints.push("Build a paid + organic plan around the social networks already linked from the website.");
      base.assessmentHints.push("Paid social diagnosis should prioritise networks already present on the site.");
    } else {
      base.strategyHints.push("No social links found on the homepage — consider adding verified profile links and testing one primary ad network.");
    }
    if (keywords.includes("b2b") || keywords.includes("saas") || keywords.includes("software")) {
      base.strategyHints.push("Public signals lean software/B2B — prioritise pipeline quality, sales cycle and CRM discipline.");
      base.assessmentHints.push("Weight sales, technology and automation pillars in the diagnostic.");
    }
    if (keywords.includes("ecommerce") || keywords.includes("retail")) {
      base.strategyHints.push("Commerce signals detected — prioritise conversion rate, AOV and contribution margin.");
    }
    base.strategyHints.push(`Use ${finalUrl} as the baseline for conversion-path and CTA review in the 30-day plan.`);
    base.assessmentHints.push("Competitive claims remain UNKNOWN until competitor pages are reviewed with source/date.");
  } catch (err: any) {
    base.fetchError = err?.message || "Fetch failed";
    base.companyInsights.push({
      claim: `Could not retrieve public page content from ${website}: ${base.fetchError}`,
      evidence: "UNKNOWN",
      source: website,
      date: today,
    });
    base.strategyHints.push("Website fetch failed — verify the URL and retry research before treating digital presence as verified.");
  }

  if (input.industry) {
    base.companyInsights.push({
      claim: `Industry context (user): ${input.industry}`,
      evidence: "USER PROVIDED",
      source: "Diagnostic profile",
      date: today,
    });
  }

  return base;
}

export async function researchCompetitorSites(
  competitors: Array<{ name: string; website?: string }>,
): Promise<
  Array<{
    name: string;
    website: string | null;
    pageTitle: string | null;
    metaDescription: string | null;
    claims: ResearchClaim[];
    strategyPrompts: string[];
  }>
> {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const c of competitors.slice(0, 5)) {
    const name = c.name?.trim() || "Competitor";
    const website = normalizeUrl(c.website || "");
    const claims: ResearchClaim[] = [
      {
        claim: `Competitor named ${name}`,
        evidence: "USER PROVIDED",
        source: "User / AI seed",
        date: today,
      },
    ];
    let pageTitle: string | null = null;
    let metaDescription: string | null = null;
    if (website) {
      try {
        const { html, finalUrl } = await fetchHtml(website);
        pageTitle = extractTitle(html) || extractMeta(html, "og:title");
        metaDescription = extractMeta(html, "description") || extractMeta(html, "og:description");
        if (pageTitle) {
          claims.push({ claim: `Title: ${pageTitle}`, evidence: "VERIFIED", source: finalUrl, date: today });
        }
        if (metaDescription) {
          claims.push({
            claim: `Positioning signal: ${metaDescription}`,
            evidence: "VERIFIED",
            source: finalUrl,
            date: today,
          });
        }
      } catch (err: any) {
        claims.push({
          claim: `Could not fetch ${website}: ${err?.message || "error"}`,
          evidence: "UNKNOWN",
          source: website,
          date: today,
        });
      }
    } else {
      claims.push({
        claim: "No competitor website supplied",
        evidence: "UNKNOWN",
        source: null,
        date: null,
      });
    }
    out.push({
      name,
      website,
      pageTitle,
      metaDescription,
      claims,
      strategyPrompts: [
        `What customer problem does ${name} claim to solve publicly?`,
        `Where is ${name} weaker on price, speed, specialization or service?`,
        `Which CTA or offer on their site could inform a controlled experiment?`,
      ],
    });
  }
  return out;
}
