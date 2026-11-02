const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, auth, admin } = require('../lib/admin');
const { logAudit } = require('../lib/audit');

/**
 * Bootstraps a brand-new tenant immediately after the owner's Firebase Auth
 * account is created on the client (login.html -> registerOwner()). This is
 * the ONLY path that creates a tenant with the "owner" role, and it is
 * server-validated: the caller must be signed in as the uid they claim to
 * be the owner of, and a Firebase Auth user cannot bootstrap more than one
 * tenant as owner.
 */
const bootstrapTenant = onCall(async (request) => {
  const auth_ = request.auth;
  if (!auth_) throw new HttpsError('unauthenticated', 'Sign-in required.');

  const { orgName, ownerUid, ownerEmail, ownerDisplayName } = request.data || {};
  if (auth_.uid !== ownerUid) throw new HttpsError('permission-denied', 'You may only bootstrap a tenant for your own account.');
  if (!orgName || !orgName.trim()) throw new HttpsError('invalid-argument', 'Organization name is required.');

  const existingUserDoc = await db.collection('users').doc(ownerUid).get();
  if (existingUserDoc.exists) throw new HttpsError('already-exists', 'This account already belongs to a tenant.');

  const tenantRef = db.collection('tenants').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    tx.set(tenantRef, {
      name: orgName.trim(),
      plan: 'standard',
      ownerUid,
      createdAt: now,
      updatedAt: now,
    });
    tx.set(db.collection('users').doc(ownerUid), {
      uid: ownerUid,
      tenantId: tenantRef.id,
      email: ownerEmail,
      displayName: ownerDisplayName || ownerEmail,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    });
  });

  // Custom claims are what Firestore rules + callable functions actually
  // trust for authorization; the Firestore `users/{uid}` doc mirrors them
  // for fast client reads only.
  await auth.setCustomUserClaims(ownerUid, { tenantId: tenantRef.id, role: 'owner' });

  await logAudit({
    tenantId: tenantRef.id, action: 'tenant.bootstrapped', actorUid: ownerUid, actorEmail: ownerEmail,
    targetType: 'tenant', targetId: tenantRef.id, summary: `Tenant "${orgName}" created`,
  });

  return { tenantId: tenantRef.id };
});

module.exports = { bootstrapTenant };
