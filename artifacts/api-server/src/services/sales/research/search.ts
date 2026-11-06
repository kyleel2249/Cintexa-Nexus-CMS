/**
 * Internal website discovery for name-only research. No search engine or API key is involved:
 * likely domains are derived from the company name and a candidate is accepted ONLY when the page it serves
 * actually names the company. Nothing is guessed silently; the engine tells the user how the website was chosen.
 */

const STOP = new Set(["ltd", "limited", "inc", "llc", "plc", "co", "company", "corp", "corporation", "group", "holdings", "the", "and", "of", "for", "enterprise", "enterprises"]);

const COUNTRY_TLDS: Record<string, string[]> = {
  ghana: ["com.gh", "gh", "org.gh"],
  nigeria: ["com.ng", "ng"],
  kenya: ["co.ke", "ke"],
  "south africa": ["co.za", "za"],
  "united kingdom": ["co.uk", "uk"],
  uk: ["co.uk", "uk"],
};
const GENERIC_TLDS = ["com", "co", "io", "org", "net"];

export function companyTokens(name: string): string[] {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Ordered, de-duplicated candidate hostnames (at most `max`). */
export function guessDomains(company: string, country?: string, max = 10): string[] {
  const tokens = companyTokens(company);
  if (!tokens.length) return [];
  const bases = new Set<string>([tokens.join(""), tokens.join("-")]);
  if (tokens.length > 1 && tokens[0]!.length >= 4) bases.add(tokens[0]!);
  const local = COUNTRY_TLDS[(country ?? "").trim().toLowerCase()] ?? [];
  const tlds = [...local, ...GENERIC_TLDS];
  const out: string[] = [];
  for (const tld of tlds) for (const b of bases) { const h = `${b}.${tld}`; if (!out.includes(h)) out.push(h); }
  return out.slice(0, max);
}

/** True when the page clearly belongs to the company: every name token appears, and at least one is in the title or host. */
export function pageMatchesCompany(page: { title?: string | null; text?: string | null; host: string }, company: string): boolean {
  const tokens = companyTokens(company);
  if (!tokens.length) return false;
  const title = String(page.title ?? "").toLowerCase();
  const body = `${title} ${String(page.text ?? "").slice(0, 6000).toLowerCase()}`;
  const host = page.host.toLowerCase();
  if (/(domain (is )?for sale|buy this domain|this domain (is|may be) (for sale|parked)|parked (free|domain)|domain parking)/.test(body)) return false;
  return tokens.every((t) => body.includes(t)) && tokens.some((t) => title.includes(t) || host.includes(t));
}

export interface ProbedPage { title: string | null; text: string; finalUrl: string }

/** Probe candidates in order with the supplied (SSRF-guarded) fetcher; returns the first verified match. */
export async function discoverWebsite(
  company: string,
  hint: { country?: string },
  probe: (url: string) => Promise<ProbedPage | null>,
): Promise<{ url: string | null; tried: string[] }> {
  const tried: string[] = [];
  for (const host of guessDomains(company, hint.country)) {
    const url = `https://${host}/`;
    tried.push(host);
    let page: ProbedPage | null = null;
    try { page = await probe(url); } catch { page = null; }
    if (!page) continue;
    let finalHost = host;
    try { finalHost = new URL(page.finalUrl).hostname; } catch { /* keep guessed host */ }
    if (pageMatchesCompany({ title: page.title, text: page.text, host: finalHost }, company)) return { url: page.finalUrl, tried };
  }
  return { url: null, tried };
}
