/**
 * CINTEXA CCDI — Shared UI primitives
 * Toasts, modals/drawers, loading/empty/error state renderers, confirm
 * dialogs. Kept dependency-free so every module can import it directly.
 */

let toastRoot = null;
function ensureToastRoot() {
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toast-stack';
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

const ICONS = {
  success: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><circle cx="10" cy="10" r="9" stroke="#37c6a0" stroke-width="1.5"/><path d="M6 10.5l2.5 2.5L14 7.5" stroke="#37c6a0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><circle cx="10" cy="10" r="9" stroke="#f43f5e" stroke-width="1.5"/><path d="M7 7l6 6M13 7l-6 6" stroke="#f43f5e" stroke-width="1.6" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M10 2l9 16H1L10 2z" stroke="#f3c13a" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8v4" stroke="#f3c13a" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.5" r=".9" fill="#f3c13a"/></svg>',
  info: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><circle cx="10" cy="10" r="9" stroke="#22d3ee" stroke-width="1.5"/><path d="M10 9v5M10 6.2v.1" stroke="#22d3ee" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

export function toast(title, msg = '', type = 'info', duration = 4200) {
  const root = ensureToastRoot();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${ICONS[type] || ICONS.info}<div><div class="t-title">${escapeHtml(title)}</div>${msg ? `<div class="t-msg">${escapeHtml(msg)}</div>` : ''}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Renders a modal with given inner HTML; returns { el, close }. */
export function openModal({ title, bodyHtml, footerHtml = '', onClose = () => {}, width = null, center = true }) {
  const overlay = document.createElement('div');
  overlay.className = `overlay${center ? ' center' : ''}`;
  overlay.innerHTML = `
    <div class="modal" style="${width ? `width:${width}` : ''}">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn" data-close aria-label="Close">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    onClose();
  };
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  });
  return { el: overlay, close };
}

/** Renders a right-side drawer; returns { el, close }. */
export function openDrawer({ title, subtitle = '', bodyHtml, footerHtml = '', onClose = () => {} }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-header">
        <div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p style="margin:3px 0 0;font-size:12px;color:var(--text-tertiary)">${escapeHtml(subtitle)}</p>` : ''}</div>
        <button class="icon-btn" data-close aria-label="Close">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="drawer-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="drawer-footer">${footerHtml}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    onClose();
  };
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  return { el: overlay, close };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const { close } = openModal({
      title,
      bodyHtml: `<p style="color:var(--text-secondary);font-size:13px;line-height:1.6">${escapeHtml(message)}</p>`,
      footerHtml: `
        <button class="btn btn-ghost" data-cancel>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(confirmLabel)}</button>`,
      onClose: () => resolve(false),
    });
    document.querySelector('.overlay .modal [data-cancel]')?.addEventListener('click', () => {
      resolve(false);
      close();
    });
    document.querySelector('.overlay .modal [data-ok]')?.addEventListener('click', () => {
      resolve(true);
      close();
    });
  });
}

export function emptyState(container, { icon = 'inbox', title = 'Nothing here yet', message = '', actionHtml = '' }) {
  container.innerHTML = `
    <div class="state-block">
      ${stateIcon(icon)}
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(message)}</p>
      ${actionHtml}
    </div>`;
}

export function loadingState(container, label = 'Loading…') {
  container.innerHTML = `
    <div class="state-block">
      <div class="spinner"></div>
      <p>${escapeHtml(label)}</p>
    </div>`;
}

export function errorState(container, { title = 'Something went wrong', message = '', retry = null }) {
  container.innerHTML = `
    <div class="state-block">
      ${stateIcon('alert')}
      <h4 style="color:var(--sev-critical)">${escapeHtml(title)}</h4>
      <p>${escapeHtml(message)}</p>
      ${retry ? '<button class="btn btn-primary btn-sm" data-retry>Try again</button>' : ''}
    </div>`;
  if (retry) container.querySelector('[data-retry]').addEventListener('click', retry);
}

export function accessDeniedState(container, { message = 'You do not have permission to view this page.' } = {}) {
  container.innerHTML = `
    <div class="access-denied">
      ${stateIcon('lock')}
      <h3>Access denied</h3>
      <p style="color:var(--text-tertiary);max-width:380px;font-size:13px">${escapeHtml(message)}</p>
    </div>`;
}

function stateIcon(kind) {
  const paths = {
    inbox: '<path d="M4 13l3-9h10l3 9M4 13v5a1 1 0 001 1h14a1 1 0 001-1v-5M4 13h5a2 2 0 002 2h2a2 2 0 002-2h5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
    alert: '<path d="M12 2L22 20H2L12 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 9v5M12 17v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" stroke-width="1.4"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none">${paths[kind] || paths.inbox}</svg>`;
}

export function debounce(fn, wait = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso.toDate ? iso.toDate() : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso.toDate ? iso.toDate() : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso.toDate ? iso.toDate() : iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational'];
export function severityBadge(sev) {
  const s = (sev || 'informational').toLowerCase();
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  const cls = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', informational: 'info' }[s] || 'info';
  return `<span class="badge badge-${cls}">${label}</span>`;
}

export function statusBadge(status, map = {}) {
  const cls = map[status] || 'neutral';
  return `<span class="badge badge-${cls}">${escapeHtml(humanize(status))}</span>`;
}

export function humanize(str) {
  if (!str) return '';
  return String(str)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
