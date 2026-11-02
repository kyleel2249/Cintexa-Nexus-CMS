import { renderShell } from '../../core/layout.js';
import {
  listDocs, getDocById, createDoc, updateDocById, deleteDocById, batchCreate,
  appendHistory, COLLECTIONS,
} from '../../core/data.js';
import {
  toast, openDrawer, openModal, confirmDialog, emptyState, loadingState, errorState,
  debounce, fmtDate, fmtDateTime, relativeTime, escapeHtml, humanize, statusBadge,
} from '../../core/ui.js';
import { can } from '../../core/rbac.js';
import { logAudit, AUDIT_ACTIONS } from '../../core/audit.js';
import { CURRENT } from '../../core/auth.js';
import { api } from '../../core/api.js';
import {
  ASSET_TYPES, LIFECYCLE_STATES, LIFECYCLE_BADGE, CRITICALITY, ENVIRONMENTS,
  SCOPE_STATUS, SCOPE_BADGE, RELATIONSHIP_TYPES, CSV_TEMPLATE_HEADERS,
} from './constants.js';
import { parseCsv, downloadCsv } from './csv.js';

renderShell({
  active: 'assets',
  title: 'Asset Inventory',
  subtitle: 'Domains, subdomains, websites, IPs, hosts, services, applications and APIs registered by your organization',
});

const state = {
  all: [],
  filtered: [],
  search: '',
  filterType: '',
  filterLifecycle: '',
  filterCriticality: '',
  sortBy: 'createdAt',
  sortDir: 'desc',
};

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  state.contentEl = detail.contentEl;
  renderPage();
  await loadAssets();
});

function renderPage() {
  state.contentEl.innerHTML = `
    <div class="toolbar">
      <div class="search-box" style="min-width:280px">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M14 14l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input type="text" id="asset-search" placeholder="Search by name, hostname, IP, tag…" />
      </div>
      <div class="chip-select">
        <select id="f-type"><option value="">All types</option>${ASSET_TYPES.map((t) => `<option value="${t}">${humanize(t)}</option>`).join('')}</select>
      </div>
      <div class="chip-select">
        <select id="f-lifecycle"><option value="">All lifecycle states</option>${LIFECYCLE_STATES.map((t) => `<option value="${t}">${humanize(t)}</option>`).join('')}</select>
      </div>
      <div class="chip-select">
        <select id="f-crit"><option value="">All criticality</option>${CRITICALITY.map((t) => `<option value="${t}">${humanize(t)}</option>`).join('')}</select>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="btn-export"><svg viewBox="0 0 20 20" fill="none"><path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Export CSV</button>
      <button class="btn btn-ghost" id="btn-import" data-requires="asset.bulk_import"><svg viewBox="0 0 20 20" fill="none"><path d="M10 13V3m0 0L6 7m4-4l4 4M4 16h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Bulk Import</button>
      <button class="btn btn-primary" id="btn-add" data-requires="asset.create"><svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>Add Asset</button>
    </div>
    <div class="card">
      <div class="table-wrap" id="asset-table-wrap"></div>
    </div>`;

  document.getElementById('asset-search').addEventListener('input', debounce((e) => {
    state.search = e.target.value.toLowerCase();
    applyFilters();
  }, 200));
  document.getElementById('f-type').addEventListener('change', (e) => { state.filterType = e.target.value; applyFilters(); });
  document.getElementById('f-lifecycle').addEventListener('change', (e) => { state.filterLifecycle = e.target.value; applyFilters(); });
  document.getElementById('f-crit').addEventListener('change', (e) => { state.filterCriticality = e.target.value; applyFilters(); });
  document.getElementById('btn-export').addEventListener('click', exportCsv);
  document.getElementById('btn-import').addEventListener('click', openBulkImportModal);
  document.getElementById('btn-add').addEventListener('click', () => openAssetDrawer(null));
}

async function loadAssets() {
  const wrap = document.getElementById('asset-table-wrap');
  loadingState(wrap, 'Loading asset inventory…');
  try {
    const { docs } = await listDocs(COLLECTIONS.ASSETS, { pageSize: 1000 });
    state.all = docs;
    applyFilters();
  } catch (err) {
    errorState(wrap, { message: err.message, retry: loadAssets });
  }
}

