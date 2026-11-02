/**
 * CINTEXA CCDI — Authentication
 * -----------------------------------------------------------------------
 * Wraps Firebase Auth (email/password + optional SSO providers) and loads
 * the authenticated user's tenant membership + role from Firestore
 * (`users/{uid}`). The user's role is set via Firebase custom claims by
 * functions/src/routes/users.js (invite/accept flow) and mirrored into
 * Firestore for fast client reads; Firestore rules trust the custom claim
 * on request.auth.token, not the mirrored field, for authorization.
 * -----------------------------------------------------------------------
 */

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db } from './firebase-config.js';
import { setCurrentRole } from './rbac.js';
import { loadTenant } from './tenant.js';
import { logAudit, AUDIT_ACTIONS } from './audit.js';

export const CURRENT = {
  user: null, // Firebase Auth user
  profile: null, // users/{uid} Firestore doc: { role, tenantId, displayName, ... }
  ready: false,
};

const readyListeners = [];

export function onAuthReady(cb) {
  if (CURRENT.ready) cb(CURRENT);
  else readyListeners.push(cb);
}

onAuthStateChanged(auth, async (user) => {
  CURRENT.user = user;
  if (!user) {
    CURRENT.profile = null;
    setCurrentRole(null);
    CURRENT.ready = true;
    readyListeners.splice(0).forEach((cb) => cb(CURRENT));
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) {
      // Account exists in Firebase Auth but has no tenant/profile record yet
      // (e.g. mid-signup, or deprovisioned). Treat as unauthenticated for
      // app purposes rather than granting a default role.
      CURRENT.profile = null;
      setCurrentRole(null);
    } else {
      const profile = { uid: user.uid, ...snap.data() };
      CURRENT.profile = profile;
      setCurrentRole(profile.role || null);
      if (profile.tenantId) {
        await loadTenant(profile.tenantId);
      }
    }
  } catch (err) {
    console.error('[Auth] Failed to load user profile', err);
    CURRENT.profile = null;
    setCurrentRole(null);
  }

  CURRENT.ready = true;
  readyListeners.splice(0).forEach((cb) => cb(CURRENT));
});

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await logAudit(AUDIT_ACTIONS.USER_LOGIN, {
    actorUid: cred.user.uid,
    actorEmail: cred.user.email,
    summary: 'User signed in',
  });
  return cred.user;
}

export async function registerOwner(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  return cred.user; // tenant + users/{uid} doc provisioning happens via
  // functions/src/routes/tenants.js `POST /tenants/bootstrap` called right
  // after this from the signup UI, so tenant creation is server-validated.
}

export async function logout() {
  const uid = CURRENT.user?.uid;
  const email = CURRENT.user?.email;
  await fbSignOut(auth);
  if (uid) {
    await logAudit(AUDIT_ACTIONS.USER_LOGOUT, { actorUid: uid, actorEmail: email, summary: 'User signed out' });
  }
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function requireAuth(redirectTo = 'login.html') {
  onAuthReady(({ user, profile }) => {
    if (!user || !profile) {
      window.location.href = redirectTo;
    }
  });
}
