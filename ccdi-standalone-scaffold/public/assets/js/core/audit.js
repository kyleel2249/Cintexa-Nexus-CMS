/**
 * CINTEXA CCDI — Audit logging
 * -----------------------------------------------------------------------
 * Append-only audit trail. Every sensitive action across every module
 * (asset changes, approvals, scan requests, status transitions, exports,
 * authorization changes) MUST call logAudit(). Entries are written client
 * side for immediacy but are re-validated and can also be written by
 * Cloud Functions for actions that happen server-side (scan result
 * ingestion, scheduled jobs). Firestore rules make `audit_log` append-only
 * (create allowed, update/delete denied for all roles) so the trail can't
 * be tampered with from the client.
 * -----------------------------------------------------------------------
 */

import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';
import { getTenantId } from './tenant.js';

export const AUDIT_ACTIONS = {
  ASSET_CREATED: 'asset.created',
  ASSET_UPDATED: 'asset.updated',
  ASSET_DELETED: 'asset.deleted',
  ASSET_VERIFIED: 'asset.verified',
  ASSET_IMPORTED: 'asset.bulk_imported',
  DISCOVERY_PASSIVE_RUN: 'discovery.passive.run',
  DISCOVERY_ACTIVE_REQUESTED: 'discovery.active.requested',
  DISCOVERY_ACTIVE_APPROVED: 'discovery.active.approved',
  DISCOVERY_ACTIVE_DENIED: 'discovery.active.denied',

  FINDING_CREATED: 'vuln.finding.created',
  FINDING_UPDATED: 'vuln.finding.updated',
  FINDING_STATUS_CHANGED: 'vuln.finding.status_changed',
  FINDING_DEDUPED: 'vuln.finding.deduped',
  FINDING_ASSIGNED: 'vuln.finding.assigned',
  REMEDIATION_UPDATED: 'vuln.remediation.updated',
  RISK_ACCEPTED: 'vuln.risk_accepted',

  CONNECTOR_REGISTERED: 'connector.registered',
  CONNECTOR_HEALTH_CHECKED: 'connector.health_checked',
  SCAN_REQUESTED: 'scan.requested',
  SCAN_APPROVED: 'scan.approved',
  SCAN_DENIED: 'scan.denied',
  SCAN_CANCELLED: 'scan.cancelled',
  SCAN_RESULT_IMPORTED: 'scan.result_imported',

  PENTEST_CREATED: 'pentest.engagement.created',
  PENTEST_AUTHORIZED: 'pentest.authorized',
  PENTEST_APPROVED: 'pentest.approved',
  PENTEST_STATUS_CHANGED: 'pentest.status_changed',
  PENTEST_FINDING_ADDED: 'pentest.finding_added',

  REPORT_GENERATED: 'report.generated',
  REPORT_EXPORTED: 'report.exported',

  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  ACCESS_DENIED: 'access.denied',
};

/**
 * @param {string} action - one of AUDIT_ACTIONS
 * @param {object} opts - { actorUid, actorEmail, targetType, targetId, summary, metadata }
 */
export async function logAudit(action, opts = {}) {
  const entry = {
    tenantId: safeTenantId(),
    action,
    actorUid: opts.actorUid || null,
    actorEmail: opts.actorEmail || null,
    targetType: opts.targetType || null,
    targetId: opts.targetId || null,
    summary: opts.summary || '',
    metadata: opts.metadata || {},
    ip: null, // populated server-side by Cloud Functions where applicable
    userAgent: navigator.userAgent,
    createdAt: serverTimestamp(),
    clientTimestamp: new Date().toISOString(),
  };
  try {
    await addDoc(collection(db, 'audit_log'), entry);
  } catch (err) {
    // Audit failures must never block the primary action, but must be
    // surfaced loudly to the console/monitoring so they aren't silently lost.
    console.error('[Audit] Failed to write audit entry', action, err);
  }
  return entry;
}

function safeTenantId() {
  try {
    return getTenantId();
  } catch {
    return null;
  }
}
