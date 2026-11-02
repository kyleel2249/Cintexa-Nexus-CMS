import { renderShell } from '../../core/layout.js';
import {
  listDocs, getDocById, createDoc, updateDocById, deleteDocById, appendHistory, COLLECTIONS,
} from '../../core/data.js';
import {
  toast, openDrawer, openModal, confirmDialog, emptyState, loadingState, errorState,
  debounce, fmtDateTime, relativeTime, escapeHtml, humanize, severityBadge, statusBadge,
} from '../../core/ui.js';
import { can } from '../../core/rbac.js';
import { logAudit, AUDIT_ACTIONS } from '../../core/audit.js';
import { CURRENT } from '../../core/auth.js';
import { api } from '../../core/api.js';
import {
  SEVERITIES, FINDING_STATUSES, FINDING_STATUS_BADGE, CONFIDENCE_LEVELS,
  DETECTION_SOURCES, VULN_CATEGORIES,
} from './constants.js';
import { findDuplicateCandidates } from './dedup.js';

renderShell({
  active: 'vulnerabilities',
  title: 'Vulnerability Management',
  subtitle: 'Consolidated findings across all CCDI security engines with CVE/CWE intelligence, remediation and retest tracking',
});

const state = { all: [], filtered: [], assets: [], search: '', sev: '', status: '' };

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  state.contentEl = detail.contentEl;
  renderPage();
  await loadAssetsForPicker();
  await loadFindings();
  maybeOpenFromQuery();
});

async function loadAssetsForPicker() {
  const { docs } = await listDocs(COLLECTIONS.ASSETS, { pageSize: 1000 });
  state.assets = docs;
}

function maybeOpenFromQuery() {
  const id = new URLSearchParams(location.search).get('id');
  if (id) openFindingDetail(id);
}

function renderPage() {
  state.contentEl.innerHTML = `
    <div class="grid grid-4" id="sev-stats" style="margin-bottom:20px"></div>
    <div class="toolbar">
      <div class="search-box" style="min-width:260px">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M14 14l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input type="text" id="f-search" placeholder="Search title, CVE, asset…" />
      </div>
      <div class="chip-select"><select id="f-sev"><option value="">All severities</option>${SEVERITIES.map((s) => `<option value="${s}">${humanize(s)}</option>`).join('')}</select></div>
      <div class="chip-select"><select id="f-status"><option value="">All statuses</option>${FINDING_STATUSES.map((s) => `<option value="${s}">${humanize(s)}</option>`).join('')}</select></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="btn-new-finding" data-requires="vuln.create">+ New finding</button>
    </div>
    <div class="card"><div class="table-wrap" id="findings-table"></div></div>`;

  document.getElementById('f-search').addEventListener('input', debounce((e) => { state.search = e.target.value.toLowerCase(); applyFilters(); }, 200));
  document.getElementById('f-sev').addEventListener('change', (e) => { state.sev = e.target.value; applyFilters(); });
  document.getElementById('f-status').addEventListener('change', (e) => { state.status = e.target.value; applyFilters(); });
  document.getElementById('btn-new-finding').addEventListener('click', () => openFindingForm(null));
}

async function loadFindings() {
  const wrap = document.getElementById('findings-table');
  loadingState(wrap, 'Loading findings…');
  try {
    const { docs } = await listDocs(COLLECTIONS.FINDINGS, { pageSize: 1000 });
    state.all = docs;
    renderSevStats();
    applyFilters();
  } catch (err) {
    errorState(wrap, { message: err.message, retry: loadFindings });
  }
}

