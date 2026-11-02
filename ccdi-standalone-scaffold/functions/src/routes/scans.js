const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('../lib/admin');
const { requireAuthContext } = require('../lib/rbac');
const { logAudit } = require('../lib/audit');

const HIGH_IMPACT_PROFILES = new Set(['standard', 'comprehensive']);

/**
 * Creates a pending_approval scan record. This is the ONLY way a scan
 * enters the system from the UI — there is no path from any frontend
 * component to actually invoking a scanner. Execution is an orchestration
 * concern that belongs to your own isolated worker infrastructure, which
 * would watch for status == 'approved' and report results back via
 * importScanResult(); CCDI intentionally implements only the request /
 * approval / ingestion boundary of that pipeline.
 */
const requestScan = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'scan.request');
  const { category, assetId, assetName, connectorId, connectorName, profileId, profileName, justification } = request.data || {};
  if (!category || !assetId || !connectorId || !profileId) {
    throw new HttpsError('invalid-argument', 'category, assetId, connectorId and profileId are required.');
  }

  const assetDoc = await db.collection('assets').doc(assetId).get();
  if (!assetDoc.exists || assetDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Asset not found.');
  const asset = assetDoc.data();
  if (asset.scopeStatus !== 'in_scope') {
    throw new HttpsError('permission-denied', 'This asset is not marked "in scope". An admin must set its scope status to in_scope before an assessment can be requested against it.');
  }

  const connectorDoc = await db.collection('connectors').doc(connectorId).get();
  if (!connectorDoc.exists || connectorDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Connector not found.');

  const ref = db.collection('scans').doc();
  await ref.set({
    tenantId: ctx.tenantId, category, assetId, assetName: assetName || asset.name,
    connectorId, connectorName: connectorName || connectorDoc.data().toolName,
    profileId, profileName: profileName || profileId,
    justification: justification || '',
    requiresElevatedApproval: HIGH_IMPACT_PROFILES.has(profileId),
    status: 'pending_approval',
    createdBy: ctx.email, requestedByUid: ctx.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await logAudit({ tenantId: ctx.tenantId, action: 'scan.requested', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'scan', targetId: ref.id, summary: `${category} scan requested for ${asset.name}` });
  return { scanId: ref.id };
});

const approveScan = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'scan.approve');
  const { scanId, decision, notes } = request.data || {};
  if (!scanId || !['approved', 'denied'].includes(decision)) throw new HttpsError('invalid-argument', 'scanId and a valid decision are required.');

  const ref = db.collection('scans').doc(scanId);
  const doc = await ref.get();
  if (!doc.exists || doc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Scan not found.');
  if (doc.data().status !== 'pending_approval') throw new HttpsError('failed-precondition', 'This scan has already been decided.');

  await ref.update({ status: decision, decisionNotes: notes || '', decidedByUid: ctx.uid, decidedByEmail: ctx.email, decidedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await logAudit({ tenantId: ctx.tenantId, action: `scan.${decision}`, actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'scan', targetId: scanId, summary: `Scan ${decision}` });
  return { ok: true };
});

const cancelScan = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'scan.cancel');
  const { scanId, reason } = request.data || {};
  const ref = db.collection('scans').doc(scanId);
  const doc = await ref.get();
  if (!doc.exists || doc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Scan not found.');
  if (['completed', 'cancelled', 'denied'].includes(doc.data().status)) throw new HttpsError('failed-precondition', 'This scan can no longer be cancelled.');

  await ref.update({ status: 'cancelled', cancelReason: reason || '', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await logAudit({ tenantId: ctx.tenantId, action: 'scan.cancelled', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'scan', targetId: scanId, summary: 'Scan cancelled', metadata: { reason } });
  return { ok: true };
});

/**
 * Normalizes a structured scan-result payload (produced by your own
 * authorized, externally-run scanner and pasted/uploaded by the operator)
 * into vulnerability_findings records. Performs deduplication against
 * existing findings on the same asset. CCDI never generates this payload
 * itself — it only validates and ingests what the operator provides.
 */
const importScanResult = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'scan.result_import');
  const { scanId, resultPayload } = request.data || {};
  if (!scanId || !resultPayload) throw new HttpsError('invalid-argument', 'scanId and resultPayload are required.');

  const scanRef = db.collection('scans').doc(scanId);
  const scanDoc = await scanRef.get();
  if (!scanDoc.exists || scanDoc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Scan not found.');
  const scan = scanDoc.data();
  if (!['approved', 'in_progress'].includes(scan.status)) {
    throw new HttpsError('failed-precondition', 'Results can only be imported for an approved/in-progress scan.');
  }

  const rawFindings = Array.isArray(resultPayload.findings) ? resultPayload.findings : [];
  if (!rawFindings.length) throw new HttpsError('invalid-argument', 'resultPayload.findings[] is empty.');

  const existingSnap = await db.collection('vulnerability_findings')
    .where('tenantId', '==', ctx.tenantId).where('affectedAsset', '==', scan.assetId).get();
  const existing = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  let createdCount = 0;
  let dedupedCount = 0;

  rawFindings.forEach((f) => {
    if (!f.title || !f.severity) return; // skip malformed entries rather than fabricate fields
    const dup = existing.find((e) => (f.cveId && e.cveId === f.cveId) || normalizeTitle(e.title) === normalizeTitle(f.title));
    if (dup) {
      const dupRef = db.collection('vulnerability_findings').doc(dup.id);
      batch.update(dupRef, { lastDetectedAt: new Date().toISOString(), status: dup.status === 'resolved' ? 'reopened' : dup.status, retestCount: admin.firestore.FieldValue.increment(0) });
      dedupedCount += 1;
      return;
    }
    const ref = db.collection('vulnerability_findings').doc();
    batch.set(ref, {
      tenantId: ctx.tenantId,
      title: f.title, description: f.description || '', technicalDetails: f.technicalDetails || '',
      affectedAsset: scan.assetId, affectedAssetName: scan.assetName, affectedEndpoint: f.endpoint || '',
      vulnerabilityCategory: f.category || 'other', cveId: f.cveId || null, cweId: f.cweId || null,
      cvssScore: f.cvssScore ?? null, cvssVersion: f.cvssVersion || '3.1',
      severity: normalizeSeverity(f.severity), confidence: f.confidence || 'firm',
      detectionSource: scan.connectorId || 'external_scanner', scanId,
      status: 'new', firstDetectedAt: new Date().toISOString(), lastDetectedAt: new Date().toISOString(),
      remediationGuidance: f.remediation || '',
      createdBy: ctx.uid, createdAt: now, updatedBy: ctx.uid, updatedAt: now,
    });
    createdCount += 1;
  });

  batch.update(scanRef, { status: 'completed', completedAt: now, updatedAt: now, resultSummary: { findingsCreated: createdCount, findingsDeduped: dedupedCount } });
  await batch.commit();

  await logAudit({ tenantId: ctx.tenantId, action: 'scan.result_imported', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'scan', targetId: scanId, summary: `Imported result: ${createdCount} new, ${dedupedCount} deduped`, metadata: { createdCount, dedupedCount } });
  return { findingsCreated: createdCount, findingsDeduped: dedupedCount };
});

function normalizeSeverity(s) {
  const v = String(s || '').toLowerCase();
  return ['critical', 'high', 'medium', 'low', 'informational'].includes(v) ? v : 'informational';
}
function normalizeTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = { requestScan, approveScan, cancelScan, importScanResult };
