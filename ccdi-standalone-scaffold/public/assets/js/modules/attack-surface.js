import { renderShell } from '../core/layout.js';
import { listDocs, updateDocById, COLLECTIONS } from '../core/data.js';
import {
  toast, emptyState, loadingState, errorState, fmtDateTime, relativeTime,
  escapeHtml, humanize, statusBadge, confirmDialog, openModal,
} from '../core/ui.js';
import { can } from '../core/rbac.js';
import { CURRENT } from '../core/auth.js';
import { api } from '../core/api.js';
import { logAudit, AUDIT_ACTIONS } from '../core/audit.js';
import { LIFECYCLE_BADGE, SCOPE_BADGE } from './assets/constants.js';

renderShell({
  active: 'attack-surface',
  title: 'Attack Surface Management',
  subtitle: 'External exposure inventory, discovery jobs and risk classification for your organization’s authorized digital footprint',
});

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  detail.contentEl.innerHTML = `
    <div class="grid grid-4" id="exposure-stats" style="margin-bottom:20px"></div>
    <div class="toolbar">
      <div class="chip-select" style="gap:4px;padding:3px">
        <button class="btn btn-sm btn-ghost tab-btn active" data-tab="discovered">Discovered assets</button>
        <button class="btn btn-sm btn-ghost tab-btn" data-tab="jobs">Discovery jobs</button>
        <button class="btn btn-sm btn-ghost tab-btn" data-tab="observations">Exposure observations</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap" id="tab-content"></div></div>`;

  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderTab(btn.dataset.tab);
  }));

  await renderStats();
  renderTab('discovered');
});

async function renderStats() {
  const el = document.getElementById('exposure-stats');
  const [assets, jobs, obs] = await Promise.all([
    listDocs(COLLECTIONS.ASSETS, { pageSize: 1000 }),
    listDocs(COLLECTIONS.DISCOVERY_JOBS, { pageSize: 500 }),
    listDocs(COLLECTIONS.ATTACK_SURFACE, { pageSize: 500 }),
  ]);
  const newLast30 = assets.docs.filter((a) => isWithinDays(a.createdAt, 30)).length;
  const pendingJobs = jobs.docs.filter((j) => j.status === 'pending_approval').length;
  const unauthExcluded = assets.docs.filter((a) => a.scopeStatus === 'out_of_scope').length;
  const highRiskObs = obs.docs.filter((o) => ['critical', 'high'].includes((o.riskLevel || '').toLowerCase())).length;

  el.innerHTML = [
    { label: 'Total exposure inventory', value: assets.docs.length, delta: `${newLast30} discovered last 30d`, trend: newLast30 ? 'up' : 'flat' },
    { label: 'Pending discovery approvals', value: pendingJobs, delta: pendingJobs ? 'Needs admin review' : 'All clear', trend: pendingJobs ? 'up' : 'down' },
    { label: 'Excluded / out of scope', value: unauthExcluded, delta: 'Never auto-tested', trend: 'flat' },
    { label: 'High-risk exposure changes', value: highRiskObs, delta: `${obs.docs.length} total observations`, trend: highRiskObs ? 'up' : 'flat' },
  ].map((c) => `<div class="card stat-card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="delta ${c.trend}">${c.delta}</div></div>`).join('');
}

function isWithinDays(iso, days) {
  if (!iso) return false;
  const d = new Date(iso);
  return (Date.now() - d.getTime()) / 86400000 <= days;
}

async function renderTab(tab) {
  const el = document.getElementById('tab-content');
  loadingState(el, 'Loading…');
  if (tab === 'discovered') return renderDiscoveredAssets(el);
  if (tab === 'jobs') return renderDiscoveryJobs(el);
  return renderObservations(el);
}

async function renderDiscoveredAssets(el) {
  const { docs } = await listDocs(COLLECTIONS.ASSETS, { pageSize: 500, sortBy: 'createdAt', sortDir: 'desc' });
  const rows = docs.filter((a) => ['discovered', 'pending_verification', 'under_investigation'].includes(a.lifecycleStatus));
  if (!rows.length) { emptyState(el, { title: 'No unverified assets', message: 'Every known asset has been verified or excluded.' }); return; }
  el.innerHTML = `<table class="data-table"><thead><tr><th>Asset</th><th>Type</th><th>Lifecycle</th><th>Scope</th><th>Discovered</th><th></th></tr></thead><tbody>
    ${rows.map((a) => `
      <tr>
        <td><strong>${escapeHtml(a.name)}</strong></td>
        <td class="cell-muted">${humanize(a.assetType)}</td>
        <td>${statusBadge(a.lifecycleStatus, LIFECYCLE_BADGE)}</td>
        <td>${statusBadge(a.scopeStatus || 'pending_review', SCOPE_BADGE)}</td>
        <td class="cell-muted">${relativeTime(a.createdAt)}</td>
        <td><a class="btn btn-sm btn-ghost" href="assets.html">Review in inventory</a></td>
      </tr>`).join('')}
  </tbody></table>`;
}