function renderSevStats() {
  const open = state.all.filter((f) => !['resolved', 'false_positive'].includes(f.status));
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((f) => (f.severity || '').toLowerCase() === s).length]));
  document.getElementById('sev-stats').innerHTML = `
    <div class="card stat-card"><div class="label">Critical</div><div class="value" style="color:var(--sev-critical)">${counts.critical}</div><div class="delta flat">Open findings</div></div>
    <div class="card stat-card"><div class="label">High</div><div class="value" style="color:var(--sev-high)">${counts.high}</div><div class="delta flat">Open findings</div></div>
    <div class="card stat-card"><div class="label">Medium</div><div class="value" style="color:var(--sev-medium)">${counts.medium}</div><div class="delta flat">Open findings</div></div>
    <div class="card stat-card"><div class="label">Low / Info</div><div class="value" style="color:var(--sev-low)">${counts.low + counts.informational}</div><div class="delta flat">Open findings</div></div>`;
}

function applyFilters() {
  let rows = state.all;
  if (state.sev) rows = rows.filter((f) => (f.severity || '').toLowerCase() === state.sev);
  if (state.status) rows = rows.filter((f) => f.status === state.status);
  if (state.search) {
    const q = state.search;
    rows = rows.filter((f) => [f.title, f.cveId, f.affectedAssetName, f.affectedAsset].filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  rows = [...rows].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
    return (order[(a.severity || 'informational').toLowerCase()] ?? 5) - (order[(b.severity || 'informational').toLowerCase()] ?? 5);
  });
  state.filtered = rows;
  renderTable();
}

function renderTable() {
  const wrap = document.getElementById('findings-table');
  if (!state.filtered.length) {
    emptyState(wrap, {
      title: 'No findings match these filters',
      message: state.all.length ? 'Try adjusting your filters.' : 'Findings created manually or ingested from authorized scanner connectors will appear here.',
      actionHtml: can('vuln.create') ? '<button class="btn btn-primary btn-sm" id="empty-new">New finding</button>' : '',
    });
    document.getElementById('empty-new')?.addEventListener('click', () => openFindingForm(null));
    return;
  }
  wrap.innerHTML = `<table class="data-table"><thead><tr>
      <th>Severity</th><th>Finding</th><th>Asset</th><th>CVE</th><th>Status</th><th>Owner</th><th>Last detected</th>
    </tr></thead><tbody>
    ${state.filtered.map((f) => `
      <tr data-id="${f.id}">
        <td>${severityBadge(f.severity)}</td>
        <td><strong>${escapeHtml(f.title)}</strong>${f.detectionSource ? `<div class="cell-muted" style="font-size:11px">via ${humanize(f.detectionSource)}</div>` : ''}</td>
        <td class="cell-muted">${escapeHtml(f.affectedAssetName || f.affectedAsset || '—')}</td>
        <td class="cell-mono">${escapeHtml(f.cveId || '—')}</td>
        <td>${statusBadge(f.status || 'new', FINDING_STATUS_BADGE)}</td>
        <td class="cell-muted">${escapeHtml(f.assignedOwner || '—')}</td>
        <td class="cell-muted">${relativeTime(f.lastDetectedAt || f.createdAt)}</td>
      </tr>`).join('')}
  </tbody></table>`;
  wrap.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => openFindingDetail(tr.dataset.id)));
}

