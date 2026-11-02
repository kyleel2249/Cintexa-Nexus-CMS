const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, auth, admin } = require('../lib/admin');
const { requireAuthContext } = require('../lib/rbac');
const { logAudit } = require('../lib/audit');

/**
 * Invites a user to the caller's tenant. For a full production deployment,
 * wire this to actually send an email (e.g. via a transactional email
 * provider) with a signup link carrying a one-time invite token stored in
 * `tenant_invites/{token}`. This implementation creates the invite record
 * and, if an account with that email already exists in Firebase Auth,
 * attaches them to the tenant immediately; otherwise the invite is
 * redeemed on their first sign-up (wire-up left for your email provider of
 * choice — documented in docs/DEPLOYMENT.md).
 */
const inviteUser = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'user.manage');
  const { email, role } = request.data || {};
  if (!email || !role) throw new HttpsError('invalid-argument', 'email and role are required.');
  if (role === 'owner') throw new HttpsError('invalid-argument', 'Cannot invite a user directly as Owner.');

  const inviteRef = db.collection('tenant_invites').doc();
  await inviteRef.set({
    tenantId: ctx.tenantId,
    email: email.toLowerCase().trim(),
    role,
    invitedByUid: ctx.uid,
    invitedByEmail: ctx.email,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // If the invitee already has a Firebase Auth account, attach them now.
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(existing.uid, { tenantId: ctx.tenantId, role });
    await db.collection('users').doc(existing.uid).set({
      uid: existing.uid, tenantId: ctx.tenantId, email, displayName: existing.displayName || email, role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await inviteRef.update({ status: 'accepted' });
  } catch (err) {
    if (err.code !== 'auth/user-not-found') console.error('[inviteUser] lookup failed', err);
    // else: invite stays pending until they sign up through your own
    // invite-redemption flow.
  }

  await logAudit({ tenantId: ctx.tenantId, action: 'user.invited', actorUid: ctx.uid, actorEmail: ctx.email, summary: `Invited ${email} as ${role}` });
  return { inviteId: inviteRef.id };
});

const updateUserRole = onCall(async (request) => {
  const ctx = requireAuthContext(request, 'user.manage');
  const { userId, role } = request.data || {};
  if (!userId || !role) throw new HttpsError('invalid-argument', 'userId and role are required.');
  if (role === 'owner') throw new HttpsError('invalid-argument', 'Ownership transfer is not supported via this action.');

  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists || userDoc.data().tenantId !== ctx.tenantId) {
    throw new HttpsError('not-found', 'User not found in this tenant.');
  }
  if (userDoc.data().role === 'owner') throw new HttpsError('permission-denied', 'Cannot change the Owner’s role.');

  await auth.setCustomUserClaims(userId, { tenantId: ctx.tenantId, role });
  await userDoc.ref.update({ role, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await logAudit({ tenantId: ctx.tenantId, action: 'user.role_updated', actorUid: ctx.uid, actorEmail: ctx.email, targetType: 'user', targetId: userId, summary: `Role changed to ${role}` });
  return { ok: true };
});

module.exports = { inviteUser, updateUserRole };
