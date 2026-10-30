/**
 * Documented confidence method (shown to users under "How is this scored?"). It is a transparent heuristic, NOT a probability.
 *   score = clamp( base(sourceType) x extractionReliability + corroboration + domainAdjustment - stalenessPenalty , 0, 0.99 )
 *   base:            structured data (JSON-LD) 0.85 | official page text/link 0.70 | search-result snippet 0.40 | derived/classified 0.35
 *   corroboration:   +0.075 for each extra independent page that agrees (max +0.15)
 *   domainAdjust:    +0.05 when the value's own domain matches the company website, -0.10 when it does not
 *   stalenessPenalty: 0.02 per 30 days since retrieval (max 0.20)
 * Verification label: verified (official-domain contact data found in a mailto:/tel:/structured field) | corroborated (>=2 pages agree)
 *                     | single_source | unverified (derived or search-only) | conflicting (sources disagree)
 */
export type SourceType = "structured_data" | "official_page" | "search_snippet" | "derived";
export interface ConfidenceInput { sourceType: SourceType; pagesAgreeing: number; domainMatchesSite: boolean | null; ageDays?: number; extractionReliability?: number; conflicting?: boolean; contactLink?: boolean }
export type Verification = "verified" | "corroborated" | "single_source" | "unverified" | "conflicting";
const BASE: Record<SourceType, number> = { structured_data: 0.85, official_page: 0.7, search_snippet: 0.4, derived: 0.35 };

export function scoreConfidence(i: ConfidenceInput): { score: number; verification: Verification; basis: Record<string, unknown> } {
  const rel = i.extractionReliability ?? 1;
  const corroboration = Math.min(0.15, Math.max(0, i.pagesAgreeing - 1) * 0.075);
  const domainAdj = i.domainMatchesSite === null ? 0 : i.domainMatchesSite ? 0.05 : -0.1;
  const stale = Math.min(0.2, Math.floor((i.ageDays ?? 0) / 30) * 0.02);
  const raw = BASE[i.sourceType] * rel + corroboration + domainAdj - stale - (i.conflicting ? 0.2 : 0);
  const score = Math.round(Math.min(0.99, Math.max(0, raw)) * 1000) / 1000;
  let verification: Verification;
  if (i.conflicting) verification = "conflicting";
  else if (i.sourceType === "derived" || i.sourceType === "search_snippet") verification = "unverified";
  else if ((i.sourceType === "structured_data" || i.contactLink) && i.domainMatchesSite !== false) verification = "verified";
  else if (i.pagesAgreeing >= 2) verification = "corroborated";
  else verification = "single_source";
  return { score, verification, basis: { method: "cintexa-confidence-v1", base: BASE[i.sourceType], extractionReliability: rel, corroboration, domainAdjustment: domainAdj, stalenessPenalty: stale, sourceType: i.sourceType, pagesAgreeing: i.pagesAgreeing } };
}
export const bandOf = (score: number) => (score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low");
