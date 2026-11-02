/**
 * CINTEXA CCDI — Backend API client
 * -----------------------------------------------------------------------
 * Thin wrapper around Firebase Callable Functions (functions/src/routes/*).
 * All server-authoritative operations — anything that must enforce the
 * USER → AUTH → RBAC → TENANT → SCOPE → POLICY → APPROVAL → ORCHESTRATION
 * lifecycle, call out to NVD/CISA KEV, generate reports, or import scan
 * results — go through here rather than direct Firestore writes from the
 * client, so a single server-side checkpoint can't be bypassed by a
 * modified client.
 *
 * Direct Firestore reads/writes (via core/data.js) remain appropriate for
 * simple tenant-scoped CRUD that Firestore rules already fully guard
 * (e.g. editing an asset's description) — see docs/ARCHITECTURE.md for the
 * rule of thumb on which path to use.
 * -----------------------------------------------------------------------
 */

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { fns } from './firebase-config.js';

class ApiError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function call(name, payload = {}) {
  try {
    const fn = httpsCallable(fns, name);
    const res = await fn(payload);
    return res.data;
  } catch (err) {
    console.error(`[API] ${name} failed`, err);
    throw new ApiError(err.message || 'Request failed', err.code || 'internal', err.details);
  }
}

export const api = {
  // ---- Tenancy / users ----
  bootstrapTenant: (payload) => call('tenants-bootstrap', payload),
  inviteUser: (payload) => call('users-invite', payload),
  updateUserRole: (payload) => call('users-updateRole', payload),

  // ---- Asset discovery ----
  importAssetsCsv: (payload) => call('assets-importCsv', payload), // { csvText }
  runPassiveDiscovery: (payload) => call('discovery-runPassive', payload), // { assetId } -> DNS/cert-transparency (read-only OSINT)
  requestActiveDiscovery: (payload) => call('discovery-requestActive', payload), // { assetId, checks[] } -> creates approval-gated job
  approveDiscoveryJob: (payload) => call('discovery-approveJob', payload), // { jobId, decision, notes }

  // ---- Vulnerability intelligence (read-only external lookups) ----
  lookupCve: (payload) => call('vulnintel-lookupCve', payload), // { cveId } -> NVD
  checkKev: (payload) => call('vulnintel-checkKev', payload), // { cveId } -> CISA KEV
  syncVulnIntel: (payload) => call('vulnintel-sync', payload), // { findingId } -> enrich from NVD+KEV with caching

  // ---- Connectors (framework only — see functions/src/routes/connectors.js) ----
  registerConnector: (payload) => call('connectors-register', payload),
  checkConnectorHealth: (payload) => call('connectors-healthCheck', payload), // { connectorId }
  validateConnectorConfig: (payload) => call('connectors-validateConfig', payload),

  // ---- Scan / assessment lifecycle (approval-gated; execution is external) ----
  requestScan: (payload) => call('scans-request', payload), // { assetId, connectorId, profileId, justification }
  approveScan: (payload) => call('scans-approve', payload), // { scanId, decision, notes }
  cancelScan: (payload) => call('scans-cancel', payload), // { scanId, reason }
  importScanResult: (payload) => call('scans-importResult', payload), // { scanId, resultPayload } -> normalizes findings

  // ---- Pentest engagements ----
  createEngagement: (payload) => call('pentest-create', payload),
  authorizeEngagement: (payload) => call('pentest-authorize', payload), // requires OWNER
  approveEngagement: (payload) => call('pentest-approve', payload),
  cancelEngagement: (payload) => call('pentest-cancel', payload),

  // ---- Reporting ----
  generateReport: (payload) => call('reports-generate', payload), // { type, scope, format }
};

export { ApiError };
