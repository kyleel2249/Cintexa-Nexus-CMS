/**
 * CINTEXA CCDI — App shell layout
 * -----------------------------------------------------------------------
 * Renders sidebar nav + topbar into every module page, wires auth guard,
 * RBAC visibility, tenant pill, and the logout action. Each page calls
 * `renderShell({ active: 'assets', title, subtitle })` once on load, then
 * renders its own content into `#page-content`.
 * -----------------------------------------------------------------------
 */

import { onAuthReady, logout, CURRENT } from './auth.js';
import { getActiveTenant } from './tenant.js';
import { applyRbacToDom, ROLE_LABELS, getCurrentRole } from './rbac.js';
import { toast, accessDeniedState } from './ui.js';

const NAV = [
  {
    group: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'grid' }],
  },
  {
    group: 'Exposure',
    items: [
      { key: 'assets', label: 'Asset Inventory', href: 'assets.html', icon: 'server' },
      { key: 'attack-surface', label: 'Attack Surface', href: 'attack-surface.html', icon: 'radar' },
    ],
  },
  {
    group: 'Assessment',
    items: [
      { key: 'vulnerabilities', label: 'Vulnerabilities', href: 'vulnerabilities.html', icon: 'bug' },
      { key: 'website-security', label: 'Website Security', href: 'website-security.html', icon: 'globe' },
      { key: 'network-security', label: 'Network Security', href: 'network-security.html', icon: 'network' },
      { key: 'api-security', label: 'API Security', href: 'api-security.html', icon: 'api' },
      { key: 'pentest', label: 'Penetration Testing', href: 'pentest.html', icon: 'target' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { key: 'connectors', label: 'Connectors', href: 'connectors.html', icon: 'plug' },
      { key: 'reports', label: 'Reports', href: 'reports.html', icon: 'file' },
      { key: 'audit', label: 'Audit Log', href: 'audit.html', icon: 'shield' },
      { key: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings' },
    ],
  },
];

const ICONS = {
  grid: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z',
  server: 'M4 5h16v5H4V5zm0 9h16v5H4v-5zM7 7.5h.01M7 16.5h.01',
  radar: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4a5 5 0 100 10 5 5 0 000-10zm0 3v2l2 1',
  bug: 'M9 8h6M7 12h10M8 20l-2-2M16 20l2-2M12 8a4 4 0 014 4v4a4 4 0 01-8 0v-4a4 4 0 014-4zM12 5V3M9 5.5L7.5 4M15 5.5L16.5 4',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3C9.5 5.7 9.5 18.3 12 21',
  network: 'M12 3v4M6 17l4-4M18 17l-4-4M4 19h4v2H4zM16 19h4v2h-4zM10 19h4v2h-4zM12 3a2 2 0 100 4 2 2 0 000-4z',
  api: 'M8 4H4v6h4V4zm12 0h-4v6h4V4zM8 14H4v6h4v-6zm12 0h-4v6h4v-6zM8 7h8M8 17h8M12 10v4',
  target: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a5 5 0 100 10 5 5 0 000-10zm0 3a2 2 0 100 4 2 2 0 000-4z',
  plug: 'M9 2v6M15 2v6M7 8h10v4a5 5 0 01-10 0V8zM12 17v5',
  file: 'M6 2h9l5 5v15H6V2zm9 0v5h5',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm8-3a7.97 7.97 0 00-.4-2.5l2-1.5-2-3.5-2.3.9a8 8 0 00-2.2-1.3L14.6 2H9.4l-.5 2.1a8 8 0 00-2.2 1.3l-2.3-.9-2 3.5 2 1.5A7.97 7.97 0 004 12c0 .9.14 1.7.4 2.5l-2 1.5 2 3.5 2.3-.9c.65.55 1.4 1 2.2 1.3l.5 2.1h5.2l.5-2.1a8 8 0 002.2-1.3l2.3.9 2-3.5-2-1.5c.26-.8.4-1.6.4-2.5z',
};

function icon(key) {
  const d = ICONS[key] || ICONS.grid;
  return `<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function renderShell({ active, title, subtitle = '', requireRole = null }) {
  const root = document.getElementById('app-shell');
  if (!root) throw new Error('renderShell: #app-shell not found in page HTML');

  root.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="brand-mark">CX</div>
        <div class="brand-text"><strong>CINTEXA</strong><span>CCDI · Phase 4</span></div>
      </div>
      <nav>
        ${NAV.map((g) => `
          <div class="nav-group">
            <div class="nav-label">${g.group}</div>
            ${g.items.map((item) => `
              <a class="nav-link ${item.key === active ? 'active' : ''}" href="${item.href}">
                ${icon(item.icon)}<span>${item.label}</span>
              </a>`).join('')}
          </div>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="tenant-pill" id="tenant-pill"><span class="dot"></span><span id="tenant-name">Loading tenant…</span></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="topbar-title">
          <h1>${title}</h1>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
        </div>
        <div class="topbar-actions">
          <div class="search-box">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M14 14l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <input type="text" placeholder="Search assets, findings, assessments…" id="global-search" />
          </div>
          <button class="icon-btn" id="mobile-nav-toggle" style="display:none">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
          <div class="user-chip" id="user-chip">
            <div class="avatar" id="user-avatar">–</div>
            <div style="text-align:left">
              <div style="font-size:12.5px;font-weight:600" id="user-name">—</div>
              <div style="font-size:10.5px;color:var(--text-tertiary)" id="user-role">—</div>
            </div>
          </div>
        </div>
      </header>
      <main class="content" id="page-content">
        <div class="state-block"><div class="spinner"></div><p>Loading…</p></div>
      </main>
    </div>`;

  const contentEl = document.getElementById('page-content');

  onAuthReady(({ user, profile }) => {
    if (!user || !profile) {
      window.location.href = 'login.html';
      return;
    }

    document.getElementById('user-name').textContent = profile.displayName || user.email;
    document.getElementById('user-role').textContent = ROLE_LABELS[profile.role] || profile.role;
    document.getElementById('user-avatar').textContent = (profile.displayName || user.email || '?').charAt(0).toUpperCase();
    const tenant = getActiveTenant();
    document.getElementById('tenant-name').textContent = tenant ? tenant.name : 'No tenant';

    document.getElementById('user-chip').addEventListener('click', async () => {
      if (confirm('Sign out of CINTEXA CCDI?')) {
        await logout();
        window.location.href = 'login.html';
      }
    });

    applyRbacToDom(document);

    if (requireRole && !hasMinRole(profile.role, requireRole)) {
      accessDeniedState(contentEl, {
        message: `This page requires the "${ROLE_LABELS[requireRole]}" role or higher. You are signed in as "${ROLE_LABELS[profile.role] || profile.role}".`,
      });
      window.dispatchEvent(new CustomEvent('ccdi:shell-denied'));
      return;
    }

    window.dispatchEvent(new CustomEvent('ccdi:shell-ready', { detail: { contentEl, profile, user } }));
  });

  return { contentEl };
}

function hasMinRole(role, min) {
  const rank = { owner: 5, admin: 4, analyst: 3, tester: 2, viewer: 1 };
  return (rank[role] || 0) >= (rank[min] || 99);
}

window.addEventListener('ccdi:toast', (e) => toast(e.detail.title, e.detail.msg, e.detail.type));
