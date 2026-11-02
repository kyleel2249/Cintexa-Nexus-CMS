import { renderShell } from '../../core/layout.js';
import { listDocs, createDoc, COLLECTIONS } from '../../core/data.js';
import {
  toast, openDrawer, openModal, emptyState, loadingState, errorState,
  fmtDateTime, relativeTime, escapeHtml, humanize, statusBadge,
} from '../../core/ui.js';
import { can } from '../../core/rbac.js';
import { logAudit, AUDIT_ACTIONS } from '../../core/audit.js';
import { CURRENT } from '../../core/auth.js';
import { api } from '../../core/api.js';
import { CONNECTOR_CATALOG, CONNECTOR_STATUS_BADGE, SCAN_STATUS_BADGE } from './constants.js';

renderShell({
  active: 'connectors',
  title: 'Security Engine Connectors',
  subtitle: 'Registry and health status for external scanner integrations used by Website, Network and API security assessments',
});

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  detail.contentEl.innerHTML = `
    <div class="lock-note" style="margin-bottom:18px">
      <svg viewBox="0 0 20 20" fill="none"><path d="M5 9V6a5 5 0 0110 0v3m-11 0h12v8H4V9z" stroke="currentColor" stroke-width="1.4"/></svg>
      CCDI does not bundle or execute scanner binaries. Each connector below represents a registration of a separately installed, separately licensed tool that your own infrastructure runs under your authorization. The orchestration engine (never the UI) is the single trusted gateway that would invoke it, and all scan requests pass through the approval pipeline below.
    </div>
    <div class="toolbar">
      <h3 style="font-size:14.5px">Registered connectors</h3>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="btn-register" data-requires="connector.manage">+ Register connector</button>
    </div>
    <div class="card" style="margin-bottom:24px"><div class="table-wrap" id="connector-table"></div></div>

    <div class="toolbar"><h3 style="font-size:14.5px">Scan requests &amp; approvals</h3></div>
    <div class="card"><div class="table-wrap" id="scan-table"></div></div>`;

  document.getElementById('btn-register').addEventListener('click', openRegisterModal);
  await loadConnectors();
  await loadScans();
});

async function loadConnectors() {
  const wrap = document.getElementById('connector-table');
  loadingState(wrap, 'Loading connectors…');
  try {
    const { docs } = await listDocs(COLLECTIONS.CONNECTORS, { pageSize: 200 });
    if (!docs.length) {
      emptyState(wrap, {
        title: 'No connectors registered',
        message: 'Register an external scanner (ZAP, Nuclei, Nikto, testssl.sh, Burp, Nmap, OpenVAS, Schemathesis, etc.) to enable scan requests for Website, Network and API security assessments.',
        actionHtml: can('connector.manage') ? '<button class="btn btn-primary btn-sm" id="empty-register">Register connector</button>' : '',
      });
      document.getElementById('empty-register')?.addEventListener('click', openRegisterModal);
      return;
    }
    wrap.innerHTML = `<table class="data-table"><thead><tr>
        <th>Connector</th><th>Category</th><th>Status</th><th>Version</th><th>Last checked</th><th></th>
      </tr></thead><tbody>
      ${docs.map((c) => `
        <tr>
          <td><strong>${escapeHtml(c.toolName)}</strong></td>
          <td class="cell-muted">${humanize(c.category)}</td>
          <td>${statusBadge(c.status || 'not_configured', CONNECTOR_STATUS_BADGE)}</td>
          <td class="cell-muted">${escapeHtml(c.toolVersion || 'Unknown')}</td>
          <td class="cell-muted">${c.lastHealthCheckAt ? relativeTime(c.lastHealthCheckAt) : 'Never'}</td>
          <td><button class="btn btn-sm btn-ghost" data-check="${c.id}" data-requires="connector.manage">Check health</button></td>
        </tr>`).join('')}
    </tbody></table>`;
    wrap.querySelectorAll('[data-check]').forEach((btn) => btn.addEventListener('click', () => runHealthCheck(btn.dataset.check)));
  } catch (err) {
    errorState(wrap, { message: err.message, retry: loadConnectors });
  }
}

