/**
 * Finding normalization & deduplication.
 * -----------------------------------------------------------------------
 * Heuristic client-side dedup check used when creating a finding (warns the
 * analyst before they create a duplicate) and when a scan result is
 * imported (functions/src/routes/scans.js runs the authoritative,
 * server-side version of the same logic on ingestion). Two findings are
 * considered the same underlying vulnerability when they share the same
 * affected asset AND either:
 *   - the same CVE identifier, or
 *   - the same vulnerability category + a near-identical title.
 * Individual source records and evidence are always preserved — dedup
 * only groups findings under a shared `dedupGroupId`, it never deletes one.
 * -----------------------------------------------------------------------
 */

export function normalizeTitle(title = '') {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function titleSimilarity(a, b) {
  const wa = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const wb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  wa.forEach((w) => { if (wb.has(w)) overlap += 1; });
  return overlap / Math.max(wa.size, wb.size);
}

/** Returns existing findings that are likely duplicates of `candidate`. */
export function findDuplicateCandidates(existingFindings, candidate) {
  return existingFindings.filter((f) => {
    if (f.affectedAsset !== candidate.affectedAsset) return false;
    if (candidate.cveId && f.cveId && candidate.cveId === f.cveId) return true;
    if (f.vulnerabilityCategory === candidate.vulnerabilityCategory
      && titleSimilarity(f.title, candidate.title) >= 0.6) return true;
    return false;
  });
}
