import { route, ok, type Route, type Ctx } from "../core/route";
import { audit } from "../core/audit";
import { V, asObject, qstr, todayIn, ymd } from "../core/validate";
import { HttpError, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { fromDb, formatMoney } from "../core/money";
import { hasPermission } from "../core/rbac";
import type { Q } from "../core/types";

export const MANUAL_TYPES = ["manual", "adjustment", "accrual", "prepayment", "reclassification", "opening", "recurring", "automated"] as const;
const JCOLS = "id, reference, journal_type, entry_date, period_id, description, source_module, source_ref, status, created_by, created_by_label, approved_by, approved_by_label, approved_at, posted_by, posted_by_label, posted_at, rejection_reason, reversal_of, reversed_by, attachments, created_at, updated_at";

export interface Who { orgId: number; sub: string; label: string }
export interface LineIn { account_id: number; description?: string; debit: bigint; credit: bigint; currency?: string; fx_rate?: string; foreign_amount?: bigint; department?: string; cost_centre?: string; project?: string }

export async function nextNumber(q: Q, orgId: number, key: string): Promise<number> {
  const r = await q.query<{ n: string | number }>(
    `INSERT INTO finance_number_sequences (org_id, key, next_value) VALUES ($1,$2,2)
     ON CONFLICT (org_id, key) DO UPDATE SET next_value = finance_number_sequences.next_value + 1 RETURNING next_value - 1 AS n`, [orgId, key]);
  return Number(r.rows[0]!.n);
}

export async function loadPeriod(q: Q, orgId: number, date: string) {
  const p = (await q.query<any>("SELECT id, name, status, fiscal_year_id, start_date, end_date FROM finance_periods WHERE org_id = $1 AND $2::date BETWEEN start_date AND end_date", [orgId, date])).rows[0];
  if (!p) throw unprocessable(`No accounting period covers ${date}. Create the fiscal year first.`, "no_period");
  return p as { id: number; name: string; status: string; fiscal_year_id: number };
}

export function assertPostable(p: { name: string; status: string }, canOverride: boolean): void {
  if (p.status === "hard_closed") throw unprocessable(`Period ${p.name} is hard-closed`, "period_locked");
  if (p.status === "soft_closed" && !canOverride) throw forbidden(`Period ${p.name} is soft-closed; posting needs the period:override permission`, "period_soft_closed");
}

/** Validates raw API lines and resolves account codes. Rejects unbalanced entries before anything is written. */
export async function normaliseLines(q: Q, orgId: number, raw: unknown): Promise<{ lines: LineIn[]; total: bigint }> {
  if (!Array.isArray(raw) || raw.length < 2) throw new HttpError(422, "validation_failed", "A journal needs at least two lines", { issues: [{ path: "lines", message: "A journal needs at least two lines" }] });
  if (raw.length > 500) throw unprocessable("A journal can have at most 500 lines", "too_many_lines");
  const out: LineIn[] = []; const issues: { path: string; message: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const src = asObject(raw[i]); const v = new V(src, `lines[${i}].`);
    const code = v.str("account_code", { optional: true, max: 20 }); let id = v.int("account_id", { optional: true, min: 1 });
    if (!id && !code) issues.push({ path: `lines[${i}].account_id`, message: "account_id or account_code is required" });
    const debit = v.money("debit", { optional: true }) ?? 0n; const credit = v.money("credit", { optional: true }) ?? 0n;
    if ((debit > 0n) === (credit > 0n)) issues.push({ path: `lines[${i}]`, message: "Each line needs exactly one of debit or credit greater than zero" });
    const description = v.str("description", { optional: true, max: 300 }); const department = v.str("department", { optional: true, max: 80 });
    const cc = v.str("cost_centre", { optional: true, max: 80 }); const project = v.str("project", { optional: true, max: 80 });
    const currency = v.str("currency", { optional: true, pattern: /^[A-Za-z]{3}$/ }); const fx = v.str("fx_rate", { optional: true, pattern: /^\d{1,10}(\.\d{1,8})?$/ });
    const foreign = v.money("foreign_amount", { optional: true });
    issues.push(...v.issues);
    if (!id && code) {
      const a = (await q.query<any>("SELECT id FROM finance_accounts WHERE org_id = $1 AND code = $2", [orgId, code])).rows[0];
      if (!a) issues.push({ path: `lines[${i}].account_code`, message: `Unknown account code ${code}` }); else id = Number(a.id);
    }
    if (id) out.push({ account_id: id, description, debit, credit, currency: currency?.toUpperCase(), fx_rate: fx, foreign_amount: foreign, department, cost_centre: cc, project });
  }
  if (issues.length) throw new HttpError(422, "validation_failed", `${issues.length} fields are invalid`, { issues });
  const ids = [...new Set(out.map((l) => l.account_id))];
  const accts = (await q.query<any>("SELECT id, code, is_active, allow_posting FROM finance_accounts WHERE org_id = $1 AND id = ANY($2::bigint[])", [orgId, ids])).rows;
  const byId = new Map(accts.map((a: any) => [Number(a.id), a]));
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) throw unprocessable(`Account ${id} does not exist in this organisation`, "invalid_account");
    if (!a.is_active) throw unprocessable(`Account ${a.code} is inactive`, "account_inactive");
    if (!a.allow_posting) throw unprocessable(`Account ${a.code} is a header account and does not accept postings`, "account_not_postable");
  }
  const d = out.reduce((s, l) => s + l.debit, 0n); const c = out.reduce((s, l) => s + l.credit, 0n);
  if (d !== c) throw unprocessable(`Journal is not balanced: debits ${formatMoney(d)} vs credits ${formatMoney(c)}`, "journal_unbalanced", { debits: formatMoney(d), credits: formatMoney(c), difference: formatMoney(d - c) });
  return { lines: out, total: d };
}

