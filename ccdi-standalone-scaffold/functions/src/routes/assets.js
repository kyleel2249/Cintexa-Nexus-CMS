const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('../lib/admin');
const { requireAuthContext } = require('../lib/rbac');
const { logAudit } = require('../lib/audit');

const ASSET_TYPES = new Set(['domain', 'subdomain', 'website', 'ip_address', 'ip_range', 'hostname', 'network_service', 'application', 'api']);

/**
 * Server-side CSV-row importer. The primary import path is the client's
 * direct batched Firestore write (public/assets/js/modules/assets/assets.js),
 * which Firestore rules fully validate for tenant scoping and field shape.
 * This callable is provided as an alternate, auditable server-side path for
 * programmatic/API-driven imports (e.g. a CI pipeline pushing a CSV).
 */
const importAssetsCsv = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'asset.bulk_import');
  const { rows } = request.data || {};
  if (!Array.isArray(rows) || !rows.length) throw new HttpsError('invalid-argument', 'rows[] is required.');
  if (rows.length > 2000) throw new HttpsError('invalid-argument', 'Maximum 2000 rows per import.');

  const batch = db.batch();
  let created = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();

  rows.forEach((row) => {
    if (!row.name || !String(row.name).trim()) return;
    const ref = db.collection('assets').doc();
    batch.set(ref, {
      name: String(row.name).trim(),
      assetType: ASSET_TYPES.has(row.assetType) ? row.assetType : 'hostname',
      ownerEmail: row.ownerEmail || '',
      environment: row.environment || 'production',
      businessCriticality: row.businessCriticality || 'medium',
      tags: Array.isArray(row.tags) ? row.tags : String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      description: row.description || '',
      lifecycleStatus: 'discovered',
      scopeStatus: 'pending_review',
      tenantId: ctx.tenantId,
      createdBy: ctx.uid,
      createdAt: now,
      updatedBy: ctx.uid,
      updatedAt: now,
    });
    created += 1;
  });

  await batch.commit();
  await logAudit({ tenantId: ctx.tenantId, action: 'asset.bulk_imported', actorUid: ctx.uid, actorEmail: ctx.email, summary: `Imported ${created} assets via API`, metadata: { count: created } });
  return { created };
});

module.exports = { importAssetsCsv };
