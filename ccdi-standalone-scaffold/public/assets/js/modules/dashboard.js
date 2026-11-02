import { renderShell } from '../core/layout.js';
import { listDocs, COLLECTIONS } from '../core/data.js';
import { fmtDateTime, severityBadge, humanize, escapeHtml } from '../core/ui.js';

renderShell({ active: 'dashboard', title: 'Security Overview', subtitle: 'Tenant-wide exposure, findings and assessment status' });

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  const { contentEl } = detail;
  contentEl.innerHTML = `
    <div class="grid grid-4" id="stat-row" style="margin-bottom:20px"></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><div><h3>Recent findings</h3><p>Latest vulnerability records across all engines</p></div>
          <a href="vulnerabilities.html" class="btn btn-ghost btn-sm">View all</a></div>
        <div id="recent-findings"></div>
      </div>
      <div class="card">
        <div class="card-header"><div><h3>Pending approvals</h3><p>Discovery, scan and engagement requests awaiting a decision</p></div></div>
        <div id="pending-approvals"></div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-header"><div><h3>Attack surface changes</h3><p>Newly discovered or changed assets, last 10 events</p></div>
          <a href="attack-surface.html" class="btn btn-ghost btn-sm">View all</a></div>
        <div id="surface-changes"></div>
      </div>
      <div class="card">
        <div class="card-header"><div><h3>Active assessments</h3><p>Scans and engagements currently in progress</p></div></div>
        <div id="active-assessments"></div>
      </div>
    </div>`;

  await Promise.all([
    renderStats(),
    renderRecentFindings(),
    renderPendingApprovals(),
    renderSurfaceChanges(),
    renderActiveAssessments(),
  ]);
});

async function renderStats() {
  const row = document.getElementById('stat-row');
  const [assets, findings, scans, engagements] = await Promise.all([
    listDocs(COLLECTIONS.ASSETS, { pageSize: 500 }),
    listDocs(COLLECTIONS.FINDINGS, { pageSize: 500 }),
    listDocs(COLLECTIONS.SCANS, { pageSize: 200 }),
    listDocs(COLLECTIONS.PENTEST_ENGAGEMENTS, { pageSize: 200 }),
  ]);

  const openFindings = findings.docs.filter((f) => !['resolved', 'false_positive'].includes(f.status));
  const critHigh = openFindings.filter((f) => ['critical', 'high'].includes((f.severity || '').toLowerCase())).length;
  const pendingScans = scans.docs.filter((s) => s.status === 'pending_approval').length;
  const activeEngagements = engagements.docs.filter((e) => ['approved', 'in_progress'].includes(e.status)).length;

  const cards = [
    { label: 'Total assets', value: assets.docs.length, delta: `${assets.docs.filter((a) => a.lifecycleStatus === 'discovered').length} awaiting verification`, trend: 'flat' },
    { label: 'Open findings', value: openFindings.length, delta: `${critHigh} critical/high`, trend: critHigh > 0 ? 'up' : 'flat' },
    { label: 'Pending scan approvals', value: pendingScans, delta: pendingScans ? 'Needs review' : 'All clear', trend: pendingScans ? 'up' : 'down' },
    { label: 'Active engagements', value: activeEngagements, delta: `${engagements.docs.length} total`, trend: 'flat' },
  ];

  row.innerHTML = cards.map((c) => `
    <div class="card stat-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="delta ${c.trend}">${c.delta}</div>
    </div>`).join('');
}

