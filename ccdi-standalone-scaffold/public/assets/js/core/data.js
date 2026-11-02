/**
 * CINTEXA CCDI — Tenant-scoped Firestore data layer
 * -----------------------------------------------------------------------
 * Generic CRUD helpers used by every module. Every query/write is
 * automatically scoped to the active tenant via core/tenant.js so module
 * code never has to remember to add a tenantId filter. Firestore rules
 * independently enforce the same scoping server-side — see
 * firestore/firestore.rules.
 * -----------------------------------------------------------------------
 */

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit as fsLimit, startAfter, onSnapshot,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';
import { getTenantId, stampCreate, stampUpdate } from './tenant.js';
import { CURRENT } from './auth.js';

export const COLLECTIONS = {
  ASSETS: 'assets',
  ASSET_RELATIONSHIPS: 'asset_relationships',
  ASSET_HISTORY: 'asset_history',
  DISCOVERY_JOBS: 'discovery_jobs',
  ATTACK_SURFACE: 'attack_surface_observations',
  FINDINGS: 'vulnerability_findings',
  FINDING_EVIDENCE: 'finding_evidence',
  CVE_CACHE: 'cve_cache',
  CONNECTORS: 'connectors',
  SCAN_PROFILES: 'scan_profiles',
  SCANS: 'scans',
  API_INVENTORY: 'api_inventory',
  API_ENDPOINTS: 'api_endpoints',
  NETWORK_SERVICES: 'network_services',
  PENTEST_ENGAGEMENTS: 'pentest_engagements',
  PENTEST_AUTHORIZATIONS: 'pentest_authorizations',
  PENTEST_NOTES: 'pentest_notes',
  REMEDIATION_TASKS: 'remediation_tasks',
  RETEST_RECORDS: 'retest_records',
  REPORTS: 'reports',
  AUDIT_LOG: 'audit_log',
  USERS: 'users',
  TENANTS: 'tenants',
};

function col(name) {
  return collection(db, name);
}

/** List docs in a collection, tenant-scoped, with optional filters/sort/pagination. */
export async function listDocs(collectionName, {
  filters = [], // [['field','==',value], ...]
  sortBy = 'createdAt', sortDir = 'desc',
  pageSize = 50, cursor = null,
} = {}) {
  const clauses = [where('tenantId', '==', getTenantId())];
  filters.forEach(([field, op, value]) => clauses.push(where(field, op, value)));
  let q = query(col(collectionName), ...clauses, orderBy(sortBy, sortDir), fsLimit(pageSize));
  if (cursor) q = query(col(collectionName), ...clauses, orderBy(sortBy, sortDir), startAfter(cursor), fsLimit(pageSize));
  const snap = await getDocs(q);
  return {
    docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    lastDoc: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === pageSize,
  };
}

export function subscribeDocs(collectionName, { filters = [], sortBy = 'createdAt', sortDir = 'desc', pageSize = 200 } = {}, onChange) {
  const clauses = [where('tenantId', '==', getTenantId())];
  filters.forEach(([field, op, value]) => clauses.push(where(field, op, value)));
  const q = query(col(collectionName), ...clauses, orderBy(sortBy, sortDir), fsLimit(pageSize));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error(`[Data] subscribe(${collectionName}) failed`, err));
}

export async function getDocById(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  if (data.tenantId && data.tenantId !== getTenantId()) {
    throw new Error('Cross-tenant access denied');
  }
  return data;
}

export async function createDoc(collectionName, payload) {
  const uid = CURRENT.user?.uid || null;
  const ref = await addDoc(col(collectionName), stampCreate(payload, uid));
  return ref.id;
}

export async function updateDocById(collectionName, id, payload) {
  const uid = CURRENT.user?.uid || null;
  await updateDoc(doc(db, collectionName, id), stampUpdate(payload, uid));
}

export async function deleteDocById(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
}

export async function batchCreate(collectionName, payloads) {
  const uid = CURRENT.user?.uid || null;
  const batch = writeBatch(db);
  const ids = [];
  payloads.forEach((payload) => {
    const ref = doc(col(collectionName));
    batch.set(ref, stampCreate(payload, uid));
    ids.push(ref.id);
  });
  await batch.commit();
  return ids;
}

/** Append an immutable history entry (used for asset history, retest history, etc). */
export async function appendHistory(collectionName, parentId, entry) {
  const uid = CURRENT.user?.uid || null;
  await addDoc(col(collectionName), stampCreate({ parentId, ...entry }, uid));
}

export { serverTimestamp };
