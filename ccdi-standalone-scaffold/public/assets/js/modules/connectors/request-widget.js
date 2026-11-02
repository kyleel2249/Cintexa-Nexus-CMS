import { toast, escapeHtml, humanize } from '../../core/ui.js';
import { api } from '../../core/api.js';
import { logAudit, AUDIT_ACTIONS } from '../../core/audit.js';
import { CURRENT } from '../../core/auth.js';
import { SCAN_PROFILES } from './constants.js';

/**
 * Renders a "request assessment" form scoped to one engine category
 * (website | network | api). Submission always goes through
 * api.requestScan(), which creates a pending_approval scan record —
 * nothing executes from here. High-impact profiles are flagged as
 * requiring additional approval per the profile catalog.
 */
export function renderScanRequestForm(container, { category, assets, connectors }) {
  const categoryConnectors = connectors.filter((c) => c.category === category);
  container.innerHTML = `
    <div class="card card-pad">
      <h4 style="font-size:13px;margin-bottom:4px">Request assessment</h4>
      <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:14px">Submits to the approval pipeline — execution only happens after an admin approves and runs it through an authorized connector.</p>
      ${categoryConnectors.length === 0 ? `<div class="lock-note"><svg viewBox="0 0 20 20" fill="none"><path d="M10 2l8 15H2L10 2z" stroke="currentColor" stroke-width="1.4"/></svg>No ${humanize(category)} connectors are registered yet. <a href="connectors.html">Register one</a> before requesting an assessment.</div>` : `
      <form id="scan-req-form" class="form-grid single">
        <div class="field"><label>Target asset</label><select class="input" name="assetId" required>${assets.map((a) => `<option value="${a.id}" data-name="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Connector</label><select class="input" name="connectorId" required>${categoryConnectors.map((c) => `<option value="${c.id}" data-name="${escapeHtml(c.toolName)}">${escapeHtml(c.toolName)}</option>`).join('')}</select></div>
        <div class="field"><label>Scan profile</label><select class="input" name="profileId" required>${SCAN_PROFILES.map((p) => `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-approval="${p.requiresApproval}">${escapeHtml(p.name)}</option>`).join('')}</select></div>
        <div class="field" id="profile-impact-note"></div>
        <div class="field"><label>Justification</label><textarea class="input" name="justification" placeholder="Why this assessment is needed now…"></textarea></div>
        <button class="btn btn-primary btn-sm" type="submit" style="align-self:flex-start">Submit request</button>
      </form>`}
    </div>`;

  const form = document.getElementById('scan-req-form');
  if (!form) return;

  const updateImpactNote = () => {
    const sel = form.querySelector('[name="profileId"]');
    const opt = sel.options[sel.selectedIndex];
    const profile = SCAN_PROFILES.find((p) => p.id === sel.value);
    document.getElementById('profile-impact-note').innerHTML = profile
      ? `<span class="hint">Impact: ${escapeHtml(profile.impact)}${profile.requiresApproval ? ' — requires admin approval before execution.' : ' — no intrusive action, still logged and reviewable.'}</span>` : '';
  };
  form.querySelector('[name="profileId"]').addEventListener('change', updateImpactNote);
  updateImpactNote();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const assetSel = form.querySelector('[name="assetId"]');
    const connSel = form.querySelector('[name="connectorId"]');
    const profileSel = form.querySelector('[name="profileId"]');
    try {
      await api.requestScan({
        category,
        assetId: fd.get('assetId'),
        assetName: assetSel.options[assetSel.selectedIndex]?.dataset.name,
        connectorId: fd.get('connectorId'),
        connectorName: connSel.options[connSel.selectedIndex]?.dataset.name,
        profileId: fd.get('profileId'),
        profileName: profileSel.options[profileSel.selectedIndex]?.dataset.name,
        justification: fd.get('justification'),
      });
      await logAudit(AUDIT_ACTIONS.SCAN_REQUESTED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, summary: `${humanize(category)} scan requested`, metadata: { assetId: fd.get('assetId'), profileId: fd.get('profileId') } });
      toast('Request submitted', 'Awaiting approval before execution.', 'success');
      form.reset();
      updateImpactNote();
    } catch (err) {
      toast('Request failed', err.message, 'error');
    }
  });
}