async function runHealthCheck(connectorId) {
  try {
    const result = await api.checkConnectorHealth({ connectorId });
    await logAudit(AUDIT_ACTIONS.CONNECTOR_HEALTH_CHECKED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'connector', targetId: connectorId, summary: `Health check: ${result.status}` });
    toast('Health check complete', result.status === 'healthy' ? 'Connector is reachable and configured.' : `Status: ${humanize(result.status)}`, result.status === 'healthy' ? 'success' : 'warn');
    await loadConnectors();
  } catch (err) {
    toast('Health check failed', err.message, 'error');
  }
}

function openRegisterModal() {
  const { close } = openModal({
    title: 'Register connector',
    bodyHtml: `
      <div class="form-grid single">
        <div class="field">
          <label>Tool</label>
          <select class="input" id="reg-tool">${CONNECTOR_CATALOG.map((c) => `<option value="${c.id}" data-cat="${c.category}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${humanize(c.category)})</option>`).join('')}</select>
        </div>
        <div class="field"><label>Endpoint / host (where the tool's API or CLI runner is reachable)</label><input class="input" id="reg-endpoint" placeholder="https://zap-runner.internal:8080" /></div>
        <div class="field"><label>Credential reference</label><input class="input" id="reg-cred" placeholder="secretmanager://ccdi/zap-api-key" />
          <span class="hint">Store the actual secret in your secret manager; CCDI stores only a reference, never the raw credential.</span></div>
        <div class="field"><label>Notes</label><textarea class="input" id="reg-notes" placeholder="Install location, version pin, operator contact…"></textarea></div>
      </div>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="reg-save">Register</button>`,
  });
  document.querySelector('.overlay .modal [data-cancel]').addEventListener('click', close);
  document.getElementById('reg-save').addEventListener('click', async () => {
    const sel = document.getElementById('reg-tool');
    const opt = sel.options[sel.selectedIndex];
    const payload = {
      toolId: sel.value,
      toolName: opt.dataset.name,
      category: opt.dataset.cat,
      endpoint: document.getElementById('reg-endpoint').value.trim(),
      credentialRef: document.getElementById('reg-cred').value.trim(),
      notes: document.getElementById('reg-notes').value.trim(),
      status: 'configured',
    };
    try {
      const id = await createDoc(COLLECTIONS.CONNECTORS, payload);
      await logAudit(AUDIT_ACTIONS.CONNECTOR_REGISTERED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'connector', targetId: id, summary: `Registered connector ${payload.toolName}` });
      toast('Connector registered', payload.toolName, 'success');
      close();
      await loadConnectors();
    } catch (err) {
      toast('Registration failed', err.message, 'error');
    }
  });
}

export async function loadScans() {
  const wrap = document.getElementById('scan-table');
  if (!wrap) return;
  loadingState(wrap, 'Loading scan requests…');
  try {
    const { docs } = await listDocs(COLLECTIONS.SCANS, { pageSize: 300, sortBy: 'createdAt', sortDir: 'desc' });
    if (!docs.length) {
      emptyState(wrap, { title: 'No scan requests yet', message: 'Requests created from the Website, Network or API Security pages will appear here for approval and result import.' });
      return;
    }
    wrap.innerHTML = `<table class="data-table"><thead><tr>
        <th>Target</th><th>Category</th><th>Profile</th><th>Status</th><th>Requested by</th><th>Requested</th><th></th>
      </tr></thead><tbody>
      ${docs.map((s) => `
        <tr>
          <td><strong>${escapeHtml(s.assetName || s.targetName || '—')}</strong></td>
          <td class="cell-muted">${humanize(s.category || '—')}</td>
          <td class="cell-muted">${escapeHtml(s.profileName || s.profileId || '—')}</td>
          <td>${statusBadge(s.status, SCAN_STATUS_BADGE)}</td>
          <td class="cell-muted">${escapeHtml(s.createdBy || '—')}</td>
          <td class="cell-muted">${fmtDateTime(s.createdAt)}</td>
          <td>${scanActions(s)}</td>
        </tr>`).join('')}
    </tbody></table>`;
    wireScanActions(wrap);
  } catch (err) {
    errorState(wrap, { message: err.message, retry: loadScans });
  }
}

function scanActions(s) {
  const btns = [];
  if (s.status === 'pending_approval' && can('scan.approve')) {
    btns.push(`<button class="btn btn-sm btn-primary" data-approve="${s.id}">Approve</button>`);
    btns.push(`<button class="btn btn-sm btn-danger" data-deny="${s.id}">Deny</button>`);
  }
  if (['approved', 'in_progress'].includes(s.status) && can('scan.result_import')) {
    btns.push(`<button class="btn btn-sm btn-gold" data-import="${s.id}">Import result</button>`);
  }
  if (['pending_approval', 'approved', 'in_progress'].includes(s.status) && can('scan.cancel')) {
    btns.push(`<button class="btn btn-sm btn-ghost" data-cancel-scan="${s.id}">Cancel</button>`);
  }
  return btns.join(' ');
}

function wireScanActions(wrap) {
  wrap.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decideScan(b.dataset.approve, 'approved')));
  wrap.querySelectorAll('[data-deny]').forEach((b) => b.addEventListener('click', () => decideScan(b.dataset.deny, 'denied')));
  wrap.querySelectorAll('[data-cancel-scan]').forEach((b) => b.addEventListener('click', () => cancelScan(b.dataset.cancelScan)));
  wrap.querySelectorAll('[data-import]').forEach((b) => b.addEventListener('click', () => openImportResultModal(b.dataset.import)));
}

async function decideScan(scanId, decision) {
  const notes = decision === 'denied' ? (prompt('Reason for denial:') || '') : '';
  try {
    await api.approveScan({ scanId, decision, notes });
    await logAudit(decision === 'approved' ? AUDIT_ACTIONS.SCAN_APPROVED : AUDIT_ACTIONS.SCAN_DENIED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'scan', targetId: scanId, summary: `Scan ${decision}` });
    toast(`Scan ${decision}`, '', 'success');
    loadScans();
  } catch (err) {
    toast('Action failed', err.message, 'error');
  }
}

async function cancelScan(scanId) {
  const reason = prompt('Reason for cancellation:') || 'Cancelled by operator';
  try {
    await api.cancelScan({ scanId, reason });
    await logAudit(AUDIT_ACTIONS.SCAN_CANCELLED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'scan', targetId: scanId, summary: 'Scan cancelled' });
    toast('Scan cancelled', '', 'success');
    loadScans();
  } catch (err) {
    toast('Cancel failed', err.message, 'error');
  }
}

function openImportResultModal(scanId) {
  const { close } = openModal({
    title: 'Import scan result',
    width: '560px',
    bodyHtml: `
      <p style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:10px">
        Paste the structured JSON output produced by your externally-run, authorized scanner (or a CCDI-normalized export of it). The orchestration engine validates and normalizes this into vulnerability findings, runs deduplication, and preserves this as the source evidence record. CCDI never fabricates a result for an unavailable scanner — only paste output you actually have.
      </p>
      <textarea class="input" id="import-json" rows="10" placeholder='{"findings": [{"title": "...", "severity": "high", ...}]}'></textarea>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="import-save">Import &amp; normalize</button>`,
  });
  document.querySelector('.overlay .modal [data-cancel]').addEventListener('click', close);
  document.getElementById('import-save').addEventListener('click', async () => {
    const raw = document.getElementById('import-json').value.trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { toast('Invalid JSON', 'Check the pasted result and try again.', 'error'); return; }
    try {
      const result = await api.importScanResult({ scanId, resultPayload: parsed });
      await logAudit(AUDIT_ACTIONS.SCAN_RESULT_IMPORTED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'scan', targetId: scanId, summary: `Imported ${result.findingsCreated || 0} findings`, metadata: result });
      toast('Result imported', `${result.findingsCreated || 0} findings normalized into the vulnerability database.`, 'success');
      close();
      loadScans();
    } catch (err) {
      toast('Import failed', err.message, 'error');
    }
  });
}
