import { renderEnginePage } from './engine-page.js';
import { listDocs, createDoc, deleteDocById, COLLECTIONS } from '../core/data.js';
import {
  toast, openDrawer, openModal, confirmDialog, emptyState, loadingState,
  escapeHtml, humanize, fmtDate,
} from '../core/ui.js';
import { can } from '../core/rbac.js';
import { logAudit, AUDIT_ACTIONS } from '../core/audit.js';
import { CURRENT } from '../core/auth.js';

const API_AUTH_METHODS = ['none', 'api_key', 'oauth2', 'jwt_bearer', 'basic_auth', 'mtls'];
const API_ENVIRONMENTS = ['production', 'staging', 'development', 'test'];

renderEnginePage({
  active: 'api-security',
  title: 'API Security',
  subtitle: 'REST, GraphQL and OpenAPI endpoint inventory and OWASP API Top 10 assessment for authorized APIs',
  category: 'api',
  assetTypeFilter: (t) => t === 'api',
  extraSectionsHtml: `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <div><h3>API inventory</h3><p>Registered APIs with endpoint, auth method and schema tracking</p></div>
        <button class="btn btn-primary btn-sm" id="btn-add-api" data-requires="api_inventory.manage">+ Register API</button>
      </div>
      <div class="table-wrap" id="api-inventory-table"></div>
    </div>`,
  afterRender: ({ contentEl }) => {
    loadApiInventory();
    document.getElementById('btn-add-api').addEventListener('click', openApiForm);
  },
});

async function loadApiInventory() {
  const el = document.getElementById('api-inventory-table');
  loadingState(el, 'Loading API inventory…');
  const { docs } = await listDocs(COLLECTIONS.API_INVENTORY, { pageSize: 300 });
  if (!docs.length) {
    emptyState(el, {
      title: 'No APIs registered',
      message: 'Register a REST or GraphQL API, optionally importing an OpenAPI/Swagger schema or Postman collection, to begin endpoint inventory and assessment.',
      actionHtml: can('api_inventory.manage') ? '<button class="btn btn-primary btn-sm" id="empty-add-api">Register API</button>' : '',
    });
    document.getElementById('empty-add-api')?.addEventListener('click', openApiForm);
    return;
  }
  el.innerHTML = `<table class="data-table"><thead><tr>
      <th>API</th><th>Version</th><th>Auth method</th><th>Environment</th><th>Endpoints</th><th>Owner</th><th></th>
    </tr></thead><tbody>
    ${docs.map((a) => `
      <tr>
        <td><strong>${escapeHtml(a.name)}</strong><div class="cell-muted" style="font-size:11px">${escapeHtml(a.baseUrl || '')}</div></td>
        <td class="cell-muted">${escapeHtml(a.version || '—')}</td>
        <td class="cell-muted">${humanize(a.authMethod || 'none')}</td>
        <td class="cell-muted">${humanize(a.environment || '—')}</td>
        <td class="cell-muted">${(a.endpointCount ?? 0)} endpoints</td>
        <td class="cell-muted">${escapeHtml(a.ownerEmail || '—')}</td>
        <td><button class="btn btn-sm btn-danger" data-del="${a.id}" data-requires="api_inventory.manage">Remove</button></td>
      </tr>`).join('')}
  </tbody></table>`;
  el.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Remove API?', message: 'This removes the API from the inventory. Linked findings are preserved.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await deleteDocById(COLLECTIONS.API_INVENTORY, btn.dataset.del);
    toast('API removed', '', 'success');
    loadApiInventory();
  }));
}

function openApiForm() {
  const { close } = openDrawer({
    title: 'Register API',
    bodyHtml: `
      <form id="api-form" class="form-grid">
        <div class="field span-2"><label>API name *</label><input class="input" name="name" required placeholder="Payments API" /></div>
        <div class="field span-2"><label>Base URL</label><input class="input" name="baseUrl" placeholder="https://api.example.com/v2" /></div>
        <div class="field"><label>Version</label><input class="input" name="version" placeholder="v2" /></div>
        <div class="field"><label>Environment</label><select class="input" name="environment">${API_ENVIRONMENTS.map((e) => `<option value="${e}">${humanize(e)}</option>`).join('')}</select></div>
        <div class="field"><label>Authentication method</label><select class="input" name="authMethod">${API_AUTH_METHODS.map((m) => `<option value="${m}">${humanize(m)}</option>`).join('')}</select></div>
        <div class="field"><label>Owner email</label><input class="input" name="ownerEmail" type="email" /></div>
        <div class="field span-2"><label>OpenAPI / Swagger / Postman schema (paste JSON or YAML)</label><textarea class="input" name="schemaRaw" placeholder="Optional — paste the schema here for endpoint inventory and documentation reference" style="min-height:120px"></textarea></div>
      </form>`,
    footerHtml: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" id="api-save">Register</button>`,
  });
  document.querySelector('.overlay .drawer [data-cancel]').addEventListener('click', close);
  document.getElementById('api-save').addEventListener('click', async () => {
    const form = document.getElementById('api-form');
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const schemaRaw = fd.get('schemaRaw').trim();
    let endpointCount = 0;
    if (schemaRaw) {
      try {
        const parsed = JSON.parse(schemaRaw);
        endpointCount = parsed.paths ? Object.keys(parsed.paths).length : 0;
      } catch { /* non-JSON (e.g. YAML) schemas are stored as-is without auto endpoint counting */ }
    }
    const payload = {
      name: fd.get('name').trim(),
      baseUrl: fd.get('baseUrl').trim(),
      version: fd.get('version').trim(),
      environment: fd.get('environment'),
      authMethod: fd.get('authMethod'),
      ownerEmail: fd.get('ownerEmail').trim(),
      schemaRaw,
      schemaVersion: 1,
      endpointCount,
      documentationUrl: '',
    };
    try {
      const id = await createDoc(COLLECTIONS.API_INVENTORY, payload);
      await logAudit(AUDIT_ACTIONS.ASSET_CREATED, { actorUid: CURRENT.user?.uid, actorEmail: CURRENT.user?.email, targetType: 'api_inventory', targetId: id, summary: `Registered API ${payload.name}` });
      toast('API registered', payload.name, 'success');
      close();
      loadApiInventory();
    } catch (err) {
      toast('Save failed', err.message, 'error');
    }
  });
}