function applyFilters() {
  let rows = state.all;
  if (state.filterType) rows = rows.filter((r) => r.assetType === state.filterType);
  if (state.filterLifecycle) rows = rows.filter((r) => r.lifecycleStatus === state.filterLifecycle);
  if (state.filterCriticality) rows = rows.filter((r) => r.businessCriticality === state.filterCriticality);
  if (state.search) {
    const q = state.search;
    rows = rows.filter((r) => [r.name, r.hostname, r.ipAddress, ...(r.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  rows = [...rows].sort((a, b) => (a[state.sortBy] > b[state.sortBy] ? -1 : 1) * (state.sortDir === 'desc' ? 1 : -1));
  state.filtered = rows;
  renderTable();
}

function renderTable() {
  const wrap = document.getElementById('asset-table-wrap');
  if (!state.filtered.length) {
    emptyState(wrap, {
      icon: 'inbox',
      title: 'No assets match these filters',
      message: state.all.length ? 'Try adjusting your search or filters.' : 'Register your first asset manually or via bulk CSV import to begin building your inventory.',
      actionHtml: can('asset.create') ? '<button class="btn btn-primary btn-sm" id="empty-add">Add asset</button>' : '',
    });
    document.getElementById('empty-add')?.addEventListener('click', () => openAssetDrawer(null));
    return;
  }
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Asset</th><th>Type</th><th>Environment</th><th>Criticality</th><th>Lifecycle</th><th>Scope</th><th>Owner</th><th>Updated</th>
      </tr></thead>
      <tbody>
        ${state.filtered.map((a) => `
          <tr data-id="${a.id}">
            <td><strong>${escapeHtml(a.name)}</strong>${a.tags?.length ? `<div>${a.tags.slice(0, 3).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}</td>
            <td class="cell-muted">${humanize(a.assetType)}</td>
            <td class="cell-muted">${humanize(a.environment || '—')}</td>
            <td>${a.businessCriticality ? `<span class="badge badge-${critClass(a.businessCriticality)}">${humanize(a.businessCriticality)}</span>` : '—'}</td>
            <td>${statusBadge(a.lifecycleStatus || 'discovered', LIFECYCLE_BADGE)}</td>
            <td>${statusBadge(a.scopeStatus || 'pending_review', SCOPE_BADGE)}</td>
            <td class="cell-muted">${escapeHtml(a.ownerEmail || '—')}</td>
            <td class="cell-muted">${relativeTime(a.updatedAt)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => openAssetDetail(tr.dataset.id));
  });
}

function critClass(c) {
  return { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }[c] || 'neutral';
}

// ---------------------------------------------------------------- Add/Edit
function openAssetDrawer(asset) {
  const isEdit = !!asset;
  const { close } = openDrawer({
    title: isEdit ? 'Edit asset' : 'Register new asset',
    subtitle: isEdit ? asset.name : 'Manual asset registration',
    bodyHtml: `
      <form id="asset-form" class="form-grid">
        <div class="field span-2"><label>Asset name *</label><input class="input" name="name" required value="${escapeHtml(asset?.name || '')}" placeholder="e.g. app.example.com" /></div>
        <div class="field"><label>Asset type *</label><select class="input" name="assetType" required>${ASSET_TYPES.map((t) => `<option value="${t}" ${asset?.assetType === t ? 'selected' : ''}>${humanize(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Environment</label><select class="input" name="environment">${ENVIRONMENTS.map((t) => `<option value="${t}" ${asset?.environment === t ? 'selected' : ''}>${humanize(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Business criticality</label><select class="input" name="businessCriticality">${CRITICALITY.map((t) => `<option value="${t}" ${asset?.businessCriticality === t ? 'selected' : ''}>${humanize(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Lifecycle status</label><select class="input" name="lifecycleStatus">${LIFECYCLE_STATES.map((t) => `<option value="${t}" ${(asset?.lifecycleStatus || 'discovered') === t ? 'selected' : ''}>${humanize(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Scope status</label><select class="input" name="scopeStatus">${SCOPE_STATUS.map((t) => `<option value="${t}" ${(asset?.scopeStatus || 'pending_review') === t ? 'selected' : ''}>${humanize(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Owner email</label><input class="input" name="ownerEmail" type="email" value="${escapeHtml(asset?.ownerEmail || '')}" /></div>
        <div class="field"><label>Hostname / IP (optional)</label><input class="input" name="hostname" value="${escapeHtml(asset?.hostname || '')}" /></div>
        <div class="field span-2"><label>Tags (comma separated)</label><input class="input" name="tagsCsv" value="${escapeHtml((asset?.tags || []).join(', '))}" /></div>
        <div class="field span-2"><label>Description</label><textarea class="input" name="description">${escapeHtml(asset?.description || '')}</textarea></div>
      </form>`,
    footerHtml: `
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" id="asset-save">${isEdit ? 'Save changes' : 'Register asset'}</button>`,
  });
  document.querySelector('.overlay .drawer [data-cancel]').addEventListener('click', close);
  document.getElementById('asset-save').addEventListener('click', async () => {
    const form = document.getElementById('asset-form');
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name').trim(),
      assetType: fd.get('assetType'),
      environment: fd.get('environment'),
      businessCriticality: fd.get('businessCriticality'),
      lifecycleStatus: fd.get('lifecycleStatus'),
      scopeStatus: fd.get('scopeStatus'),
      ownerEmail: fd.get('ownerEmail').trim(),
      hostname: fd.get('hostname').trim(),
      tags: fd.get('tagsCsv').split(',').map((t) => t.trim()).filter(Boolean),
      description: fd.get('description').trim(),
    };
    try {
      if (isEdit) {
        await updateDocById(COLLECTIONS.ASSETS, asset.id, payload);
        await appendHistory(COLLECTIONS.ASSET_HISTORY, asset.id, { action: 'updated', snapshot: payload, actorEmail: CURRENT.user?.email });
        await logAudit(AUDIT_ACTIONS.ASSET_UPDATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'asset', targetId: asset.id, summary: `Updated asset ${payload.name}` });
        toast('Asset updated', payload.name, 'success');
      } else {
        const id = await createDoc(COLLECTIONS.ASSETS, payload);
        await appendHistory(COLLECTIONS.ASSET_HISTORY, id, { action: 'created', snapshot: payload, actorEmail: CURRENT.user?.email });
        await logAudit(AUDIT_ACTIONS.ASSET_CREATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'asset', targetId: id, summary: `Registered asset ${payload.name}` });
        toast('Asset registered', payload.name, 'success');
      }
      close();
      await loadAssets();
    } catch (err) {
      toast('Save failed', err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------- Detail drawer
async function openAssetDetail(id) {
  const asset = state.all.find((a) => a.id === id) || await getDocById(COLLECTIONS.ASSETS, id);
  if (!asset) { toast('Not found', 'This asset no longer exists.', 'error'); return; }

  const { close } = openDrawer({
    title: asset.name,
    subtitle: `${humanize(asset.assetType)} · ${humanize(asset.lifecycleStatus || 'discovered')}`,
    bodyHtml: `
      <div class="toolbar" style="margin-bottom:14px">
        <div class="chip-select" style="gap:4px;padding:3px">
          <button class="btn btn-sm btn-ghost tab-nav active" data-tab="overview">Overview</button>
          <button class="btn btn-sm btn-ghost tab-nav" data-tab="relationships">Relationships</button>
          <button class="btn btn-sm btn-ghost tab-nav" data-tab="history">History</button>
          <button class="btn btn-sm btn-ghost tab-nav" data-tab="discovery">Discovery</button>
        </div>
      </div>
      <div id="tab-overview"></div>
      <div id="tab-relationships" style="display:none"></div>
      <div id="tab-history" style="display:none"></div>
      <div id="tab-discovery" style="display:none"></div>`,
    footerHtml: `
      <button class="btn btn-danger" id="asset-delete" data-requires="asset.delete">Delete</button>
      <div class="spacer" style="flex:1"></div>
      ${asset.lifecycleStatus === 'pending_verification' ? '<button class="btn btn-gold" id="asset-verify" data-requires="asset.verify">Verify asset</button>' : ''}
      <button class="btn btn-ghost" id="asset-close">Close</button>
      <button class="btn btn-primary" id="asset-edit" data-requires="asset.edit">Edit</button>`,
  });

  document.querySelectorAll('.tab-nav').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-nav').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ['overview', 'relationships', 'history', 'discovery'].forEach((t) => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? '' : 'none';
    });
  }));

  renderOverviewTab(asset);
  renderRelationshipsTab(asset);
  renderHistoryTab(asset);
  renderDiscoveryTab(asset);

  document.getElementById('asset-close').addEventListener('click', close);
  document.getElementById('asset-edit').addEventListener('click', () => { close(); openAssetDrawer(asset); });
  document.getElementById('asset-verify')?.addEventListener('click', async () => {
    await updateDocById(COLLECTIONS.ASSETS, asset.id, { lifecycleStatus: 'verified', scopeStatus: asset.scopeStatus || 'pending_review' });
    await logAudit(AUDIT_ACTIONS.ASSET_VERIFIED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'asset', targetId: asset.id, summary: `Verified asset ${asset.name}` });
    toast('Asset verified', asset.name, 'success');
    close(); await loadAssets();
  });
  document.getElementById('asset-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete asset?', message: `This permanently removes "${asset.name}" from the inventory. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteDocById(COLLECTIONS.ASSETS, asset.id);
    await logAudit(AUDIT_ACTIONS.ASSET_DELETED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'asset', targetId: asset.id, summary: `Deleted asset ${asset.name}` });
    toast('Asset deleted', asset.name, 'success');
    close(); await loadAssets();
  });
}

function renderOverviewTab(asset) {
  document.getElementById('tab-overview').innerHTML = `
    <div class="kv-row"><span class="k">Type</span><span class="v">${humanize(asset.assetType)}</span></div>
    <div class="kv-row"><span class="k">Lifecycle</span><span class="v">${statusBadge(asset.lifecycleStatus || 'discovered', LIFECYCLE_BADGE)}</span></div>
    <div class="kv-row"><span class="k">Scope status</span><span class="v">${statusBadge(asset.scopeStatus || 'pending_review', SCOPE_BADGE)}</span></div>
    <div class="kv-row"><span class="k">Environment</span><span class="v">${humanize(asset.environment || '—')}</span></div>
    <div class="kv-row"><span class="k">Criticality</span><span class="v">${humanize(asset.businessCriticality || '—')}</span></div>
    <div class="kv-row"><span class="k">Owner</span><span class="v">${escapeHtml(asset.ownerEmail || '—')}</span></div>
    <div class="kv-row"><span class="k">Hostname / IP</span><span class="v cell-mono">${escapeHtml(asset.hostname || '—')}</span></div>
    <div class="kv-row"><span class="k">Created</span><span class="v">${fmtDateTime(asset.createdAt)} by ${escapeHtml(asset.createdBy || '—')}</span></div>
    <div class="kv-row"><span class="k">Last updated</span><span class="v">${fmtDateTime(asset.updatedAt)}</span></div>
    ${asset.tags?.length ? `<div style="margin-top:12px">${asset.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    ${asset.description ? `<div class="divider"></div><p style="font-size:12.5px;color:var(--text-secondary);line-height:1.6">${escapeHtml(asset.description)}</p>` : ''}
    ${!can('asset.verify') && asset.scopeStatus !== 'in_scope' ? '<div class="divider"></div><div class="lock-note"><svg viewBox="0 0 20 20" fill="none"><path d="M5 9V6a5 5 0 0110 0v3m-11 0h12v8H4V9z" stroke="currentColor" stroke-width="1.4"/></svg>This asset is not yet authorized for active testing. Appearing in the inventory does not grant scan authorization.</div>' : ''}
  `;
}

async function renderRelationshipsTab(asset) {
  const el = document.getElementById('tab-relationships');
  loadingState(el, 'Loading relationships…');
  const { docs } = await listDocs(COLLECTIONS.ASSET_RELATIONSHIPS, { filters: [['fromAssetId', '==', asset.id]], pageSize: 100 });
  el.innerHTML = `
    <div class="toolbar" style="margin-bottom:10px"><div class="spacer"></div><button class="btn btn-sm btn-ghost" id="add-rel" data-requires="asset.edit">+ Add relationship</button></div>
    ${docs.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Relationship</th><th>Related asset</th></tr></thead><tbody>
      ${docs.map((r) => `<tr><td>${humanize(r.relationshipType)}</td><td class="cell-mono">${escapeHtml(r.toAssetName || r.toAssetId)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="state-block" style="padding:28px"><p>No relationships recorded for this asset.</p></div>'}`;
  document.getElementById('add-rel').addEventListener('click', () => openAddRelationshipModal(asset));
}

function openAddRelationshipModal(asset) {
  const others = state.all.filter((a) => a.id !== asset.id);
  const { close } = openModal({
    title: 'Add asset relationship',
    bodyHtml: `
      <div class="form-grid single">
        <div class="field"><label>Relationship type</label><select class="input" id="rel-type">${RELATIONSHIP_TYPES.map((t) => `<option value="${t}">${humanize(t)}</option>`).join('')}</select></div>
        <div class="field"><label>Related asset</label><select class="input" id="rel-target">${others.map((o) => `<option value="${o.id}" data-name="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('')}</select></div>
      </div>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="rel-save">Add</button>`,
  });
  document.querySelector('.overlay .modal [data-cancel]').addEventListener('click', close);
  document.getElementById('rel-save').addEventListener('click', async () => {
    const targetSel = document.getElementById('rel-target');
    const toAssetName = targetSel.options[targetSel.selectedIndex]?.dataset.name;
    await createDoc(COLLECTIONS.ASSET_RELATIONSHIPS, {
      fromAssetId: asset.id, fromAssetName: asset.name,
      toAssetId: targetSel.value, toAssetName,
      relationshipType: document.getElementById('rel-type').value,
    });
    toast('Relationship added', '', 'success');
    close();
    openAssetDetail(asset.id);
  });
}

async function renderHistoryTab(asset) {
  const el = document.getElementById('tab-history');
  loadingState(el, 'Loading history…');
  const { docs } = await listDocs(COLLECTIONS.ASSET_HISTORY, { filters: [['parentId', '==', asset.id]], pageSize: 100, sortBy: 'createdAt', sortDir: 'desc' });
  if (!docs.length) { emptyState(el, { icon: 'inbox', title: 'No history yet', message: 'Changes to this asset will appear here.' }); return; }
  el.innerHTML = `<div class="timeline">
    ${docs.map((h, i) => `
      <div class="timeline-item">
        <div class="dot-col"><div class="dot"></div>${i < docs.length - 1 ? '<div class="line"></div>' : ''}</div>
        <div class="tcontent"><strong>${humanize(h.action)}</strong> by ${escapeHtml(h.actorEmail || 'system')}
          <div class="meta">${fmtDateTime(h.createdAt)}</div></div>
      </div>`).join('')}
  </div>`;
}

function renderDiscoveryTab(asset) {
  const el = document.getElementById('tab-discovery');
  el.innerHTML = `
    <div class="card card-pad" style="margin-bottom:12px">
      <h4 style="font-size:13px;margin-bottom:6px">Passive discovery</h4>
      <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">DNS records, certificate-transparency data and public technology fingerprints from authorized public sources. Read-only — no interaction with the target.</p>
      <button class="btn btn-sm btn-primary" id="run-passive" data-requires="discovery.passive.run">Run passive discovery</button>
      <div id="passive-result" style="margin-top:12px"></div>
    </div>
    <div class="card card-pad">
      <h4 style="font-size:13px;margin-bottom:6px">Active discovery</h4>
      <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">DNS enumeration, hostname verification and controlled port/service discovery. Requires admin approval and routes through the orchestration/approval pipeline — never executes directly from this screen.</p>
      <button class="btn btn-sm btn-ghost" id="request-active" data-requires="discovery.active.request">Request active discovery</button>
      <div class="lock-note" style="margin-top:10px">
        <svg viewBox="0 0 20 20" fill="none"><path d="M5 9V6a5 5 0 0110 0v3m-11 0h12v8H4V9z" stroke="currentColor" stroke-width="1.4"/></svg>
        Active discovery never runs automatically. A request here only creates an approval-gated job; nothing executes until an admin approves it under Attack Surface → Pending jobs.
      </div>
    </div>`;

  document.getElementById('run-passive').addEventListener('click', async () => {
    const btn = document.getElementById('run-passive');
    const resEl = document.getElementById('passive-result');
    btn.disabled = true; btn.textContent = 'Running…';
    loadingState(resEl, 'Querying DNS and certificate-transparency sources…');
    try {
      const result = await api.runPassiveDiscovery({ assetId: asset.id });
      await logAudit(AUDIT_ACTIONS.DISCOVERY_PASSIVE_RUN, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'asset', targetId: asset.id, summary: `Passive discovery run for ${asset.name}` });
      resEl.innerHTML = `<pre class="mono" style="font-size:11px;background:var(--bg-base);padding:12px;border-radius:8px;overflow:auto;max-height:240px">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
      toast('Passive discovery complete', '', 'success');
    } catch (err) {
      errorState(resEl, { message: err.message });
    } finally {
      btn.disabled = false; btn.textContent = 'Run passive discovery';
    }
  });

  document.getElementById('request-active').addEventListener('click', async () => {
    try {
      await api.requestActiveDiscovery({ assetId: asset.id, checks: ['dns_enum', 'hostname_verify', 'port_discovery'] });
      await logAudit(AUDIT_ACTIONS.DISCOVERY_ACTIVE_REQUESTED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'asset', targetId: asset.id, summary: `Active discovery requested for ${asset.name}` });
      toast('Active discovery requested', 'Awaiting admin approval before execution.', 'success');
    } catch (err) {
      toast('Request failed', err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------- Bulk import
function openBulkImportModal() {
  const { close } = openModal({
    title: 'Bulk import assets',
    width: '600px',
    bodyHtml: `
      <p style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:12px">
        Upload a CSV with columns: <code class="mono">${CSV_TEMPLATE_HEADERS.join(', ')}</code>.
        Need a starting point? <a href="#" id="dl-template">Download template</a>.
      </p>
      <input type="file" id="csv-file" accept=".csv" class="input" />
      <div id="csv-preview" style="margin-top:14px"></div>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="csv-import-btn" disabled>Import 0 assets</button>`,
  });
  document.querySelector('.overlay .modal [data-cancel]').addEventListener('click', close);

  document.getElementById('dl-template').addEventListener('click', (e) => {
    e.preventDefault();
    downloadCsv('ccdi-asset-import-template.csv', [{ name: 'app.example.com', assetType: 'website', ownerEmail: 'owner@example.com', environment: 'production', businessCriticality: 'high', tags: 'external, customer-facing', description: '' }], CSV_TEMPLATE_HEADERS);
  });

  let parsedRecords = [];
  document.getElementById('csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const { records } = parseCsv(text);
    parsedRecords = records.filter((r) => r.name);
    const previewEl = document.getElementById('csv-preview');
    const importBtn = document.getElementById('csv-import-btn');
    importBtn.textContent = `Import ${parsedRecords.length} assets`;
    importBtn.disabled = parsedRecords.length === 0;
    if (!parsedRecords.length) {
      previewEl.innerHTML = '<p style="font-size:12px;color:var(--sev-critical)">No valid rows found (a "name" column is required).</p>';
      return;
    }
    previewEl.innerHTML = `
      <div class="table-wrap" style="max-height:220px;overflow:auto">
        <table class="data-table"><thead><tr>${CSV_TEMPLATE_HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${parsedRecords.slice(0, 12).map((r) => `<tr>${CSV_TEMPLATE_HEADERS.map((h) => `<td class="cell-muted">${escapeHtml(r[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </div>
      ${parsedRecords.length > 12 ? `<p style="font-size:11px;color:var(--text-tertiary);margin-top:6px">+ ${parsedRecords.length - 12} more rows</p>` : ''}`;
  });

  document.getElementById('csv-import-btn').addEventListener('click', async () => {
    if (!parsedRecords.length) return;
    const btn = document.getElementById('csv-import-btn');
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const payloads = parsedRecords.map((r) => ({
        name: r.name.trim(),
        assetType: ASSET_TYPES.includes(r.assetType) ? r.assetType : 'hostname',
        ownerEmail: r.ownerEmail || '',
        environment: ENVIRONMENTS.includes(r.environment) ? r.environment : 'production',
        businessCriticality: CRITICALITY.includes(r.businessCriticality) ? r.businessCriticality : 'medium',
        tags: (r.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
        description: r.description || '',
        lifecycleStatus: 'discovered',
        scopeStatus: 'pending_review',
      }));
      const ids = await batchCreate(COLLECTIONS.ASSETS, payloads);
      await logAudit(AUDIT_ACTIONS.ASSET_IMPORTED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, summary: `Bulk imported ${ids.length} assets`, metadata: { count: ids.length } });
      toast('Import complete', `${ids.length} assets added as "Discovered / Pending review".`, 'success');
      close();
      await loadAssets();
    } catch (err) {
      toast('Import failed', err.message, 'error');
      btn.disabled = false; btn.textContent = `Import ${parsedRecords.length} assets`;
    }
  });
}

function exportCsv() {
  if (!state.filtered.length) { toast('Nothing to export', 'No assets match the current filters.', 'warn'); return; }
  const headers = ['name', 'assetType', 'environment', 'businessCriticality', 'lifecycleStatus', 'scopeStatus', 'ownerEmail', 'hostname', 'tags', 'createdAt'];
  const records = state.filtered.map((a) => ({ ...a, tags: (a.tags || []).join('|') }));
  downloadCsv(`ccdi-asset-inventory-${Date.now()}.csv`, records, headers);
}
