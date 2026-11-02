const fetch = require('node-fetch');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, admin } = require('../lib/admin');
const { requireAuthContext } = require('../lib/rbac');
const { logAudit } = require('../lib/audit');

/**
 * Connector registration is purely a REGISTRY action: it records that an
 * externally-installed, separately-licensed scanner exists at a given
 * endpoint with a referenced credential. It never installs, configures, or
 * invokes the tool itself.
 */
const registerConnector = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'connector.manage');
  const { toolId, toolName, category, endpoint, credentialRef, notes } = request.data || {};
  if (!toolId || !toolName || !category) throw new HttpsError('invalid-argument', 'toolId, toolName and category are required.');

  const ref = db.collection('connectors').doc();
  await ref.set({
    tenantId: ctx.tenantId, toolId, toolName, category, endpoint: endpoint || '', credentialRef: credentialRef || '', notes: notes || '',
    status: endpoint ? 'configured' : 'not_configured',
    toolVersion: null, lastHealthCheckAt: null,
    createdBy: ctx.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await logAudit({ tenantId: ctx.tenantId, action: 'connector.registered', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'connector', targetId: ref.id, summary: `Registered ${toolName}` });
  return { connectorId: ref.id };
});

/**
 * Health check verifies that the CONFIGURED ENDPOINT is reachable (an HTTP
 * reachability probe against the operator-provided endpoint URL, with a
 * strict timeout and no payload) — it does not run the scanner, does not
 * authenticate with the real credential (that stays in your secret
 * manager, referenced only), and never touches a scan target. This is a
 * connectivity/configuration check only, distinct from "tool installed",
 * "credentials provided" or "assessment successfully executed", which your
 * own worker infrastructure must report back as it integrates each tool.
 */
const checkConnectorHealth = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'connector.manage');
  const { connectorId } = request.data || {};
  if (!connectorId) throw new HttpsError('invalid-argument', 'connectorId is required.');

  const ref = db.collection('connectors').doc(connectorId);
  const doc = await ref.get();
  if (!doc.exists || doc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Connector not found.');
  const connector = doc.data();

  let status = 'unreachable';
  if (!connector.endpoint) {
    status = 'not_configured';
  } else {
    try {
      const res = await fetch(connector.endpoint, { method: 'GET', timeout: 6000 });
      status = res.status < 500 ? 'healthy' : 'error';
    } catch (err) {
      status = 'unreachable';
    }
  }

  await ref.update({ status, lastHealthCheckAt: admin.firestore.FieldValue.serverTimestamp() });
  await logAudit({ tenantId: ctx.tenantId, action: 'connector.health_checked', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'connector', targetId: connectorId, summary: `Health check result: ${status}` });
  return { status };
});

const validateConnectorConfig = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'connector.manage');
  const { connectorId } = request.data || {};
  const doc = await db.collection('connectors').doc(connectorId).get();
  if (!doc.exists || doc.data().tenantId !== ctx.tenantId) throw new HttpsError('not-found', 'Connector not found.');
  const connector = doc.data();
  const issues = [];
  if (!connector.endpoint) issues.push('No endpoint configured.');
  if (!connector.credentialRef) issues.push('No credential reference configured.');
  return { valid: issues.length === 0, issues };
});

module.exports = { registerConnector, checkConnectorHealth, validateConnectorConfig };
