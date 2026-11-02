const dns = require('node:dns').promises;
const fetch = require('node-fetch');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('../lib/admin');
const { requireAuthContext } = require('../lib/rbac');
const { logAudit } = require('../lib/audit');

/**
 * PASSIVE DISCOVERY — read-only OSINT only.
 * Resolves public DNS records for the asset's hostname and queries the
 * public certificate-transparency log (crt.sh) for issued certificates.
 * Neither operation sends any traffic to the target itself beyond what a
 * normal DNS resolution requires, and crt.sh is queried about the domain,
 * not the target host. No port scanning, banner grabbing, or any other
 * interaction with the asset occurs here.
 */
const runPassiveDiscovery = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'discovery.passive.run');
  const { assetId } = request.data || {};
  if (!assetId) throw new HttpsError('invalid-argument', 'assetId is required.');

  const assetDoc = await db.collection('assets').doc(assetId).get();
  if (!assetDoc.exists || assetDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Asset not found.');
  const asset = assetDoc.data();
  const hostname = (asset.hostname || asset.name || '').trim();
  if (!hostname) throw new HttpsError('failed-precondition', 'Asset has no hostname/domain to resolve.');

  const result = { hostname, dns: {}, certificateTransparency: [], errors: [] };

  const recordTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'];
  await Promise.all(recordTypes.map(async (type) => {
    try {
      result.dns[type] = await dns.resolve(hostname, type);
    } catch (err) {
      result.dns[type] = [];
      if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') result.errors.push(`${type}: ${err.code || err.message}`);
    }
  }));

  try {
    const res = await fetch(`https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`, { timeout: 10000 });
    if (res.ok) {
      const data = await res.json();
      result.certificateTransparency = (Array.isArray(data) ? data : []).slice(0, 25).map((c) => ({
        issuer: c.issuer_name, commonName: c.common_name, notBefore: c.not_before, notAfter: c.not_after,
      }));
    } else {
      result.errors.push(`crt.sh returned HTTP ${res.status}`);
    }
  } catch (err) {
    result.errors.push(`Certificate transparency lookup failed: ${err.message}`);
  }

  await db.collection('attack_surface_observations').add({
    tenantId: ctx.tenantId, assetId, assetName: asset.name,
    observationType: 'passive_discovery', summary: `Passive discovery run (${recordTypes.filter((t) => result.dns[t]?.length).length} record types found)`,
    riskLevel: 'informational', createdBy: ctx.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await logAudit({ tenantId: ctx.tenantId, action: 'discovery.passive.run', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'asset', targetId: assetId, summary: `Passive discovery for ${hostname}` });
  return result;
});

/**
 * ACTIVE DISCOVERY — request only. This creates an approval-gated job
 * record; it performs NO network action against the target. Execution is
 * an explicit integration point for your own isolated worker
 * infrastructure (Phase 3 orchestration) to pick up once approved — wiring
 * an actual port/service scanner here is out of scope for this build; see
 * docs/ARCHITECTURE.md "Active discovery execution" for the documented
 * extension point and why it is intentionally left unimplemented.
 */
const requestActiveDiscovery = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'discovery.active.request');
  const { assetId, checks } = request.data || {};
  if (!assetId) throw new HttpsError('invalid-argument', 'assetId is required.');

  const assetDoc = await db.collection('assets').doc(assetId).get();
  if (!assetDoc.exists || assetDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Asset not found.');
  const asset = assetDoc.data();

  if (asset.scopeStatus === 'out_of_scope') {
    throw new HttpsError('permission-denied', 'This asset is explicitly out of scope and cannot be submitted for active discovery.');
  }

  const jobRef = db.collection('discovery_jobs').doc();
  await jobRef.set({
    tenantId: ctx.tenantId, assetId, assetName: asset.name,
    checks: Array.isArray(checks) ? checks : [],
    status: 'pending_approval',
    createdBy: ctx.email, requestedByUid: ctx.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await logAudit({ tenantId: ctx.tenantId, action: 'discovery.active.requested', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'discovery_job', targetId: jobRef.id, summary: `Active discovery requested for ${asset.name}` });
  return { jobId: jobRef.id };
});

const approveDiscoveryJob = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'discovery.active.approve');
  const { jobId, decision, notes } = request.data || {};
  if (!jobId || !['approved', 'denied'].includes(decision)) throw new HttpsError('invalid-argument', 'jobId and a valid decision are required.');

  const jobRef = db.collection('discovery_jobs').doc(jobId);
  const jobDoc = await jobRef.get();
  if (!jobDoc.exists || jobDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Discovery job not found.');
  if (jobDoc.data().status !== 'pending_approval') throw new HttpsError('failed-precondition', 'This job has already been decided.');

  await jobRef.update({
    status: decision,
    decisionNotes: notes || '',
    decidedByUid: ctx.uid,
    decidedByEmail: ctx.email,
    decidedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await logAudit({ tenantId: ctx.tenantId, action: `discovery.active.${decision}`, actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'discovery_job', targetId: jobId, summary: `Discovery job ${decision}` });
  return { ok: true };
});

module.exports = { runPassiveDiscovery, requestActiveDiscovery, approveDiscoveryJob };
