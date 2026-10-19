/**
 * Resolve the platform identity (Firebase token / legacy JWT) to a Sales member + role.
 *
 *  - API keys are refused: Sales holds financial and personal data and API keys have no member identity.
 *  - A platform `admin` with no member row is provisioned as `sales_admin` (bootstrap). Note: when the platform's
 *    ADMIN_EMAILS is empty every signed-in user is a platform admin, so set ADMIN_EMAILS in production.
 *  - Any other signed-in user must have been added by a Sales administrator (matched by e-mail on first login).
 */
import type { Actor, AuthIdentity, Queryable, SalesRole } from "./types";
import { forbidden, unauthorized } from "./errors";

interface MemberRow {
  id: number;
  user_sub: string | null;
  email: string;
  display_name: string;
  role: SalesRole;
  team_id: number | null;
  active: boolean;
}

export async function loadTeamMemberIds(q: Queryable, memberId: number, teamId: number | null): Promise<number[]> {
  const r = await q.query<{ id: number }>(
    `WITH RECURSIVE t AS (
       SELECT id FROM sales_teams WHERE archived_at IS NULL AND (id = $1::int OR manager_member_id = $2::int)
       UNION
       SELECT c.id FROM sales_teams c JOIN t ON c.parent_team_id = t.id WHERE c.archived_at IS NULL
     )
     SELECT id FROM sales_members WHERE active AND team_id IN (SELECT id FROM t)`,
    [teamId, memberId],
  );
  return r.rows.map((x) => x.id);
}

export async function resolveActor(q: Queryable, auth: AuthIdentity | undefined): Promise<Actor> {
  if (!auth || !auth.sub) throw unauthorized();
  if (auth.isApiKey || auth.platformRole === "api") throw forbidden("API keys cannot access Sales Management", "api_key_not_allowed");
  const email = (auth.email ?? "").trim().toLowerCase();

  let row: MemberRow | undefined = (await q.query<MemberRow>("SELECT * FROM sales_members WHERE user_sub = $1", [auth.sub])).rows[0];
  if (!row && email) {
    const byEmail = (await q.query<MemberRow>("SELECT * FROM sales_members WHERE lower(email) = $1", [email])).rows[0];
    if (byEmail && (!byEmail.user_sub || byEmail.user_sub === auth.sub)) {
      await q.query("UPDATE sales_members SET user_sub = $1, updated_at = now() WHERE id = $2 AND user_sub IS NULL", [auth.sub, byEmail.id]);
      row = { ...byEmail, user_sub: auth.sub };
    }
  }
  if (!row) {
    // Platform admins are only auto-provisioned as Sales Administrators during first-run bootstrap (no active Sales
    // Administrator exists yet) or when listed in SALES_ADMIN_EMAILS. Otherwise an admin added later - or every
    // signed-in user when the platform runs in ADMIN_EMAILS bootstrap mode - would silently gain full sales access.
    const allow = (process.env.SALES_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const firstRun = !(await q.query("SELECT 1 FROM sales_members WHERE role = 'sales_admin' AND active LIMIT 1")).rows[0];
    if (auth.platformRole !== "admin" || !email || !(firstRun || allow.includes(email))) {
      throw forbidden("You have not been added to Sales Management. Ask a Sales Administrator to add your e-mail address.", "not_a_sales_member");
    }
    const ins = await q.query<MemberRow>(
      `INSERT INTO sales_members (user_sub, email, display_name, role) VALUES ($1,$2,$3,'sales_admin')
       ON CONFLICT ((lower(email))) DO UPDATE SET user_sub = COALESCE(sales_members.user_sub, EXCLUDED.user_sub)
       RETURNING *`,
      [auth.sub, email, auth.displayName || email.split("@")[0] || "Administrator"],
    );
    row = ins.rows[0]!;
    await q.query(
      `INSERT INTO sales_audit_events (actor_id, actor_label, action, entity_type, entity_id, summary) VALUES ($1,$2,'member.provision','member',$3,$4)`,
      [auth.sub, email, String(row.id), "Platform administrator provisioned as Sales Administrator"],
    );
  }
  if (!row.active) throw forbidden("Your Sales Management access has been deactivated", "member_inactive");

  const teamMemberIds = row.role === "sales_manager" ? await loadTeamMemberIds(q, row.id, row.team_id) : [];
  return {
    memberId: row.id,
    userSub: auth.sub,
    email: row.email,
    name: row.display_name,
    role: row.role,
    teamId: row.team_id,
    teamMemberIds,
    label: `${row.display_name} <${row.email}>`,
    isApiKey: false,
  };
}