// ---------------------------------------------------------------- Create/edit
function assetOptions(selectedId) {
  return state.assets.map((a) => `<option value="${a.id}" data-name="${escapeHtml(a.name)}" ${a.id === selectedId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
}

function openFindingForm(finding) {
  const isEdit = !!finding;
  const { close } = openDrawer({
    title: isEdit ? 'Edit finding' : 'New vulnerability finding',
    bodyHtml: `
      <form id="finding-form" class="form-grid">
        <div class="field span-2"><label>Title *</label><input class="input" name="title" required value="${escapeHtml(finding?.title || '')}" /></div>
        <div class="field"><label>Affected asset *</label><select class="input" name="affectedAsset" required><option value="">Select…</option>${assetOptions(finding?.affectedAsset)}</select></div>
        <div class="field"><label>Affected endpoint/service</label><input class="input" name="affectedEndpoint" value="${escapeHtml(finding?.affectedEndpoint || '')}" /></div>
        <div class="field"><label>Severity *</label><select class="input" name="severity" required>${SEVERITIES.map((s) => `<option value="${s}" ${finding?.severity === s ? 'selected' : ''}>${humanize(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Confidence</label><select class="input" name="confidence">${CONFIDENCE_LEVELS.map((s) => `<option value="${s}" ${finding?.confidence === s ? 'selected' : ''}>${humanize(s)}</option>`).join('')}</select></div>
        <div class="field"><label>CVE identifier</label><input class="input" name="cveId" placeholder="CVE-2026-XXXXX" value="${escapeHtml(finding?.cveId || '')}" /></div>
        <div class="field"><label>CWE identifier</label><input class="input" name="cweId" placeholder="CWE-79" value="${escapeHtml(finding?.cweId || '')}" /></div>
        <div class="field"><label>CVSS score</label><input class="input" name="cvssScore" type="number" step="0.1" min="0" max="10" value="${finding?.cvssScore ?? ''}" /></div>
        <div class="field"><label>CVSS version</label><input class="input" name="cvssVersion" value="${escapeHtml(finding?.cvssVersion || '3.1')}" /></div>
        <div class="field"><label>Category</label><select class="input" name="vulnerabilityCategory">${VULN_CATEGORIES.map((c) => `<option value="${c}" ${finding?.vulnerabilityCategory === c ? 'selected' : ''}>${humanize(c)}</option>`).join('')}</select></div>
        <div class="field"><label>Detection source</label><select class="input" name="detectionSource">${DETECTION_SOURCES.map((c) => `<option value="${c}" ${(finding?.detectionSource || 'manual') === c ? 'selected' : ''}>${humanize(c)}</option>`).join('')}</select></div>
        <div class="field span-2"><label>Description</label><textarea class="input" name="description">${escapeHtml(finding?.description || '')}</textarea></div>
        <div class="field span-2"><label>Technical details / evidence summary</label><textarea class="input" name="technicalDetails">${escapeHtml(finding?.technicalDetails || '')}</textarea></div>
        <div class="field span-2"><label>Business impact</label><textarea class="input" name="businessImpact">${escapeHtml(finding?.businessImpact || '')}</textarea></div>
        <div class="field span-2"><label>Remediation guidance</label><textarea class="input" name="remediationGuidance">${escapeHtml(finding?.remediationGuidance || '')}</textarea></div>
      </form>
      <div id="dup-warning"></div>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="finding-save">${isEdit ? 'Save changes' : 'Create finding'}</button>`,
  });
  document.querySelector('.overlay .drawer [data-cancel]').addEventListener('click', close);

  document.getElementById('finding-save').addEventListener('click', async () => {
    const form = document.getElementById('finding-form');
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const assetSel = form.querySelector('[name="affectedAsset"]');
    const payload = {
      title: fd.get('title').trim(),
      affectedAsset: fd.get('affectedAsset'),
      affectedAssetName: assetSel.options[assetSel.selectedIndex]?.dataset.name || '',
      affectedEndpoint: fd.get('affectedEndpoint').trim(),
      severity: fd.get('severity'),
      confidence: fd.get('confidence'),
      cveId: fd.get('cveId').trim().toUpperCase() || null,
      cweId: fd.get('cweId').trim() || null,
      cvssScore: fd.get('cvssScore') ? parseFloat(fd.get('cvssScore')) : null,
      cvssVersion: fd.get('cvssVersion').trim(),
      vulnerabilityCategory: fd.get('vulnerabilityCategory'),
      detectionSource: fd.get('detectionSource'),
      description: fd.get('description').trim(),
      technicalDetails: fd.get('technicalDetails').trim(),
      businessImpact: fd.get('businessImpact').trim(),
      remediationGuidance: fd.get('remediationGuidance').trim(),
      lastDetectedAt: new Date().toISOString(),
    };

    if (!isEdit) {
      const dups = findDuplicateCandidates(state.all, payload);
      if (dups.length && !form.dataset.dupConfirmed) {
        document.getElementById('dup-warning').innerHTML = `
          <div class="lock-note" style="margin-top:12px">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 2l8 15H2L10 2z" stroke="currentColor" stroke-width="1.4"/></svg>
            This looks similar to ${dups.length} existing finding(s) on the same asset (e.g. "${escapeHtml(dups[0].title)}"). Click "Create finding" again to create anyway, or close this and review the existing finding instead.
          </div>`;
        form.dataset.dupConfirmed = '1';
        return;
      }
      payload.status = 'new';
      payload.firstDetectedAt = payload.lastDetectedAt;
    }

    try {
      if (isEdit) {
        await updateDocById(COLLECTIONS.FINDINGS, finding.id, payload);
        await logAudit(AUDIT_ACTIONS.FINDING_UPDATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'finding', targetId: finding.id, summary: `Updated finding ${payload.title}` });
        toast('Finding updated', '', 'success');
      } else {
        const id = await createDoc(COLLECTIONS.FINDINGS, payload);
        await appendHistory(COLLECTIONS.RETEST_RECORDS, id, { action: 'created', actorEmail: CURRENT.user?.email, status: 'new' });
        await logAudit(AUDIT_ACTIONS.FINDING_CREATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'finding', targetId: id, summary: `Created finding ${payload.title}` });
        toast('Finding created', '', 'success');
      }
      close();
      await loadFindings();
    } catch (err) {
      toast('Save failed', err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------- Detail
async function openFindingDetail(id) {
  const finding = state.all.find((f) => f.id === id) || await getDocById(COLLECTIONS.FINDINGS, id);
  if (!finding) { toast('Not found', '', 'error'); return; }

  const { close } = openDrawer({
    title: finding.title,
    subtitle: `${finding.cveId || 'No CVE'} · ${humanize(finding.vulnerabilityCategory || 'other')}`,
    bodyHtml: `
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${severityBadge(finding.severity)}
        ${statusBadge(finding.status || 'new', FINDING_STATUS_BADGE)}
        ${finding.cvssScore != null ? `<span class="badge badge-neutral">CVSS ${finding.cvssScore} (v${finding.cvssVersion || '3.1'})</span>` : ''}
        ${finding.confidence ? `<span class="badge badge-neutral">${humanize(finding.confidence)} confidence</span>` : ''}
      </div>
      <div class="kv-row"><span class="k">Asset</span><span class="v">${escapeHtml(finding.affectedAssetName || finding.affectedAsset || '—')}</span></div>
      <div class="kv-row"><span class="k">Endpoint/service</span><span class="v cell-mono">${escapeHtml(finding.affectedEndpoint || '—')}</span></div>
      <div class="kv-row"><span class="k">CWE</span><span class="v">${escapeHtml(finding.cweId || '—')}</span></div>
      <div class="kv-row"><span class="k">Detection source</span><span class="v">${humanize(finding.detectionSource || 'manual')}</span></div>
      <div class="kv-row"><span class="k">Assigned owner</span><span class="v">${escapeHtml(finding.assignedOwner || 'Unassigned')}</span></div>
      <div class="kv-row"><span class="k">First detected</span><span class="v">${fmtDateTime(finding.firstDetectedAt || finding.createdAt)}</span></div>
      <div class="kv-row"><span class="k">Last detected</span><span class="v">${fmtDateTime(finding.lastDetectedAt || finding.createdAt)}</span></div>
      ${finding.description ? `<div class="divider"></div><h4 style="font-size:12.5px;margin-bottom:6px">Description</h4><p style="font-size:12.5px;color:var(--text-secondary);line-height:1.6">${escapeHtml(finding.description)}</p>` : ''}
      ${finding.technicalDetails ? `<h4 style="font-size:12.5px;margin:14px 0 6px">Technical details / evidence</h4><pre class="mono" style="font-size:11.5px;background:var(--bg-base);padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(finding.technicalDetails)}</pre>` : ''}
      ${finding.businessImpact ? `<h4 style="font-size:12.5px;margin:14px 0 6px">Business impact</h4><p style="font-size:12.5px;color:var(--text-secondary);line-height:1.6">${escapeHtml(finding.businessImpact)}</p>` : ''}
      ${finding.remediationGuidance ? `<h4 style="font-size:12.5px;margin:14px 0 6px">Remediation guidance</h4><p style="font-size:12.5px;color:var(--text-secondary);line-height:1.6">${escapeHtml(finding.remediationGuidance)}</p>` : ''}
      <div class="divider"></div>
      <h4 style="font-size:12.5px;margin-bottom:8px">Vulnerability intelligence</h4>
      <button class="btn btn-sm btn-ghost" id="sync-intel">Sync NVD &amp; CISA KEV data</button>
      <div id="intel-result" style="margin-top:10px">${finding.kevListed ? `<span class="badge badge-danger">Listed in CISA KEV</span>` : ''} ${finding.nvdSyncedAt ? `<p style="font-size:11px;color:var(--text-tertiary);margin-top:6px">Last synced ${fmtDateTime(finding.nvdSyncedAt)}</p>` : ''}</div>
      <div class="divider"></div>
      <h4 style="font-size:12.5px;margin-bottom:8px">Remediation &amp; retest</h4>
      <div class="form-grid single" id="remediation-form">
        <div class="field"><label>Assigned owner</label><input class="input" id="rf-owner" value="${escapeHtml(finding.assignedOwner || '')}" /></div>
        <div class="field"><label>Priority</label><select class="input" id="rf-priority"><option value="">—</option>${['critical', 'high', 'medium', 'low'].map((p) => `<option value="${p}" ${finding.remediationPriority === p ? 'selected' : ''}>${humanize(p)}</option>`).join('')}</select></div>
        <div class="field"><label>Due date</label><input class="input" type="date" id="rf-due" value="${finding.remediationDueDate || ''}" /></div>
        <div class="field"><label>Remediation notes</label><textarea class="input" id="rf-notes">${escapeHtml(finding.remediationNotes || '')}</textarea></div>
        <button class="btn btn-sm btn-primary" id="rf-save" data-requires="vuln.edit" style="align-self:flex-start">Save remediation</button>
      </div>
      <div class="divider"></div>
      <h4 style="font-size:12.5px;margin-bottom:8px">Status history</h4>
      <div id="status-history"><div class="spinner"></div></div>`,
    footerHtml: `
      <button class="btn btn-danger" id="finding-delete" data-requires="vuln.delete">Delete</button>
      <div class="spacer" style="flex:1"></div>
      <select class="input" id="status-select" style="width:auto" data-requires="vuln.status_change">${FINDING_STATUSES.map((s) => `<option value="${s}" ${finding.status === s ? 'selected' : ''}>${humanize(s)}</option>`).join('')}</select>
      <button class="btn btn-gold" id="status-apply" data-requires="vuln.status_change">Apply status</button>
      <button class="btn btn-primary" id="finding-edit" data-requires="vuln.edit">Edit</button>`,
  });

  loadStatusHistory(finding.id);

  document.getElementById('finding-edit').addEventListener('click', () => { close(); openFindingForm(finding); });
  document.getElementById('sync-intel').addEventListener('click', async () => {
    const btn = document.getElementById('sync-intel');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      const result = await api.syncVulnIntel({ findingId: finding.id });
      document.getElementById('intel-result').innerHTML = `
        ${result.kevListed ? '<span class="badge badge-danger">Listed in CISA KEV</span>' : '<span class="badge badge-ok">Not in CISA KEV</span>'}
        ${result.nvdDescription ? `<p style="font-size:11.5px;color:var(--text-secondary);margin-top:8px;line-height:1.5">${escapeHtml(result.nvdDescription)}</p>` : ''}
        <p style="font-size:11px;color:var(--text-tertiary);margin-top:6px">Synced just now from NVD / CISA KEV.</p>`;
      toast('Intelligence synced', '', 'success');
    } catch (err) {
      document.getElementById('intel-result').innerHTML = `<p style="font-size:11.5px;color:var(--sev-critical)">${escapeHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Sync NVD & CISA KEV data';
    }
  });

  document.getElementById('rf-save').addEventListener('click', async () => {
    const payload = {
      assignedOwner: document.getElementById('rf-owner').value.trim(),
      remediationPriority: document.getElementById('rf-priority').value,
      remediationDueDate: document.getElementById('rf-due').value,
      remediationNotes: document.getElementById('rf-notes').value.trim(),
    };
    await updateDocById(COLLECTIONS.FINDINGS, finding.id, payload);
    await logAudit(AUDIT_ACTIONS.REMEDIATION_UPDATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'finding', targetId: finding.id, summary: 'Remediation details updated' });
    toast('Remediation saved', '', 'success');
    Object.assign(finding, payload);
  });

  document.getElementById('status-apply').addEventListener('click', async () => {
    const newStatus = document.getElementById('status-select').value;
    if (newStatus === finding.status) return;
    if (newStatus === 'accepted_risk' && !can('vuln.accept_risk')) {
      toast('Not permitted', 'Accepting risk requires an Admin or Owner role.', 'error');
      return;
    }
    if (newStatus === 'resolved') {
      const ok = await confirmDialog({ title: 'Mark as resolved?', message: 'This should only be done after verifying the fix — never automatically because a scanner or AI recommended it. Consider requesting a retest instead.', confirmLabel: 'Mark resolved' });
      if (!ok) return;
    }
    await updateDocById(COLLECTIONS.FINDINGS, finding.id, { status: newStatus });
    await appendHistory(COLLECTIONS.RETEST_RECORDS, finding.id, { action: 'status_changed', fromStatus: finding.status, toStatus: newStatus, actorEmail: CURRENT.user?.email });
    await logAudit(AUDIT_ACTIONS.FINDING_STATUS_CHANGED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'finding', targetId: finding.id, summary: `Status changed to ${newStatus}` });
    toast('Status updated', humanize(newStatus), 'success');
    finding.status = newStatus;
    loadStatusHistory(finding.id);
    loadFindings();
  });

  document.getElementById('finding-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete finding?', message: `Permanently remove "${finding.title}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteDocById(COLLECTIONS.FINDINGS, finding.id);
    toast('Finding deleted', '', 'success');
    close();
    loadFindings();
  });
}

async function loadStatusHistory(findingId) {
  const el = document.getElementById('status-history');
  if (!el) return;
  const { docs } = await listDocs(COLLECTIONS.RETEST_RECORDS, { filters: [['parentId', '==', findingId]], pageSize: 50, sortBy: 'createdAt', sortDir: 'desc' });
  if (!docs.length) { el.innerHTML = '<p style="font-size:12px;color:var(--text-tertiary)">No history recorded.</p>'; return; }
  el.innerHTML = `<div class="timeline">${docs.map((h, i) => `
    <div class="timeline-item">
      <div class="dot-col"><div class="dot"></div>${i < docs.length - 1 ? '<div class="line"></div>' : ''}</div>
      <div class="tcontent">
        ${h.action === 'status_changed' ? `Status changed <strong>${humanize(h.fromStatus || 'new')} → ${humanize(h.toStatus)}</strong>` : humanize(h.action)}
        by ${escapeHtml(h.actorEmail || 'system')}
        <div class="meta">${fmtDateTime(h.createdAt)}</div>
      </div>
    </div>`).join('')}</div>`;
}
