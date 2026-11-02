import { renderShell } from '../core/layout.js';
import { listDocs, COLLECTIONS } from '../core/data.js';
import {
  toast, openModal, emptyState, loadingState, errorState, escapeHtml, humanize, fmtDate,
} from '../core/ui.js';
import { can, ROLES, ROLE_LABELS } from '../core/rbac.js';
import { getActiveTenant } from '../core/tenant.js';
import { CURRENT } from '../core/auth.js';
import { api } from '../core/api.js';
import { logAudit, AUDIT_ACTIONS } from '../core/audit.js';

renderShell({ active: 'settings', title: 'Settings', subtitle: 'Tenant information, user management and role assignment' });

window.addEventListener('ccdi:shell-ready', async ({ detail }) => {
  const tenant = getActiveTenant();
  detail.contentEl.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:20px">
      <div class="card card-pad">
        <h3 style="font-size:14.5px;margin-bottom:14px">Organization</h3>
        <div class="kv-row"><span class="k">Name</span><span class="v">${escapeHtml(tenant?.name || '—')}</span></div>
        <div class="kv-row"><span class="k">Tenant ID</span><span class="v cell-mono">${escapeHtml(tenant?.id || '—')}</span></div>
        <div class="kv-row"><span class="k">Plan</span><span class="v">${humanize(tenant?.plan || 'standard')}</span></div>
        <div class="kv-row"><span class="k">Created</span><span class="v">${fmtDate(tenant?.createdAt)}</span></div>
      </div>
      <div class="card card-pad">
        <h3 style="font-size:14.5px;margin-bottom:14px">Your account</h3>
        <div class="kv-row"><span class="k">Name</span><span class="v">${escapeHtml(CURRENT.profile?.displayName || '—')}</span></div>
        <div class="kv-row"><span class="k">Email</span><span class="v">${escapeHtml(CURRENT.user?.email || '—')}</span></div>
        <div class="kv-row"><span class="k">Role</span><span class="v">${ROLE_LABELS[CURRENT.profile?.role] || '—'}</span></div>
      </div>
    </div>

    <div class="toolbar"><h3 style="font-size:14.5px">Team members</h3><div class="spacer"></div>
      <button class="btn btn-primary" id="btn-invite" data-requires="user.manage">+ Invite user</button></div>
    <div class="card"><div class="table-wrap" id="user-table"></div></div>`;

  document.getElementById('btn-invite').addEventListener('click', openInviteModal);
  await loadUsers();
});

async function loadUsers() {
  const el = document.getElementById('user-table');
  loadingState(el, 'Loading team…');
  try {
    const { docs } = await listDocs(COLLECTIONS.USERS, { pageSize: 200 });
    if (!docs.length) { emptyState(el, { title: 'No team members found', message: '' }); return; }
    el.innerHTML = `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
      ${docs.map((u) => `
        <tr>
          <td><strong>${escapeHtml(u.displayName || '—')}</strong></td>
          <td class="cell-muted">${escapeHtml(u.email || '—')}</td>
          <td>${can('user.manage') && u.uid !== CURRENT.user?.uid ? `
            <select class="input" style="width:auto;padding:5px 8px" data-role-select="${u.id}">
              ${Object.values(ROLES).map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
            </select>` : `<span class="badge badge-neutral">${ROLE_LABELS[u.role] || u.role}</span>`}
          </td>
          <td></td>
        </tr>`).join('')}
    </tbody></table>`;
    el.querySelectorAll('[data-role-select]').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api.updateUserRole({ userId: sel.dataset.roleSelect, role: sel.value });
        await logAudit(AUDIT_ACTIONS.USER_LOGIN, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'user', targetId: sel.dataset.roleSelect, summary: `Role changed to ${sel.value}` });
        toast('Role updated', '', 'success');
      } catch (err) {
        toast('Update failed', err.message, 'error');
      }
    }));
  } catch (err) {
    errorState(el, { message: err.message, retry: loadUsers });
  }
}

function openInviteModal() {
  const { close } = openModal({
    title: 'Invite team member',
    bodyHtml: `
      <div class="form-grid single">
        <div class="field"><label>Email</label><input class="input" id="inv-email" type="email" required /></div>
        <div class="field"><label>Role</label><select class="input" id="inv-role">${Object.values(ROLES).filter((r) => r !== ROLES.OWNER).map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join('')}</select></div>
      </div>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="inv-send">Send invite</button>`,
  });
  document.querySelector('.overlay .modal [data-cancel]').addEventListener('click', close);
  document.getElementById('inv-send').addEventListener('click', async () => {
    const email = document.getElementById('inv-email').value.trim();
    const role = document.getElementById('inv-role').value;
    if (!email) { toast('Email required', '', 'warn'); return; }
    try {
      await api.inviteUser({ email, role });
      toast('Invitation sent', email, 'success');
      close();
      loadUsers();
    } catch (err) {
      toast('Invite failed', err.message, 'error');
    }
  });
}
