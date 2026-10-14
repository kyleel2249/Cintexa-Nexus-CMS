/** robots.txt parsing and matching following RFC 9309 (longest match wins, Allow wins ties, * and $ wildcards). */

export interface RobotsRule { allow: boolean; pattern: string }
export interface RobotsGroup { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }
export interface Robots { groups: RobotsGroup[]; sitemaps: string[]; raw: string }

export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") { if (/^https?:\/\//i.test(value)) sitemaps.push(value); continue; }
    if (!current) continue;
    if (key === "allow" || key === "disallow") current.rules.push({ allow: key === "allow", pattern: value });
    else if (key === "crawl-delay") { const n = Number(value); if (Number.isFinite(n)) current.crawlDelay = n; }
  }
  return { groups, sitemaps, raw: text };
}

function patternToRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc.endsWith("\\$") ? esc.slice(0, -2) + "$" : esc}`);
}

function groupFor(r: Robots, agent: string): RobotsGroup | null {
  const a = agent.toLowerCase();
  let best: { g: RobotsGroup; len: number } | null = null;
  for (const g of r.groups) for (const name of g.agents) {
    if (name === "*") { if (!best) best = { g, len: 0 }; continue; }
    if (a.includes(name) && name.length > (best?.len ?? -1)) best = { g, len: name.length };
  }
  return best?.g ?? null;
}

export function isAllowed(r: Robots, pathAndQuery: string, agent: string): boolean {
  const g = groupFor(r, agent);
  if (!g) return true;
  let verdict = true;
  let bestLen = -1;
  for (const rule of g.rules) {
    if (!rule.pattern) continue; // empty Disallow = allow all
    if (patternToRegex(rule.pattern).test(pathAndQuery)) {
      const len = rule.pattern.length;
      if (len > bestLen || (len === bestLen && rule.allow)) { bestLen = len; verdict = rule.allow; }
    }
  }
  return verdict;
}

/** True when `Disallow: /` applies to all user agents (without a longer Allow carving out content). */
export function blocksEverything(r: Robots): boolean {
  const g = r.groups.find((x) => x.agents.includes("*"));
  if (!g) return false;
  const dis = g.rules.some((x) => !x.allow && (x.pattern === "/" || x.pattern === "/*"));
  const allowsSome = g.rules.some((x) => x.allow && x.pattern.length > 1);
  return dis && !allowsSome;
}

export function blockedAssetPaths(r: Robots): string[] {
  const g = r.groups.find((x) => x.agents.includes("*")) ?? r.groups.find((x) => x.agents.some((a) => a.includes("googlebot")));
  if (!g) return [];
  return g.rules.filter((x) => !x.allow && /^\/(css|js|assets|static|_next|wp-content\/themes|wp-includes|dist|build|scripts|styles)\b/i.test(x.pattern)).map((x) => x.pattern);
}
