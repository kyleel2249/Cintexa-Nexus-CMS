/**
 * Server-side RBAC — the authoritative copy. Must stay in sync with
 * public/assets/js/core/rbac.js (client copy is UX-only).
 */
const { HttpsError } = require('firebase-functions/v2/https');

const ROLE_RANK = { owner: 5, admin: 4, analyst: 3, tester: 2, viewer: 1 };

const PERMISSIONS = {
  'asset.bulk_import': 'analyst',
  'discovery.passive.run': 'analyst',
  'discovery.active.request': 'analyst',
  'discovery.active.approve': 'admin',
  'connector.manage': 'admin',
  'scan.request': 'analyst',
  'scan.approve': 'admin',
  'scan.cancel': 'admin',
  'scan.result_import': 'tester',
  'pentest.create': 'analyst',
  'pentest.authorize': 'owner',
  'pentest.approve': 'admin',
  'pentest.cancel': 'admin',
  'report.generate': 'viewer',
  'user.manage': 'owner',
  'tenant.manage': 'owner',
};

/**
 * Verifies the caller is authenticated, belongs to a tenant, and (if given)
 * holds at least the role required for `permission`. Returns
 * { uid, email, tenantId, role } for convenience. Throws HttpsError on any
 * failure — callers should let this propagate so the client sees a clean
 * permission-denied/unauthenticated error.
 */
function requireAuthContext(request, permission = null) {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign-in required.');
  const token = auth.token || {};
  const tenantId = token.tenantId;
  const role = token.role;
  if (!tenantId || !role) {
    throw new HttpsError('failed-precondition', 'Account is not yet provisioned with a tenant and role.');
  }
  if (permission) {
    const required = PERMISSIONS[permission];
    if (!required) throw new HttpsError('internal', `Unknown permission "${permission}"`);
    if ((ROLE_RANK[role] || 0) < (ROLE_RANK[required] || 99)) {
      throw new HttpsError('permission-denied', `This action requires the "${required}" role or higher.`);
    }
  }
  return { uid: auth.uid, email: token.email || null, tenantId, role };
}

module.exports = { requireAuthContext, ROLE_RANK, PERMISSIONS };
