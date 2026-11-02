const fetch = require('node-fetch');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('../lib/admin');
const { requireAuthContext } = require('../lib/rbac');
const { logAudit } = require('../lib/audit');

const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const KEV_FEED = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — public intel doesn't need to be refetched every call

let kevCache = { fetchedAt: 0, ids: new Set() };

async function getKevSet() {
  if (Date.now() - kevCache.fetchedAt < CACHE_TTL_MS && kevCache.ids.size) return kevCache.ids;
  const res = await fetch(KEV_FEED, { timeout: 15000 });
  if (!res.ok) throw new Error(`CISA KEV feed returned HTTP ${res.status}`);
  const data = await res.json();
  const ids = new Set((data.vulnerabilities || []).map((v) => v.cveID));
  kevCache = { fetchedAt: Date.now(), ids };
  return ids;
}

/** Read-through cache in Firestore (`cve_cache`) so repeated lookups across
 * the tenant don't hammer NVD's rate-limited public API. */
async function fetchNvd(cveId) {
  const cacheRef = db.collection('cve_cache').doc(cveId);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const data = cached.data();
    if (Date.now() - (data.fetchedAtMs || 0) < CACHE_TTL_MS) return data.payload;
  }
  const res = await fetch(`${NVD_API}?cveId=${encodeURIComponent(cveId)}`, { timeout: 15000, headers: { 'User-Agent': 'CINTEXA-CCDI/4.0' } });
  if (!res.ok) throw new Error(`NVD API returned HTTP ${res.status}`);
  const data = await res.json();
  const vuln = (data.vulnerabilities || [])[0]?.cve;
  if (!vuln) throw new Error(`CVE ${cveId} not found in NVD.`);
  const payload = {
    cveId,
    description: vuln.descriptions?.find((d) => d.lang === 'en')?.value || '',
    cvssV31: vuln.metrics?.cvssMetricV31?.[0]?.cvssData || null,
    cvssV30: vuln.metrics?.cvssMetricV30?.[0]?.cvssData || null,
    cvssV2: vuln.metrics?.cvssMetricV2?.[0]?.cvssData || null,
    published: vuln.published,
    lastModified: vuln.lastModified,
    references: (vuln.references || []).map((r) => r.url).slice(0, 10),
  };
  await cacheRef.set({ payload, fetchedAtMs: Date.now(), source: 'nvd' });
  return payload;
}

const lookupCve = onCall(async (request) => {
  const ctx = requireAuthContext(request);
  const { cveId } = request.data || {};
  if (!cveId || !/^CVE-\d{4}-\d{4,}$/i.test(cveId)) throw new HttpsError('invalid-argument', 'A valid CVE ID is required (e.g. CVE-2024-12345).');
  try {
    return await fetchNvd(cveId.toUpperCase());
  } catch (err) {
    // Explicitly surface the failure rather than fabricating data when NVD
    // is unavailable or the CVE does not exist.
    throw new HttpsError('unavailable', err.message);
  }
});

const checkKev = onCall(async (request) => {
  requireAuthContext(request);
  const { cveId } = request.data || {};
  if (!cveId) throw new HttpsError('invalid-argument', 'cveId is required.');
  try {
    const ids = await getKevSet();
    return { cveId: cveId.toUpperCase(), kevListed: ids.has(cveId.toUpperCase()) };
  } catch (err) {
    throw new HttpsError('unavailable', `CISA KEV feed unavailable: ${err.message}`);
  }
});

/** Enriches a finding doc in place with NVD + KEV data, and caches results. */
const syncVulnIntel = onCall(async (request) => {
  const ctx = requireAuthContext(request); // any authenticated tenant member may enrich a finding they can already read
  const { findingId } = request.data || {};
  if (!findingId) throw new HttpsError('invalid-argument', 'findingId is required.');

  const findingRef = db.collection('vulnerability_findings').doc(findingId);
  const findingDoc = await findingRef.get();
  if (!findingDoc.exists || findingDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Finding not found.');
  const finding = findingDoc.data();
  if (!finding.cveId) throw new HttpsError('failed-precondition', 'This finding has no CVE identifier to sync.');

  const update = { nvdSyncedAt: admin.firestore.FieldValue.serverTimestamp() };
  let nvdDescription = '';
  let kevListed = false;

  try {
    const nvd = await fetchNvd(finding.cveId);
    nvdDescription = nvd.description;
    const cvss = nvd.cvssV31 || nvd.cvssV30 || nvd.cvssV2;
    if (cvss) { update.cvssScore = cvss.baseScore; update.cvssVersion = cvss.version; }
    update.nvdDescription = nvd.description;
    update.nvdReferences = nvd.references;
  } catch (err) {
    update.nvdSyncError = err.message;
  }

  try {
    const ids = await getKevSet();
    kevListed = ids.has(finding.cveId.toUpperCase());
    update.kevListed = kevListed;
  } catch (err) {
    update.kevSyncError = err.message;
  }

  await findingRef.update(update);
  await logAudit({ tenantId: ctx.tenantId, action: 'vuln.intel_synced', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'finding', targetId: findingId, summary: `Synced intel for ${finding.cveId}` });

  return { kevListed, nvdDescription };
});

module.exports = { lookupCve, checkKev, syncVulnIntel };
