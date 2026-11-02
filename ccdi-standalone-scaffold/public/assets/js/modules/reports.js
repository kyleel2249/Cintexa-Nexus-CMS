import { renderShell } from '../core/layout.js';
import { listDocs, createDoc, COLLECTIONS } from '../core/data.js';
import {
  toast, emptyState, loadingState, errorState, fmtDateTime, escapeHtml, humanize,
} from '../core/ui.js';
import { getActiveTenant } from '../core/tenant.js';
import { CURRENT } from '../core/auth.js';
import { logAudit, AUDIT_ACTIONS } from '../core/audit.js';
import { downloadCsv } from './assets/csv.js';

const REPORT_TYPES = [
  { id: 'asset_inventory', label: 'Asset Inventory Report', collection: COLLECTIONS.ASSETS, columns: ['name', 'assetType', 'environment', 'businessCriticality', 'lifecycleStatus', 'scopeStatus', 'ownerEmail'] },
  { id: 'attack_surface', label: 'Attack Surface Report', collection: COLLECTIONS.ATTACK_SURFACE, columns: ['observationType', 'assetName', 'summary', 'riskLevel', 'createdAt'] },
  { id: 'vulnerability', label: 'Vulnerability Report', collection: COLLECTIONS.FINDINGS, columns: ['title', 'severity', 'status', 'affectedAssetName', 'cveId', 'cvssScore', 'assignedOwner'] },
  { id: 'website_security', label: 'Website Security Report', collection: COLLECTIONS.SCANS, columns: ['assetName', 'profileName', 'status', 'createdAt'], filter: (d) => d.category === 'website' },
  { id: 'network_security', label: 'Network Assessment Report', collection: COLLECTIONS.SCANS, columns: ['assetName', 'profileName', 'status', 'createdAt'], filter: (d) => d.category === 'network' },
  { id: 'api_security', label: 'API Security Report', collection: COLLECTIONS.SCANS, columns: ['assetName', 'profileName', 'status', 'createdAt'], filter: (d) => d.category === 'api' },
  { id: 'pentest', label: 'Penetration Testing Report', collection: COLLECTIONS.PENTEST_ENGAGEMENTS, columns: ['name', 'clientOrg', 'status', 'authorizedTarget', 'startDate', 'expiryDate'] },
];

renderShell({ active: 'reports', title: 'Reports', subtitle: 'Generate and export assessment reports across all Phase 4 security engines' });

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  detail.contentEl.innerHTML = `
    <div class="grid grid-3" id="report-cards"></div>
    <div class="card" style="margin-top:20px">
      <div class="card-header"><div><h3>Generated reports</h3><p>Report generation is audited; files are produced client-side from live, validated tenant data</p></div></div>
      <div class="table-wrap" id="report-log"></div>
    </div>`;

  document.getElementById('report-cards').innerHTML = REPORT_TYPES.map((r) => `
    <div class="card card-pad">
      <h4 style="font-size:13.5px;margin-bottom:6px">${r.label}</h4>
      <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:14px">Export the current tenant's ${humanize(r.id).toLowerCase()} data.</p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-ghost" data-report="${r.id}" data-fmt="csv">CSV</button>
        <button class="btn btn-sm btn-ghost" data-report="${r.id}" data-fmt="xlsx">XLSX</button>
        <button class="btn btn-sm btn-primary" data-report="${r.id}" data-fmt="pdf">PDF</button>
      </div>
    </div>`).join('');

  document.querySelectorAll('[data-report]').forEach((btn) => btn.addEventListener('click', () => generateReport(btn.dataset.report, btn.dataset.fmt)));
  await loadReportLog();
});

async function generateReport(typeId, format) {
  const type = REPORT_TYPES.find((t) => t.id === typeId);
  const tenant = getActiveTenant();
  try {
    const { docs } = await listDocs(type.collection, { pageSize: 1000 });
    const rows = type.filter ? docs.filter(type.filter) : docs;
    if (!rows.length) {
      toast('Nothing to export', 'No data available for this report yet.', 'warn');
      return;
    }
    const filenameBase = `ccdi-${typeId}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      downloadCsv(`${filenameBase}.csv`, rows, type.columns);
    } else if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => pick(r, type.columns)));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, type.label.slice(0, 30));
      XLSX.writeFile(wb, `${filenameBase}.xlsx`);
    } else if (format === 'pdf') {
      generatePdf(type, rows, tenant, filenameBase);
    }

    const reportId = await createDoc(COLLECTIONS.REPORTS, {
      reportType: typeId, format, rowCount: rows.length, generatedByEmail: CURRENT.user?.email,
    });
    await logAudit(AUDIT_ACTIONS.REPORT_GENERATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'report', targetId: reportId, summary: `Generated ${type.label} (${format.toUpperCase()})`, metadata: { rowCount: rows.length } });
    toast('Report generated', `${type.label} · ${format.toUpperCase()} · ${rows.length} records`, 'success');
    loadReportLog();
  } catch (err) {
    toast('Report generation failed', err.message, 'error');
  }
}

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => { out[k] = obj[k] ?? ''; });
  return out;
}

function generatePdf(type, rows, tenant, filenameBase) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(16);
  doc.text('CINTEXA CCDI — ' + type.label, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Organization: ${tenant?.name || '—'}    Generated: ${new Date().toLocaleString()}    Records: ${rows.length}`, 14, 23);
  doc.text('Limitations: unverified findings are marked by status; this export reflects data present in the platform at generation time.', 14, 28);
  doc.autoTable({
    startY: 34,
    head: [type.columns.map((c) => humanize(c))],
    body: rows.map((r) => type.columns.map((c) => String(r[c] ?? ''))),
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [17, 25, 40] },
    theme: 'striped',
  });
  doc.save(`${filenameBase}.pdf`);
}

async function loadReportLog() {
  const el = document.getElementById('report-log');
  loadingState(el, 'Loading report history…');
  try {
    const { docs } = await listDocs(COLLECTIONS.REPORTS, { pageSize: 50, sortBy: 'createdAt', sortDir: 'desc' });
    if (!docs.length) { emptyState(el, { title: 'No reports generated yet', message: 'Generated reports are logged here for audit purposes.' }); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Report</th><th>Format</th><th>Records</th><th>Generated by</th><th>When</th></tr></thead><tbody>
      ${docs.map((r) => `<tr><td>${humanize(r.reportType)}</td><td class="cell-muted">${(r.format || '').toUpperCase()}</td><td class="cell-muted">${r.rowCount}</td><td class="cell-muted">${escapeHtml(r.generatedByEmail || '—')}</td><td class="cell-muted">${fmtDateTime(r.createdAt)}</td></tr>`).join('')}
    </tbody></table>`;
  } catch (err) {
    errorState(el, { message: err.message, retry: loadReportLog });
  }
}
