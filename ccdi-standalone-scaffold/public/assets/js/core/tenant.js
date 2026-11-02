/**
 * CINTEXA CCDI — Tenant context
 * -----------------------------------------------------------------------
 * Every document in Firestore carries a `tenantId` field. This module
 * holds the active tenant for the session and provides helpers that every
 * module MUST use when building queries/writes, so tenant scoping is
 * applied consistently instead of being re-implemented per module.
 *
 * Server-side enforcement: firestore/firestore.rules independently checks
 * `resource.data.tenantId == request.auth.token.tenantId` on every
 * read/write. This client helper prevents accidental cross-tenant queries
 * and keeps UI code simple; it is not itself the trust boundary.
 * -----------------------------------------------------------------------
 */

import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';

let activeTenant = null; // { id, name, plan, createdAt }

export function setActiveTenant(tenant) {
  activeTenant = tenant;
}

export function getActiveTenant() {
  return activeTenant;
}

export function getTenantId() {
  if (!activeTenant) throw new Error('[Tenant] No active tenant set — user must belong to a tenant.');
  return activeTenant.id;
}

export async function loadTenant(tenantId) {
  const snap = await getDoc(doc(db, 'tenants', tenantId));
  if (!snap.exists()) throw new Error(`Tenant ${tenantId} not found`);
  const tenant = { id: snap.id, ...snap.data() };
  setActiveTenant(tenant);
  return tenant;
}

/** Stamp a new-document payload with tenant + audit metadata. */
export function stampCreate(payload, uid) {
  const now = new Date().toISOString();
  return {
    ...payload,
    tenantId: getTenantId(),
    createdBy: uid,
    createdAt: now,
    updatedBy: uid,
    updatedAt: now,
  };
}

/** Stamp an update payload with audit metadata (tenantId is never mutated). */
export function stampUpdate(payload, uid) {
  const { tenantId, createdBy, createdAt, ...rest } = payload;
  return { ...rest, updatedBy: uid, updatedAt: new Date().toISOString() };
}
