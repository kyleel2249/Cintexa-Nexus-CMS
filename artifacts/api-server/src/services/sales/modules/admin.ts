import { v, parse } from "../core/validate";
import { csv, type Route } from "../core/router";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit } from "../core/audit";
import { loadSettings, updateSection, SETTING_SECTIONS } from "../core/settings";
import { pageOf, str, toCsv } from "../core/http";
import { Where } from "./common";

const OUTBOX_STATUS = ["pending", "unconfigured", "sent", "failed", "dead", "manual"] as const;

export const adminRoutes: Route[] = [
  {
    method: "GET", path: "/settings", permission: "settings:read", tx: false,
    async handler({ q, deps }) {
      const settings = await loadSettings(q);
      const versions = (await q.query<{ key: string; version: number; updated_by: string | null; updated_at: string }>("SELECT key, version, updated_by, updated_at FROM sales_settings")).rows;
      return { settings, versions, sections: SETTING_SECTIONS, providers: { inventory: Boolean(deps.integrations.inventory), finance: Boolean(deps.integrations.finance), email: Boolean(deps.integrations.email), whatsapp: Boolean(deps.integrations.whatsapp), ai: Boolean(deps.integrations.ai) } };
    },
  },
  {
    method: "PUT", path: "/settings/:section", permission: "settings:write", tx: false,
    async handler({ db, actor, params, body, requestId, deps }) {
      if (!(SETTING_SECTIONS as string[]).includes(params.section!)) throw notFound("Settings section");
      const value = await updateSection(db, actor, params.section!, body, requestId);
      const warnings: string[] = [];
      if (params.section === "integrations") {
        const i = value as any;
        for (const k of ["inventory", "finance", "email", "whatsapp"] as const) if (i[k].enabled && !(deps.integrations as any)[k]) warnings.push(`${k} is switched on but no ${k} provider is installed on this server, so it stays "not connected".`);
        if (i.ai.enabled && !deps.integrations.ai) warnings.push("AI assist is switched on but no AI provider is configured on this server.");
      }
      return { value, warnings };
    },
  },
  {
    method: "GET", path: "/settings/:section/history", permission: "settings:read", tx: false,
    async handler({ q, params }) {
      if (!(SETTING_SECTIONS as string[]).includes(params.section!)) throw notFound("Settings section");
      return { items: (await q.query("SELECT version, value, changed_by, changed_at FROM sales_settings_history WHERE key = $1 ORDER BY version DESC LIMIT 50", [params.section])).rows };
    },
  },
  {
    method: "GET", path: "/audit-log", permission: "audit:read", tx: false,
    async handler({ q, actor, query, requestId }) {
      const pg = pageOf(query);
      const w = new Where();
      if (str(query, "entity_type")) w.and("entity_type = ?", str(query, "entity_type"));
      if (str(query, "entity_id")) w.and("entity_id = ?", str(query, "entity_id"));
      if (str(query, "action")) w.and("action LIKE ? ESCAPE '\\'", `${String(str(query, "action")).replace(/[\\%_]/g, "\\$&")}%`);
      if (str(query, "actor")) w.and("actor_label ILIKE ? ESCAPE '\\'", `%${String(str(query, "actor")).replace(/[\\%_]/g, "\\$&")}%`);
      if (str(query, "from")) w.and("at >= ?::timestamptz", parse(v.timestamp(), str(query, "from")));
      if (str(query, "to")) w.and("at < ?::timestamptz", parse(v.timestamp(), str(query, "to")));
      if (str(query, "format") === "csv") {
        const rows = (await q.query(`SELECT at, actor_label, action, entity_type, entity_id, summary, request_id FROM sales_audit_events WHERE ${w.sql} ORDER BY id DESC LIMIT 10000`, w.params)).rows;
        await audit(q, actor, { action: "audit.export", entityType: "audit", summary: `Exported ${rows.length} audit rows` }, requestId);
        return csv("audit-log.csv", toCsv(["at", "actor_label", "action", "entity_type", "entity_id", "summary", "request_id"], rows));
      }
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_audit_events WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(`SELECT id, at, actor_label, action, entity_type, entity_id, summary, before, after, request_id FROM sales_audit_events WHERE ${w.sql} ORDER BY id DESC LIMIT $${w.next()} OFFSET $${w.next() + 1}`, [...w.params, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "GET", path: "/integrations/status", permission: "settings:read", tx: false,
    async handler({ q, deps }) {
      const s = await loadSettings(q);
      const counts = (await q.query<{ provider: string; status: string; n: number }>("SELECT provider, status, count(*)::int n FROM sales_outbox GROUP BY provider, status")).rows;
      const lastError = (await q.query<{ provider: string; last_error: string; created_at: string }>("SELECT DISTINCT ON (provider) provider, last_error, created_at FROM sales_outbox WHERE last_error IS NOT NULL ORDER BY provider, id DESC")).rows;
      const item = (key: "inventory" | "finance" | "email" | "whatsapp") => {
        const enabled = (s.integrations as any)[key].enabled as boolean;
        const installed = Boolean((deps.integrations as any)[key]);
        const state = enabled && installed ? "connected" : enabled && !installed ? "enabled_but_no_provider" : installed ? "installed_but_disabled" : "not_connected";
        return { key, state, provider: (s.integrations as any)[key].provider || null, queue: Object.fromEntries(counts.filter((c) => c.provider === key).map((c) => [c.status, c.n])), lastError: lastError.find((e) => e.provider === key)?.last_error ?? null };
      };
      return {
        items: [item("inventory"), item("finance"), item("email"), item("whatsapp")],
        ai: { state: s.integrations.ai.enabled && deps.integrations.ai ? "connected" : s.integrations.ai.enabled ? "enabled_but_no_provider" : "off", external: deps.integrations.ai?.external ?? null, allowExternalProvider: s.integrations.ai.allowExternalProvider },
        calendar: { state: "not_available", note: "Calendar sync is not implemented in this release." }, esignature: { state: "not_available", note: "E-signature is recorded manually; no provider adapter is installed." },
      };
    },
  },
  {
    method: "GET", path: "/outbox", permission: "settings:read", tx: false,
    async handler({ q, query }) {
      const pg = pageOf(query);
      const w = new Where();
      if (str(query, "status")) w.and("status = ?", parse(v.enumOf(OUTBOX_STATUS), str(query, "status")));
      if (str(query, "kind")) w.and("kind = ?", str(query, "kind"));
      const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM sales_outbox WHERE ${w.sql}`, w.params)).rows[0]!.n;
      const items = (await q.query(`SELECT id, kind, provider, entity_type, entity_id, status, attempts, last_error, provider_ref, created_at, sent_at, next_attempt_at FROM sales_outbox WHERE ${w.sql} ORDER BY id DESC LIMIT $${w.next()} OFFSET $${w.next() + 1}`, [...w.params, pg.pageSize, pg.offset])).rows;
      return { items, total, page: pg.page, pageSize: pg.pageSize };
    },
  },
  {
    method: "POST", path: "/outbox/:id/retry", permission: "settings:write",
    async handler({ q, actor, params, now, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_outbox SET status = 'pending', attempts = 0, next_attempt_at = $2 WHERE id = $1 AND status IN ('failed','dead','unconfigured') RETURNING id", [id, now.toISOString()]);
      if (!r.rows[0]) throw conflict("Only failed, dead or unconfigured items can be retried", "invalid_state");
      await audit(q, actor, { action: "outbox.retry", entityType: "outbox", entityId: id, summary: "Retry requested" }, requestId);
      return { ok: true };
    },
  },
  {
    method: "POST", path: "/outbox/:id/mark-manual", permission: "settings:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ note: v.string({ min: 5, max: 300 }) }), body);
      const r = await q.query("UPDATE sales_outbox SET status = 'manual', last_error = $2 WHERE id = $1 AND status IN ('failed','dead','unconfigured') RETURNING id", [id, `Handled manually by ${actor.label}: ${b.note}`]);
      if (!r.rows[0]) throw conflict("Only failed, dead or unconfigured items can be marked as handled", "invalid_state");
      await audit(q, actor, { action: "outbox.mark_manual", entityType: "outbox", entityId: id, summary: `Marked handled manually: ${b.note}. The external system was NOT updated by Sales.` }, requestId);
      return { ok: true, note: "Recorded as handled manually. Sales did not contact the external system." };
    },
  },
];
void badRequest;
