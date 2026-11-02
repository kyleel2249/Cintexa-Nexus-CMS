import { renderShell } from '../core/layout.js';
import { listDocs, COLLECTIONS } from '../core/data.js';
import {
  emptyState, loadingState, errorState, fmtDateTime, escapeHtml, humanize, debounce,
} from '../core/ui.js';
import { downloadCsv } from './assets/csv.js';

renderShell({ active: 'audit', title: 'Audit Log', subtitle: 'Append-only record of sensitive actions across the tenant', requireRole: 'admin' });

let allEntries = [];

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  detail.contentEl.innerHTML = `
    <div class="toolbar">
      <div class="search-box" style="min-width:280px">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M14 14l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input type="text" id="audit-search" placeholder="Search by action, actor, target…" />
      </div>
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="btn-export-audit">Export CSV</button>
    </div>
    <div class="card"><div class="table-wrap" id="audit-table"></div></div>`;

  document.getElementById('audit-search').addEventListener('input', debounce((e) => render(e.target.value.toLowerCase()), 200));
  document.getElementById('btn-export-audit').addEventListener('click', () => {
    if (!allEntries.length) return;
    downloadCsv(`ccdi-audit-log-${Date.now()}.csv`, allEntries, ['action', 'actorEmail', 'targetType', 'targetId', 'summary', 'createdAt']);
  });

  await load();
});

async function load() {
  const wrap = document.getElementById('audit-table');
  loadingState(wrap, 'Loading audit log…');
  try {
    const { docs } = await listDocs(COLLECTIONS.AUDIT_LOG, { pageSize: 500, sortBy: 'createdAt', sortDir: 'desc' });
    allEntries = docs;
    render('');
  } catch (err) {
    errorState(wrap, { message: err.message, retry: load });
  }
}

function render(query) {
  const wrap = document.getElementById('audit-table');
  let rows = allEntries;
  if (query) {
    rows = rows.filter((e) => [e.action, e.actorEmail, e.targetType, e.targetId, e.summary].filter(Boolean).join(' ').toLowerCase().includes(query));
  }
  if (!rows.length) { emptyState(wrap, { title: 'No audit entries', message: 'Sensitive actions across every module will be recorded here automatically.' }); return; }
  wrap.innerHTML = `<table class="data-table"><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Summary</th><th>Timestamp</th></tr></thead><tbody>
    ${rows.map((e) => `
      <tr>
        <td><span class="badge badge-cyan">${humanize(e.action || '—')}</span></td>
        <td class="cell-muted">${escapeHtml(e.actorEmail || 'system')}</td>
        <td class="cell-muted">${e.targetType ? `${humanize(e.targetType)}` : '—'}</td>
        <td>${escapeHtml(e.summary || '')}</td>
        <td class="cell-muted">${fmtDateTime(e.createdAt || e.clientTimestamp)}</td>
      </tr>`).join('')}
  </tbody></table>`;
}
