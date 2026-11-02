/**
 * CINTEXA CCDI — Role-Based Access Control (client-side guard)
 * -----------------------------------------------------------------------
 * IMPORTANT: this module is a UX convenience only. It hides controls the
 * current user should not see and short-circuits obviously-disallowed
 * actions before a round-trip. It is NOT a security boundary — the actual
 * enforcement lives in firestore/firestore.rules and functions/src, which
 * re-check role + tenant membership on every read/write. Never remove the
 * server-side checks because the UI already hides the button.
 * -----------------------------------------------------------------------
 */

export const ROLES = {
  OWNER: 'owner', // full tenant control, billing, user management
  ADMIN: 'admin', // manage assets, approve scans/engagements, manage users
  ANALYST: 'analyst', // triage findings, manage remediation, run passive discovery
  TESTER: 'tester', // execute approved assessments, submit findings/evidence
  VIEWER: 'viewer', // read-only across the tenant
};

export const ROLE_RANK = {
  [ROLES.OWNER]: 5,
  [ROLES.ADMIN]: 4,
  [ROLES.ANALYST]: 3,
  [ROLES.TESTER]: 2,
  [ROLES.VIEWER]: 1,
};

/**
 * Permission matrix. Each capability maps to the minimum role rank
 * required. Keep this in sync with functions/src/lib/rbac.js (server copy)
 * and firestore/firestore.rules (`hasRole` helper).
 */
export const PERMISSIONS = {
  'asset.create': ROLES.ANALYST,
  'asset.edit': ROLES.ANALYST,
  'asset.delete': ROLES.ADMIN,
  'asset.verify': ROLES.ADMIN,
  'asset.bulk_import': ROLES.ANALYST,
  'discovery.passive.run': ROLES.ANALYST,
  'discovery.active.request': ROLES.ANALYST,
  'discovery.active.approve': ROLES.ADMIN,

  'attacksurface.view': ROLES.VIEWER,
  'attacksurface.manage': ROLES.ANALYST,

  'vuln.create': ROLES.ANALYST,
  'vuln.edit': ROLES.ANALYST,
  'vuln.delete': ROLES.ADMIN,
  'vuln.status_change': ROLES.ANALYST,
  'vuln.accept_risk': ROLES.ADMIN,
  'vuln.assign': ROLES.ANALYST,

  'connector.view': ROLES.ANALYST,
  'connector.manage': ROLES.ADMIN,

  'scan.request': ROLES.ANALYST,
  'scan.approve': ROLES.ADMIN,
  'scan.cancel': ROLES.ADMIN,
  'scan.result_import': ROLES.TESTER,

  'api_inventory.manage': ROLES.ANALYST,

  'pentest.create': ROLES.ANALYST,
  'pentest.authorize': ROLES.OWNER,
  'pentest.approve': ROLES.ADMIN,
  'pentest.execute': ROLES.TESTER,
  'pentest.cancel': ROLES.ADMIN,

  'report.generate': ROLES.VIEWER,
  'report.export': ROLES.VIEWER,

  'user.manage': ROLES.OWNER,
  'tenant.manage': ROLES.OWNER,
  'audit.view': ROLES.ADMIN,
};

let currentUserRole = null;

export function setCurrentRole(role) {
  currentUserRole = role;
}

export function getCurrentRole() {
  return currentUserRole;
}

export function can(permission) {
  if (!currentUserRole) return false;
  const required = PERMISSIONS[permission];
  if (!required) {
    console.warn(`[RBAC] Unknown permission key: ${permission}`);
    return false;
  }
  return (ROLE_RANK[currentUserRole] || 0) >= (ROLE_RANK[required] || 99);
}

export function requireRole(minRole) {
  return (ROLE_RANK[currentUserRole] || 0) >= (ROLE_RANK[minRole] || 99);
}

/** Apply `data-requires="permission.key"` hiding across the current DOM. */
export function applyRbacToDom(root = document) {
  root.querySelectorAll('[data-requires]').forEach((el) => {
    const perm = el.getAttribute('data-requires');
    if (!can(perm)) {
      el.setAttribute('disabled', 'true');
      el.classList.add('rbac-hidden');
      el.style.display = 'none';
    } else {
      el.classList.remove('rbac-hidden');
      el.style.display = '';
      el.removeAttribute('disabled');
    }
  });
}

export const ROLE_LABELS = {
  [ROLES.OWNER]: 'Owner',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.ANALYST]: 'Analyst',
  [ROLES.TESTER]: 'Tester',
  [ROLES.VIEWER]: 'Viewer',
};
