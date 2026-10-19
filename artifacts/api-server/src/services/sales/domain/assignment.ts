/** Lead / account routing rules. Pure and deterministic so the same input always routes the same way. */

export interface RepLoad {
  id: number;
  openLeads: number;
  lastAssignedAt: string | null;
}

/** Least open workload wins; ties go to whoever was assigned longest ago, then lowest id. */
export function pickRoundRobin(candidates: RepLoad[]): number | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.openLeads !== b.openLeads) return a.openLeads - b.openLeads;
    const ta = a.lastAssignedAt ? Date.parse(a.lastAssignedAt) : 0;
    const tb = b.lastAssignedAt ? Date.parse(b.lastAssignedAt) : 0;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });
  return sorted[0]!.id;
}

export interface TerritoryRule {
  id: number;
  name: string;
  countries: string[];
  regions: string[];
  industries: string[];
  members: Array<{ memberId: number; isPrimary: boolean }>;
}

export interface Routable {
  country?: string | null;
  region?: string | null;
  industry?: string | null;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface TerritoryMatch {
  territory: TerritoryRule | null;
  ownerId: number | null;
  /** why no territory/owner was chosen */
  note?: string;
}

/**
 * Most specific territory wins: region match (3) > country match (2), +1 when the industry list also matches.
 * If two territories tie at the highest specificity the lead is NOT auto-assigned - a person must resolve the
 * conflict - so ownership is never decided by an arbitrary tie-break.
 */
export function matchTerritory(territories: TerritoryRule[], r: Routable): TerritoryMatch {
  const country = norm(r.country);
  const region = norm(r.region);
  const industry = norm(r.industry);
  const scored: Array<{ t: TerritoryRule; score: number }> = [];
  for (const t of territories) {
    let score = 0;
    const regionHit = region !== "" && t.regions.some((x) => norm(x) === region);
    const countryHit = country !== "" && t.countries.some((x) => norm(x) === country);
    if (regionHit) score = 3;
    else if (countryHit) score = 2;
    else continue;
    if (t.industries.length) {
      if (industry !== "" && t.industries.some((x) => norm(x) === industry)) score += 1;
      else continue; // an industry-restricted territory does not match other industries
    }
    scored.push({ t, score });
  }
  if (!scored.length) return { territory: null, ownerId: null, note: "No territory matches this country or region" };
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (top.length > 1) return { territory: null, ownerId: null, note: `Territories overlap (${top.map((s) => s.t.name).join(", ")}); assign manually` };
  const t = top[0]!.t;
  const owner = t.members.find((m) => m.isPrimary) ?? t.members[0];
  return { territory: t, ownerId: owner?.memberId ?? null, note: owner ? undefined : `Territory ${t.name} has no members` };
}

/** Two territories overlap when some country/region (and an industry-compatible slice) is claimed by both. */
export function overlappingTerritories(territories: TerritoryRule[]): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (let i = 0; i < territories.length; i++) {
    for (let j = i + 1; j < territories.length; j++) {
      const a = territories[i]!;
      const b = territories[j]!;
      const shared = [
        ...a.regions.filter((x) => b.regions.some((y) => norm(x) === norm(y))),
        ...a.countries.filter((x) => b.countries.some((y) => norm(x) === norm(y))),
      ];
      const industriesCompatible = !a.industries.length || !b.industries.length || a.industries.some((x) => b.industries.some((y) => norm(x) === norm(y)));
      if (shared.length && industriesCompatible) out.push([a.name, b.name, shared[0]!]);
    }
  }
  return out;
}
