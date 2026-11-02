/**
 * Shared renderer for the Website / Network / API security pages. Each is
 * the same shape: asset subset for that category, scan-profile request
 * form, scan history/approvals for that category, and findings detected
 * via that category's connectors. Category-specific extras (e.g. the API
 * inventory/schema manager) are injected via `extraSectionsHtml` /
 * `afterRender`.
 */
import { renderShell } from '../core/layout.js';
import { listDocs, COLLECTIONS } from '../core/data.js';
import {
  emptyState, loadingState, errorState, fmtDateTime, escapeHtml, humanize,
  severityBadge, statusBadge,
} from '../core/ui.js';
import { renderScanRequestForm } from './connectors/request-widget.js';
import { SCAN_STATUS_BADGE } from './connectors/constants.js';
import { FINDING_STATUS_BADGE } from './vulnerabilities/constants.js';

export function renderEnginePage({
  active, title, subtitle, category, assetTypeFilter, extraSectionsHtml = '', afterRender = null,
}) {
  renderShell({ active, title, subtitle });

  window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
    const el = detail.contentEl;
    el.innerHTML = `
      <div class="grid grid-2" style="margin-bottom:16px">
        <div id="request-form-slot"></div>
        <div class="card">
          <div class="card-header"><div><h3>Registered assets</h3><p>${humanize(category)} assets in scope for this engine</p></div><a href="assets.html" class="btn btn-ghost btn-sm">Manage inventory</a></div>
          <div class="table-wrap" id="engine-assets"></div>
        </div>
      </div>
      ${extraSectionsHtml}
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><div><h3>Assessment history</h3><p>Scan requests, approvals and execution status for this engine</p></div><a href="connectors.html" class="btn btn-ghost btn-sm">All connectors</a></div>
          <div class="table-wrap" id="engine-scans"></div>
        </div>
        <div class="card">
          <div class="card-header"><div><h3>Findings</h3><p>Vulnerabilities detected through this engine's connectors</p></div><a href="vulnerabilities.html" class="btn btn-ghost btn-sm">All findings</a></div>
          <div class="table-wrap" id="engine-findings"></div>
        </div>
      </div>`;

    const [assets, connectors, scans, findings] = await Promise.all([
      listDocs(COLLECTIONS.ASSETS, { pageSize: 500 }),
      listDocs(COLLECTIONS.CONNECTORS, { pageSize: 200 }),
      listDocs(COLLECTIONS.SCANS, { filters: [['category', '==', category]], pageSize: 200 }),
      listDocs(COLLECTIONS.FINDINGS, { pageSize: 500 }),
    ]);

    const scopedAssets = assets.docs.filter((a) => assetTypeFilter(a.assetType));
    renderScanRequestForm(document.getElementById('request-form-slot'), { category, assets: scopedAssets, connectors: connectors.docs });
    renderAssetTable(scopedAssets);
    renderScanTable(scans.docs);
    renderFindingsTable(findings.docs.filter((f) => scopedAssets.some((a) => a.id === f.affectedAsset)));

    if (afterRender) afterRender({ contentEl: el, assets: scopedAssets, connectors: connectors.docs });
  });
}

function renderAssetTable(assets) {
  const el = document.getElementById('engine-assets');
  if (!assets.length) { emptyState(el, { title: 'No assets registered', message: 'Register assets of this type from the Asset Inventory page.' }); return; }
  el.innerHTML = `<table class="data-table"><tbody>
    ${assets.slice(0, 8).map((a) => `<tr onclick="location.href='assets.html'"><td><strong>${escapeHtml(a.name)}</strong></td><td class="cell-muted">${humanize(a.assetType)}</td><td class="cell-muted">${humanize(a.scopeStatus || 'pending_review')}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderScanTable(scans) {
  const el = document.getElementById('engine-scans');
  if (!scans.length) { emptyState(el, { title: 'No assessments yet', message: 'Submit a request above to begin.' }); return; }
  el.innerHTML = `<table class="data-table"><tbody>
    ${scans.slice(0, 10).map((s) => `<tr onclick="location.href='connectors.html'"><td>${statusBadge(s.status, SCAN_STATUS_BADGE)}</td><td><strong>${escapeHtml(s.assetName || '—')}</strong></td><td class="cell-muted">${escapeHtml(s.profileName || '—')}</td><td class="cell-muted">${fmtDateTime(s.createdAt)}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderFindingsTable(findings) {
  const el = document.getElementById('engine-findings');
  if (!findings.length) { emptyState(el, { title: 'No findings yet', message: 'Findings from imported, authorized scan results will appear here.' }); return; }
  el.innerHTML = `<table class="data-table"><tbody>
    ${findings.slice(0, 10).map((f) => `<tr onclick="location.href='vulnerabilities.html?id=${f.id}'"><td>${severityBadge(f.severity)}</td><td><strong>${escapeHtml(f.title)}</strong></td><td>${statusBadge(f.status || 'new', FINDING_STATUS_BADGE)}</td></tr>`).join('')}
  </tbody></table>`;
}