async function renderDiscoveryJobs(el) {
  const { docs } = await listDocs(COLLECTIONS.DISCOVERY_JOBS, { pageSize: 300, sortBy: 'createdAt', sortDir: 'desc' });
  if (!docs.length) { emptyState(el, { title: 'No discovery jobs', message: 'Active discovery requests submitted from the asset inventory will appear here for approval.' }); return; }
  el.innerHTML = `<table class="data-table"><thead><tr><th>Asset</th><th>Checks</th><th>Requested by</th><th>Status</th><th>Requested</th><th></th></tr></thead><tbody>
    ${docs.map((j) => `
      <tr>
        <td><strong>${escapeHtml(j.assetName || j.assetId)}</strong></td>
        <td class="cell-muted">${(j.checks || []).map((c) => humanize(c)).join(', ')}</td>
        <td class="cell-muted">${escapeHtml(j.createdBy || '—')}</td>
        <td>${statusBadge(j.status, { pending_approval: 'warn', approved: 'ok', denied: 'danger', completed: 'cyan' })}</td>
        <td class="cell-muted">${fmtDateTime(j.createdAt)}</td>
        <td>${j.status === 'pending_approval' && can('discovery.active.approve') ? `
          <button class="btn btn-sm btn-primary" data-approve="${j.id}">Approve</button>
          <button class="btn btn-sm btn-danger" data-deny="${j.id}">Deny</button>` : ''}
        </td>
      </tr>`).join('')}
  </tbody></table>`;

  el.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => decideJob(btn.dataset.approve, 'approved', el)));
  el.querySelectorAll('[data-deny]').forEach((btn) => btn.addEventListener('click', () => decideJob(btn.dataset.deny, 'denied', el)));
}

async function decideJob(jobId, decision, el) {
  const notes = decision === 'denied' ? (prompt('Reason for denial (required):') || '') : '';
  if (decision === 'denied' && !notes.trim()) { toast('Denial requires a reason', '', 'warn'); return; }
  const ok = await confirmDialog({
    title: decision === 'approved' ? 'Approve active discovery?' : 'Deny discovery request?',
    message: decision === 'approved'
      ? 'This authorizes the orchestration engine to run the requested controlled discovery checks against the isolated worker infrastructure, within scope and rate limits.'
      : 'This request will be marked denied and will not execute.',
    confirmLabel: decision === 'approved' ? 'Approve' : 'Deny',
    danger: decision === 'denied',
  });
  if (!ok) return;
  try {
    await api.approveDiscoveryJob({ jobId, decision, notes });
    await logAudit(decision === 'approved' ? AUDIT_ACTIONS.DISCOVERY_ACTIVE_APPROVED : AUDIT_ACTIONS.DISCOVERY_ACTIVE_DENIED, {
      actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'discovery_job', targetId: jobId, summary: `Discovery job ${decision}`, metadata: { notes },
    });
    toast(`Job ${decision}`, '', 'success');
    renderDiscoveryJobs(el);
  } catch (err) {
    toast('Action failed', err.message, 'error');
  }
}

async function renderObservations(el) {
  const { docs } = await listDocs(COLLECTIONS.ATTACK_SURFACE, { pageSize: 300, sortBy: 'createdAt', sortDir: 'desc' });
  if (!docs.length) {
    emptyState(el, {
      title: 'No exposure observations yet',
      message: 'Certificate expirations, DNS changes, newly exposed services, security-header weaknesses and other attack-surface changes will be recorded here as they are detected through passive discovery and connector scans.',
    });
    return;
  }
  el.innerHTML = `<table class="data-table"><thead><tr><th>Type</th><th>Asset</th><th>Summary</th><th>Risk</th><th>Detected</th></tr></thead><tbody>
    ${docs.map((o) => `
      <tr>
        <td><span class="badge badge-cyan">${humanize(o.observationType || 'change')}</span></td>
        <td class="cell-muted">${escapeHtml(o.assetName || o.assetId || '—')}</td>
        <td>${escapeHtml(o.summary || '—')}</td>
        <td>${o.riskLevel ? `<span class="badge badge-${riskClass(o.riskLevel)}">${humanize(o.riskLevel)}</span>` : '—'}</td>
        <td class="cell-muted">${fmtDateTime(o.createdAt)}</td>
      </tr>`).join('')}
  </tbody></table>`;
}

function riskClass(r) {
  return { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }[r?.toLowerCase()] || 'neutral';
}