async function insertLines(q: Q, orgId: number, journalId: number, lines: LineIn[]) {
  let n = 1;
  for (const l of lines) {
    await q.query(
      `INSERT INTO finance_journal_lines (org_id, journal_id, line_no, account_id, description, debit, credit, currency, fx_rate, foreign_amount, department, cost_centre, project)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [orgId, journalId, n++, l.account_id, l.description ?? null, formatMoney(l.debit), formatMoney(l.credit), l.currency ?? null, l.fx_rate ?? null, l.foreign_amount === undefined ? null : formatMoney(l.foreign_amount), l.department ?? null, l.cost_centre ?? null, l.project ?? null]);
  }
}

export interface NewJournal { type: string; date: string; description: string; lines: LineIn[]; sourceModule?: string; sourceRef?: string; reversalOf?: number; attachments?: unknown[] }

export async function insertJournal(q: Q, who: Who, j: NewJournal, period: { id: number }): Promise<any> {
  const year = j.date.slice(0, 4);
  const n = await nextNumber(q, who.orgId, `journal:${year}`);
  const ref = `JNL-${year}-${String(n).padStart(6, "0")}`;
  const row = (await q.query<any>(
    `INSERT INTO finance_journals (org_id, reference, journal_type, entry_date, period_id, description, source_module, source_ref, created_by, created_by_label, reversal_of, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${JCOLS}`,
    [who.orgId, ref, j.type, j.date, period.id, j.description, j.sourceModule ?? null, j.sourceRef ?? null, who.sub, who.label, j.reversalOf ?? null, JSON.stringify(j.attachments ?? [])])).rows[0];
  await insertLines(q, who.orgId, Number(row.id), j.lines);
  return row;
}

/** Posts a draft/approved journal to the ledger. Approval policy is checked by the caller. */
export async function postJournal(q: Q, who: Who, journalId: number, now: Date, canOverride: boolean): Promise<any> {
  const j = (await q.query<any>(`SELECT ${JCOLS} FROM finance_journals WHERE id = $1 AND org_id = $2 FOR UPDATE`, [journalId, who.orgId])).rows[0];
  if (!j) throw notFound("Journal");
  if (j.status === "posted") throw conflict("This journal has already been posted", "already_posted");
  const period = (await q.query<any>("SELECT id, name, status FROM finance_periods WHERE id = $1 AND org_id = $2", [j.period_id, who.orgId])).rows[0];
  assertPostable(period, canOverride);
  const bad = (await q.query<any>(
    `SELECT a.code, a.is_active, a.allow_posting FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id AND a.org_id = l.org_id WHERE l.journal_id = $1 AND (NOT a.is_active OR NOT a.allow_posting) LIMIT 1`, [journalId])).rows[0];
  if (bad) throw unprocessable(`Account ${bad.code} no longer accepts postings`, "account_not_postable");
  const posted = (await q.query<any>(
    `UPDATE finance_journals SET status = 'posted', posted_by = $2, posted_by_label = $3, posted_at = $4, updated_at = now() WHERE id = $1 RETURNING ${JCOLS}`,
    [journalId, who.sub, who.label, now.toISOString()])).rows[0]; // DB trigger re-checks >= 2 lines and debits = credits
  await q.query(
    `INSERT INTO finance_ledger_entries (org_id, journal_id, journal_line_id, account_id, period_id, entry_date, journal_type, reference, description, debit, credit, posted_at)
     SELECT l.org_id, j.id, l.id, l.account_id, j.period_id, j.entry_date, j.journal_type, j.reference, COALESCE(l.description, j.description), l.debit, l.credit, $2
       FROM finance_journal_lines l JOIN finance_journals j ON j.id = l.journal_id WHERE j.id = $1 ORDER BY l.line_no`, [journalId, now.toISOString()]);
  return posted;
}

async function getJournal(q: Q, orgId: number, id: string | number, lock = false) {
  const j = (await q.query<any>(`SELECT ${JCOLS} FROM finance_journals WHERE id = $1 AND org_id = $2${lock ? " FOR UPDATE" : ""}`, [id, orgId])).rows[0];
  if (!j) throw notFound("Journal");
  return j;
}
const withLines = async (q: Q, orgId: number, j: any) => {
  const lines = (await q.query<any>(
    `SELECT l.id, l.line_no, l.account_id, a.code AS account_code, a.name AS account_name, l.description, l.debit, l.credit, l.currency, l.fx_rate, l.foreign_amount, l.department, l.cost_centre, l.project
       FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id AND a.org_id = l.org_id WHERE l.journal_id = $1 AND l.org_id = $2 ORDER BY l.line_no`, [j.id, orgId])).rows;
  return { ...j, lines, total_debit: formatMoney(lines.reduce((s: bigint, l: any) => s + fromDb(l.debit), 0n)), total_credit: formatMoney(lines.reduce((s: bigint, l: any) => s + fromDb(l.credit), 0n)) };
};
const approvalRequired = (c: Ctx) => c.org.settings?.journal_approval_required !== false;

const list = route("GET", "/journals", { perm: "ledger:read" }, async (c) => {
  const where = ["j.org_id = $1"]; const p: unknown[] = [c.org.orgId];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace("?", `$${p.length}`)); };
  const status = qstr(c.query.status); const type = qstr(c.query.type); const from = qstr(c.query.from); const to = qstr(c.query.to); const s = qstr(c.query.q);
  if (status) add("j.status = ?", status); if (type) add("j.journal_type = ?", type);
  if (from) add("j.entry_date >= ?::date", from); if (to) add("j.entry_date <= ?::date", to);
  if (s) { p.push(`%${s.toLowerCase()}%`); where.push(`(lower(j.description) LIKE $${p.length} OR lower(j.reference) LIKE $${p.length})`); }
  const limit = Math.min(200, Math.max(1, Number(qstr(c.query.limit)) || 50)); const offset = Math.max(0, Number(qstr(c.query.offset)) || 0);
  const total = Number((await c.q.query<any>(`SELECT count(*)::int AS n FROM finance_journals j WHERE ${where.join(" AND ")}`, p)).rows[0].n);
  const rows = (await c.q.query<any>(
    `SELECT ${JCOLS.split(", ").map((x) => "j." + x).join(", ")}, (SELECT COALESCE(SUM(debit),0) FROM finance_journal_lines WHERE journal_id = j.id) AS total
       FROM finance_journals j WHERE ${where.join(" AND ")} ORDER BY j.entry_date DESC, j.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  return ok({ items: rows, total, limit, offset });
});

const getOne = route("GET", "/journals/:id", { perm: "ledger:read" }, async (c) => ok({ journal: await withLines(c.q, c.org.orgId, await getJournal(c.q, c.org.orgId, c.params.id!)) }));

const create = route("POST", "/journals", { perm: "finance:create" }, async (c) => {
  const v = new V(asObject(c.body));
  const date = v.date("entry_date"); const description = v.str("description", { min: 3, max: 500 });
  const type = v.str("journal_type", { optional: true, oneOf: MANUAL_TYPES }) ?? "manual";
  const sm = v.str("source_module", { optional: true, max: 40, pattern: /^[a-z0-9_.-]+$/ }); const sr = v.str("source_ref", { optional: true, max: 120 });
  const autoPost = v.bool("auto_post");
  v.done();
  if (sr && !sm) throw unprocessable("source_ref requires source_module", "validation_failed");
  if (type === "automated" && !sm) throw unprocessable("Automated journals must name their source_module and source_ref", "validation_failed");
  if (autoPost && type !== "automated") throw unprocessable("auto_post is only available for automated journals", "auto_post_not_allowed");
  if (autoPost && !hasPermission(c.org.role, "finance:post")) throw forbidden("Missing permission finance:post", "missing_permission");
  const who: Who = { orgId: c.org.orgId, sub: c.actor.sub, label: c.actor.label };
  if (sm && sr) {
    const dup = (await c.q.query<any>(`SELECT ${JCOLS} FROM finance_journals WHERE org_id = $1 AND source_module = $2 AND source_ref = $3 AND journal_type <> 'reversal'`, [who.orgId, sm, sr])).rows[0];
    if (dup) return ok({ journal: await withLines(c.q, who.orgId, dup), duplicate: true });
  }
  const { lines } = await normaliseLines(c.q, who.orgId, asObject(c.body).lines);
  const period = await loadPeriod(c.q, who.orgId, date!);
  assertPostable(period, hasPermission(c.org.role, "period:override"));
  let j = await insertJournal(c.q, who, { type, date: date!, description: description!, lines, sourceModule: sm, sourceRef: sr, attachments: asObject(c.body).attachments }, period);
  await audit(c.q, { orgId: who.orgId, actorId: who.sub, actorLabel: who.label, action: "journal.create", entityType: "journal", entityId: j.id, summary: `Created ${j.reference}`, after: j, requestId: c.reqId, sourceModule: sm });
  if (autoPost) {
    j = await postJournal(c.q, who, Number(j.id), c.now, hasPermission(c.org.role, "period:override"));
    await audit(c.q, { orgId: who.orgId, actorId: who.sub, actorLabel: who.label, action: "journal.post", entityType: "journal", entityId: j.id, summary: `Posted ${j.reference} (automated)`, requestId: c.reqId, sourceModule: sm });
  }
  return ok({ journal: await withLines(c.q, who.orgId, j) }, 201);
});

const update = route("PATCH", "/journals/:id", { perm: "finance:create" }, async (c) => {
  const j = await getJournal(c.q, c.org.orgId, c.params.id!, true);
  if (!["draft", "rejected"].includes(j.status)) throw conflict(`A ${j.status} journal cannot be edited${j.status === "posted" ? "; post a reversal or adjustment instead" : ""}`, "journal_not_editable");
  if (j.created_by !== c.actor.sub && !hasPermission(c.org.role, "finance:approve")) throw forbidden("Only the creator or an approver can edit this journal");
  const b = asObject(c.body); const v = new V(b);
  const date = v.date("entry_date", true); const description = v.str("description", { optional: true, min: 3, max: 500 }); v.done();
  const before = await withLines(c.q, c.org.orgId, j);
  const entryDate = date ?? ymd(j.entry_date);
  const period = await loadPeriod(c.q, c.org.orgId, entryDate); assertPostable(period, hasPermission(c.org.role, "period:override"));
  let lines: LineIn[] | undefined;
  if (b.lines !== undefined) lines = (await normaliseLines(c.q, c.org.orgId, b.lines)).lines;
  await c.q.query("UPDATE finance_journals SET entry_date = $3, period_id = $4, description = COALESCE($5, description), status = 'draft', rejection_reason = NULL, updated_at = now() WHERE id = $1 AND org_id = $2", [j.id, c.org.orgId, entryDate, period.id, description ?? null]);
  if (lines) { await c.q.query("DELETE FROM finance_journal_lines WHERE journal_id = $1 AND org_id = $2", [j.id, c.org.orgId]); await insertLines(c.q, c.org.orgId, Number(j.id), lines); }
  const after = await withLines(c.q, c.org.orgId, await getJournal(c.q, c.org.orgId, j.id));
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.update", entityType: "journal", entityId: j.id, before, after, requestId: c.reqId });
  return ok({ journal: after });
});

const remove = route("DELETE", "/journals/:id", { perm: "finance:create" }, async (c) => {
  const j = await getJournal(c.q, c.org.orgId, c.params.id!, true);
  if (!["draft", "rejected"].includes(j.status)) throw conflict("Only unposted draft or rejected journals can be deleted", "journal_not_deletable");
  if (j.created_by !== c.actor.sub && !hasPermission(c.org.role, "finance:admin")) throw forbidden("Only the creator or an administrator can delete this journal");
  const before = await withLines(c.q, c.org.orgId, j);
  await c.q.query("DELETE FROM finance_journal_lines WHERE journal_id = $1 AND org_id = $2", [j.id, c.org.orgId]);
  await c.q.query("DELETE FROM finance_journals WHERE id = $1 AND org_id = $2", [j.id, c.org.orgId]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.delete", entityType: "journal", entityId: j.id, summary: `Deleted ${j.reference}`, before, requestId: c.reqId });
  return ok({ deleted: true });
});

const approve = route("POST", "/journals/:id/approve", { perm: "finance:approve" }, async (c) => {
  const j = await getJournal(c.q, c.org.orgId, c.params.id!, true);
  if (j.status !== "draft") throw conflict(`Only draft journals can be approved (this one is ${j.status})`, "invalid_status");
  if (j.created_by === c.actor.sub && c.org.settings?.allow_self_approval !== true) throw forbidden("Separation of duties: you cannot approve a journal you created", "separation_of_duties");
  const after = (await c.q.query<any>(`UPDATE finance_journals SET status = 'approved', approved_by = $3, approved_by_label = $4, approved_at = $5, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${JCOLS}`, [j.id, c.org.orgId, c.actor.sub, c.actor.label, c.now.toISOString()])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.approve", entityType: "journal", entityId: j.id, summary: `Approved ${j.reference}`, before: { status: j.status }, after: { status: "approved" }, requestId: c.reqId });
  return ok({ journal: after });
});

const reject = route("POST", "/journals/:id/reject", { perm: "finance:approve" }, async (c) => {
  const v = new V(asObject(c.body)); const reason = v.str("reason", { min: 3, max: 500 }); v.done();
  const j = await getJournal(c.q, c.org.orgId, c.params.id!, true);
  if (!["draft", "approved"].includes(j.status)) throw conflict(`A ${j.status} journal cannot be rejected`, "invalid_status");
  const after = (await c.q.query<any>(`UPDATE finance_journals SET status = 'rejected', rejection_reason = $3, approved_by = NULL, approved_by_label = NULL, approved_at = NULL, updated_at = now() WHERE id = $1 AND org_id = $2 RETURNING ${JCOLS}`, [j.id, c.org.orgId, reason])).rows[0];
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.reject", entityType: "journal", entityId: j.id, summary: `Rejected ${j.reference}: ${reason}`, before: { status: j.status }, after: { status: "rejected" }, requestId: c.reqId });
  return ok({ journal: after });
});

const post = route("POST", "/journals/:id/post", { perm: "finance:post" }, async (c) => {
  const j = await getJournal(c.q, c.org.orgId, c.params.id!, true);
  if (j.status === "posted") throw conflict("This journal has already been posted", "already_posted");
  if (j.status === "rejected") throw conflict("A rejected journal must be corrected and resubmitted", "invalid_status");
  if (approvalRequired(c) && j.status !== "approved") throw conflict("This journal needs approval before it can be posted", "approval_required");
  const who: Who = { orgId: c.org.orgId, sub: c.actor.sub, label: c.actor.label };
  const posted = await postJournal(c.q, who, Number(j.id), c.now, hasPermission(c.org.role, "period:override"));
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.post", entityType: "journal", entityId: j.id, summary: `Posted ${j.reference}`, before: { status: j.status }, after: { status: "posted" }, requestId: c.reqId });
  return ok({ journal: await withLines(c.q, c.org.orgId, posted) });
});

const reverse = route("POST", "/journals/:id/reverse", { perm: "finance:reverse" }, async (c) => {
  const v = new V(asObject(c.body)); const reason = v.str("reason", { min: 3, max: 500 }); const date = v.date("date", true); v.done();
  const orig = await getJournal(c.q, c.org.orgId, c.params.id!, true);
  if (orig.status !== "posted") throw conflict("Only posted journals can be reversed", "invalid_status");
  if (orig.reversed_by) throw conflict("This journal has already been reversed", "already_reversed");
  if (orig.journal_type === "reversal") throw conflict("A reversal cannot itself be reversed; post a new journal", "invalid_status");
  const o = await withLines(c.q, c.org.orgId, orig);
  const on = date ?? todayIn(c.org.settings?.timezone ?? "Africa/Accra", c.now);
  const period = await loadPeriod(c.q, c.org.orgId, on); const can = hasPermission(c.org.role, "period:override"); assertPostable(period, can);
  const lines: LineIn[] = o.lines.map((l: any) => ({ account_id: Number(l.account_id), description: l.description ?? undefined, debit: fromDb(l.credit), credit: fromDb(l.debit), department: l.department ?? undefined, cost_centre: l.cost_centre ?? undefined, project: l.project ?? undefined }));
  const who: Who = { orgId: c.org.orgId, sub: c.actor.sub, label: c.actor.label };
  const rev = await insertJournal(c.q, who, { type: "reversal", date: on, description: `Reversal of ${orig.reference}: ${reason}`, lines, reversalOf: Number(orig.id) }, period);
  const posted = await postJournal(c.q, who, Number(rev.id), c.now, can);
  await c.q.query("UPDATE finance_journals SET reversed_by = $3, updated_at = now() WHERE id = $1 AND org_id = $2", [orig.id, c.org.orgId, rev.id]);
  await audit(c.q, { orgId: c.org.orgId, actorId: c.actor.sub, actorLabel: c.actor.label, action: "journal.reverse", entityType: "journal", entityId: orig.id, summary: `Reversed ${orig.reference} with ${posted.reference}: ${reason}`, after: { reversal: posted.reference }, requestId: c.reqId });
  return ok({ reversal: await withLines(c.q, c.org.orgId, posted), original: await withLines(c.q, c.org.orgId, await getJournal(c.q, c.org.orgId, orig.id)) }, 201);
});

export const journalRoutes: Route[] = [list, create, getOne, update, remove, approve, reject, post, reverse];
