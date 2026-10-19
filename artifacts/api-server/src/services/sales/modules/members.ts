import { v, parse } from "../core/validate";
import { Router, created, noContent, type Route } from "../core/router";
import { notFound, conflict, badRequest } from "../core/errors";
import { audit, diff } from "../core/audit";
import { can, permissionsOf, scopeOf, ROLE_LABELS, SALES_ROLES_LIST } from "../core/rbac-meta";
import { pageOf } from "../core/http";
import { buildUpdate, Where, TEXT_ARRAY, textArrayParam } from "./common";

const role = () => v.enumOf(["sales_admin", "sales_director", "sales_manager", "sales_rep", "sales_analyst", "finance", "support_agent", "readonly_exec"] as const);

const memberCreate = v.object({
  email: v.email(), display_name: v.string({ min: 2, max: 120 }), role: role(), team_id: v.optional(v.id()), branch: v.optional(v.string({ max: 80 })), hire_date: v.optional(v.date()),
});
const memberPatch = v.object({
  display_name: v.optional(v.string({ min: 2, max: 120 })), role: v.optional(role()), team_id: v.nullable(v.id()), branch: v.nullable(v.string({ max: 80 })), active: v.optional(v.boolean()), coaching_notes: v.nullable(v.string({ max: 4000, raw: true })),
});
const teamBody = v.object({ name: v.string({ min: 2, max: 80 }), parent_team_id: v.nullable(v.id()), manager_member_id: v.nullable(v.id()), branch: v.nullable(v.string({ max: 80 })) });
const territoryBody = v.object({
  name: v.string({ min: 2, max: 80 }), description: v.optional(v.string({ max: 500 })), countries: v.withDefault(v.array(v.string({ max: 80 }), { max: 100 }), []),
  regions: v.withDefault(v.array(v.string({ max: 80 }), { max: 200 }), []), industries: v.withDefault(v.array(v.string({ max: 80 }), { max: 100 }), []),
});