async function renderRecentFindings() {
  const el = document.getElementById('recent-findings');
  const { docs } = await listDocs(COLLECTIONS.FINDINGS, { pageSize: 6, sortBy: 'createdAt', sortDir: 'desc' });
  if (!docs.length) { el.innerHTML = emptyRow('No findings recorded yet.'); return; }
  el.innerHTML = `<div class="table-wrap"><table class="data-table"><tbody>
    ${docs.map((f) => `
      <tr onclick="location.href='vulnerabilities.html?id=${f.id}'">
        <td>${severityBadge(f.severity)}</td>
        <td><strong>${escapeHtml(f.title || 'Untitled finding')}</strong><div class="cell-muted" style="font-size:11px">${escapeHtml(f.affectedAssetName || f.affectedAsset || '')}</div></td>
        <td class="cell-muted">${escapeHtml(humanize(f.status || 'new'))}</td>
        <td class="cell-muted">${fmtDateTime(f.createdAt)}</td>
      </tr>`).join('')}
  </tbody></table></div>`;
}

async function renderPendingApprovals() {
  const el = document.getElementById('pending-approvals');
  const [jobs, scans, engagements] = await Promise.all([
    listDocs(COLLECTIONS.DISCOVERY_JOBS, { filters: [['status', '==', 'pending_approval']], pageSize: 10 }),
    listDocs(COLLECTIONS.SCANS, { filters: [['status', '==', 'pending_approval']], pageSize: 10 }),
    listDocs(COLLECTIONS.PENTEST_ENGAGEMENTS, { filters: [['status', '==', 'pending_approval']], pageSize: 10 }),
  ]);
  const rows = [
    ...jobs.docs.map((j) => ({ type: 'Active discovery', label: j.assetName || j.assetId, href: 'assets.html' })),
    ...scans.docs.map((s) => ({ type: 'Scan request', label: s.assetName || s.assetId, href: 'connectors.html' })),
    ...engagements.docs.map((e) => ({ type: 'Pentest engagement', label: e.name, href: 'pentest.html' })),
  ];
  if (!rows.length) { el.innerHTML = emptyRow('No pending approvals.'); return; }
  el.innerHTML = `<div class="table-wrap"><table class="data-table"><tbody>
    ${rows.map((r) => `
      <tr onclick="location.href='${r.href}'">
        <td><span class="badge badge-warn">Pending</span></td>
        <td><strong>${escapeHtml(r.type)}</strong></td>
        <td class="cell-muted">${escapeHtml(r.label || '—')}</td>
      </tr>`).join('')}
  </tbody></table></div>`;
}

async function renderSurfaceChanges() {
  const el = document.getElementById('surface-changes');
  const { docs } = await listDocs(COLLECTIONS.ATTACK_SURFACE, { pageSize: 10, sortBy: 'createdAt', sortDir: 'desc' });
  if (!docs.length) { el.innerHTML = emptyRow('No attack surface observations recorded yet.'); return; }
  el.innerHTML = `<div class="table-wrap"><table class="data-table"><tbody>
    ${docs.map((o) => `
      <tr onclick="location.href='attack-surface.html'">
        <td><span class="badge badge-cyan">${escapeHtml(humanize(o.observationType || 'change'))}</span></td>
        <td>${escapeHtml(o.summary || o.assetName || '—')}</td>
        <td class="cell-muted">${fmtDateTime(o.createdAt)}</td>
      </tr>`).join('')}
  </tbody></table></div>`;
}

async function renderActiveAssessments() {
  const el = document.getElementById('active-assessments');
  const { docs } = await listDocs(COLLECTIONS.SCANS, { filters: [['status', 'in', ['approved', 'in_progress']]], pageSize: 10 });
  if (!docs.length) { el.innerHTML = emptyRow('No assessments currently in progress.'); return; }
  el.innerHTML = `<div class="table-wrap"><table class="data-table"><tbody>
    ${docs.map((s) => `
      <tr onclick="location.href='connectors.html'">
        <td><span class="badge badge-ok">${escapeHtml(humanize(s.status))}</span></td>
        <td><strong>${escapeHtml(s.assetName || s.assetId || '—')}</strong></td>
        <td class="cell-muted">${escapeHtml(s.profileName || s.connectorId || '—')}</td>
      </tr>`).join('')}
  </tbody></table></div>`;
}

function emptyRow(msg) {
  return `<div class="state-block" style="padding:32px 20px"><p>${msg}</p></div>`;
}
