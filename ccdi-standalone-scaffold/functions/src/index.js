/**
 * CINTEXA CCDI — Cloud Functions entry point
 * -----------------------------------------------------------------------
 * Each export name must match the callable name the client invokes via
 * httpsCallable(fns, 'name') in public/assets/js/core/api.js. Firebase
 * Functions v2 onCall() handlers already enforce Firebase Auth; the
 * RBAC + tenant checks on top of that live in lib/rbac.js and are applied
 * inside each route (requireAuthContext(request, 'permission.key')).
 * -----------------------------------------------------------------------
 */
const { setGlobalOptions } = require('firebase-functions/v2');

setGlobalOptions({ region: 'us-central1', maxInstances: 20, timeoutSeconds: 60 });

const tenants = require('./routes/tenants');
const users = require('./routes/users');
const assets = require('./routes/assets');
const discovery = require('./routes/discovery');
const vulnintel = require('./routes/vulnintel');
const connectors = require('./routes/connectors');
const scans = require('./routes/scans');
const pentest = require('./routes/pentest');
const reports = require('./routes/reports');

// ---- Tenancy / users ----
exports['tenants-bootstrap'] = tenants.bootstrapTenant;
exports['users-invite'] = users.inviteUser;
exports['users-updateRole'] = users.updateUserRole;

// ---- Asset discovery ----
exports['assets-importCsv'] = assets.importAssetsCsv;
exports['discovery-runPassive'] = discovery.runPassiveDiscovery;
exports['discovery-requestActive'] = discovery.requestActiveDiscovery;
exports['discovery-approveJob'] = discovery.approveDiscoveryJob;

// ---- Vulnerability intelligence ----
exports['vulnintel-lookupCve'] = vulnintel.lookupCve;
exports['vulnintel-checkKev'] = vulnintel.checkKev;
exports['vulnintel-sync'] = vulnintel.syncVulnIntel;

// ---- Connectors ----
exports['connectors-register'] = connectors.registerConnector;
exports['connectors-healthCheck'] = connectors.checkConnectorHealth;
exports['connectors-validateConfig'] = connectors.validateConnectorConfig;

// ---- Scans ----
exports['scans-request'] = scans.requestScan;
exports['scans-approve'] = scans.approveScan;
exports['scans-cancel'] = scans.cancelScan;
exports['scans-importResult'] = scans.importScanResult;

// ---- Penetration testing ----
exports['pentest-authorize'] = pentest.authorizeEngagement;
exports['pentest-approve'] = pentest.approveEngagement;
exports['pentest-cancel'] = pentest.cancelEngagement;

// ---- Reporting ----
exports['reports-generate'] = reports.generateReport;