export const memberRoutes: Route[] = [
  {
    method: "GET", path: "/me", permission: null,
    async handler({ actor, q, settings }) {
      const unread = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_notifications WHERE member_id = $1 AND read_at IS NULL", [actor.memberId])).rows[0]!.n;
      return {
        member: { id: actor.memberId, email: actor.email, name: actor.name, role: actor.role, roleLabel: ROLE_LABELS[actor.role], teamId: actor.teamId },
        scope: scopeOf(actor), permissions: permissionsOf(actor.role), canSeeCost: can(actor, "cost:read"), unreadNotifications: unread,
        business: { currency: settings.business.currency, timezone: settings.business.timezone, locale: settings.business.locale, weekStartsOn: settings.business.weekStartsOn },
        features: { aiEnabled: settings.integrations.ai.enabled, emailEnabled: settings.integrations.email.enabled, automationEnabled: settings.automation.enabled },
      };
    },
  },
  {
    method: "GET", path: "/members", permission: "members:read",
    async handler({ q, query }) {
      const w = new Where();
      if (query.active === "true") w.raw("m.active");
      if (typeof query.role === "string") w.and("m.role = ?", query.role);
      if (typeof query.q === "string") w.search(query.q.trim(), ["m.display_name", "m.email"]);
      const r = await q.query(`SELECT m.id, m.email, m.display_name, m.role, m.team_id, t.name AS team_name, m.branch, m.active, m.hire_date, m.created_at FROM sales_members m LEFT JOIN sales_teams t ON t.id = m.team_id WHERE ${w.sql} ORDER BY m.display_name`, w.params);
      return { items: r.rows, roles: SALES_ROLES_LIST.map((r) => ({ value: r, label: ROLE_LABELS[r] })) };
    },
  },
  {
    method: "POST", path: "/members", permission: "members:write", idempotent: true,
    async handler({ q, actor, body, requestId }) {
      const b = parse(memberCreate, body);
      const dup = await q.query("SELECT id FROM sales_members WHERE lower(email) = $1", [b.email]);
      if (dup.rows[0]) throw conflict("A sales member with this e-mail already exists", "duplicate");
      const r = await q.query<{ id: number }>("INSERT INTO sales_members (email, display_name, role, team_id, branch, hire_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [b.email, b.display_name, b.role, b.team_id ?? null, b.branch ?? null, b.hire_date ?? null]);
      await audit(q, actor, { action: "member.create", entityType: "member", entityId: r.rows[0]!.id, summary: `Added ${b.display_name} as ${b.role}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/members/:id", permission: "members:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(memberPatch, body);
      const cur = (await q.query("SELECT * FROM sales_members WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw notFound("Member");
      // Safety: never remove the last active administrator, and don't let admins lock themselves out by accident.
      const losingAdmin = cur.role === "sales_admin" && ((b.role && b.role !== "sales_admin") || b.active === false);
      if (losingAdmin) {
        const others = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_members WHERE role = 'sales_admin' AND active AND id <> $1", [id])).rows[0]!.n;
        if (others === 0) throw conflict("At least one active Sales Administrator is required", "last_admin");
      }
      const upd = buildUpdate(b as Record<string, unknown>, { display_name: "display_name", role: "role", team_id: "team_id", branch: "branch", active: "active", coaching_notes: "coaching_notes" });
      if (!upd) return { ok: true };
      await q.query(`UPDATE sales_members SET ${upd.set}, updated_at = now() WHERE id = $1`, [id, ...upd.params]);
      const d = diff(cur, { ...cur, ...b });
      await audit(q, actor, { action: "member.update", entityType: "member", entityId: id, summary: `Updated member ${cur.display_name}`, before: d.before, after: d.after }, requestId);
      return { ok: true };
    },
  },
  {
    method: "GET", path: "/teams", permission: "teams:read",
    async handler({ q }) {
      const r = await q.query(`SELECT t.id, t.name, t.parent_team_id, t.manager_member_id, m.display_name AS manager_name, t.branch,
        (SELECT count(*)::int FROM sales_members x WHERE x.team_id = t.id AND x.active) AS member_count
        FROM sales_teams t LEFT JOIN sales_members m ON m.id = t.manager_member_id WHERE t.archived_at IS NULL ORDER BY t.name`);
      return { items: r.rows };
    },
  },
  {
    method: "POST", path: "/teams", permission: "teams:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(teamBody, body);
      const r = await q.query<{ id: number }>("INSERT INTO sales_teams (name, parent_team_id, manager_member_id, branch) VALUES ($1,$2,$3,$4) RETURNING id", [b.name, b.parent_team_id ?? null, b.manager_member_id ?? null, b.branch ?? null]);
      await audit(q, actor, { action: "team.create", entityType: "team", entityId: r.rows[0]!.id, summary: `Created team ${b.name}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PATCH", path: "/teams/:id", permission: "teams:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(teamBody, { ...(await q.query("SELECT name, parent_team_id, manager_member_id, branch FROM sales_teams WHERE id = $1", [id])).rows[0], ...(body as object) });
      if (b.parent_team_id === id) throw badRequest("A team cannot be its own parent");
      if (b.parent_team_id) {
        // forbid cycles: the new parent must not be a descendant of this team
        const cyc = await q.query(`WITH RECURSIVE d AS (SELECT id FROM sales_teams WHERE parent_team_id = $1 UNION SELECT c.id FROM sales_teams c JOIN d ON c.parent_team_id = d.id) SELECT 1 FROM d WHERE id = $2`, [id, b.parent_team_id]);
        if (cyc.rows[0]) throw badRequest("A team cannot be placed under one of its own sub-teams");
      }
      const r = await q.query("UPDATE sales_teams SET name=$2, parent_team_id=$3, manager_member_id=$4, branch=$5, updated_at=now() WHERE id=$1 AND archived_at IS NULL", [id, b.name, b.parent_team_id ?? null, b.manager_member_id ?? null, b.branch ?? null]);
      if (!r.rowCount) throw notFound("Team");
      await audit(q, actor, { action: "team.update", entityType: "team", entityId: id, summary: `Updated team ${b.name}`, after: b }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/teams/:id", permission: "teams:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const members = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_members WHERE team_id = $1 AND active", [id])).rows[0]!.n;
      if (members > 0) throw conflict(`Move the ${members} active member(s) to another team before archiving`, "team_not_empty");
      const r = await q.query("UPDATE sales_teams SET archived_at = now() WHERE id = $1 AND archived_at IS NULL", [id]);
      if (!r.rowCount) throw notFound("Team");
      await audit(q, actor, { action: "team.archive", entityType: "team", entityId: id }, requestId);
      return noContent();
    },
  },
  {
    method: "GET", path: "/territories", permission: "teams:read",
    async handler({ q }) {
      const r = await q.query(`SELECT t.*, COALESCE((SELECT json_agg(json_build_object('member_id', tm.member_id, 'name', m.display_name, 'is_primary', tm.is_primary) ORDER BY m.display_name) FROM sales_territory_members tm JOIN sales_members m ON m.id = tm.member_id WHERE tm.territory_id = t.id), '[]'::json) AS members
        FROM sales_territories t WHERE t.archived_at IS NULL ORDER BY t.name`);
      return { items: r.rows };
    },
  },
  {
    method: "POST", path: "/territories", permission: "teams:write",
    async handler({ q, actor, body, requestId }) {
      const b = parse(territoryBody, body);
      const r = await q.query<{ id: number }>(
        `INSERT INTO sales_territories (name, description, countries, regions, industries) VALUES ($1,$2,${TEXT_ARRAY("$3")},${TEXT_ARRAY("$4")},${TEXT_ARRAY("$5")}) RETURNING id`,
        [b.name, b.description ?? null, textArrayParam(b.countries), textArrayParam(b.regions), textArrayParam(b.industries)],
      );
      await audit(q, actor, { action: "territory.create", entityType: "territory", entityId: r.rows[0]!.id, summary: `Created territory ${b.name}`, after: b }, requestId);
      return created({ id: r.rows[0]!.id });
    },
  },
  {
    method: "PUT", path: "/territories/:id/members", permission: "teams:write",
    async handler({ q, actor, params, body, requestId }) {
      const id = parse(v.id(), params.id);
      const b = parse(v.object({ members: v.array(v.object({ member_id: v.id(), is_primary: v.withDefault(v.boolean(), false) }), { max: 200 }) }), body);
      if (b.members.filter((m) => m.is_primary).length > 1) throw badRequest("Only one primary owner per territory");
      if (!(await q.query("SELECT 1 FROM sales_territories WHERE id = $1 AND archived_at IS NULL", [id])).rows[0]) throw notFound("Territory");
      await q.query("DELETE FROM sales_territory_members WHERE territory_id = $1", [id]);
      for (const m of b.members) await q.query("INSERT INTO sales_territory_members (territory_id, member_id, is_primary) VALUES ($1,$2,$3)", [id, m.member_id, m.is_primary]);
      await audit(q, actor, { action: "territory.assign", entityType: "territory", entityId: id, summary: `Set ${b.members.length} territory member(s)`, after: b }, requestId);
      return { ok: true };
    },
  },
  {
    method: "DELETE", path: "/territories/:id", permission: "teams:write",
    async handler({ q, actor, params, requestId }) {
      const id = parse(v.id(), params.id);
      const r = await q.query("UPDATE sales_territories SET archived_at = now() WHERE id = $1 AND archived_at IS NULL", [id]);
      if (!r.rowCount) throw notFound("Territory");
      await audit(q, actor, { action: "territory.archive", entityType: "territory", entityId: id }, requestId);
      return noContent();
    },
  },
];

void Router;
void pageOf;
