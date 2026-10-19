/**
 * Background work for Sales Management. Every job is idempotent and safe to run on several instances at once
 * (row claims use FOR UPDATE SKIP LOCKED or unique dedupe keys). Nothing here talks to an external system unless a
 * provider is installed and enabled; otherwise the work is left queued and reported as such.
 */
import type { Db } from "./core/types";
import type { Deps } from "./core/router";
import { loadSettings } from "./core/settings";
import { audit } from "./core/audit";
import { businessDate, rangeFor, rangeFromDates } from "./core/time";
import { processOutbox, enqueue } from "./integrations/outbox";
import { notify } from "./modules/activities";
import { forecastFor, runReportRows } from "./modules/analytics";
import { retryRuns, runScheduledTriggers } from "./modules/automation";
import { toCsv } from "./core/http";
import type { Actor } from "./core/types";

const SYSTEM: Actor = { memberId: 0, userSub: "scheduler", email: "", name: "Scheduler", role: "sales_admin", teamId: null, teamMemberIds: [], label: "Scheduler", isApiKey: false };

export async function expireQuotations(db: Db, deps: Deps): Promise<number> {
  const settings = await loadSettings(db);
  const today = businessDate(deps.now(), settings.business.timezone);
  return db.tx(async (q) => {
    const rows = (await q.query<{ id: number; number: string }>(
      "UPDATE sales_quotations SET status = 'expired', updated_at = now() WHERE status IN ('sent','viewed') AND validity_date < $1::date RETURNING id, number", [today])).rows;
    for (const r of rows) await audit(q, SYSTEM, { action: "quotation.expire", entityType: "quotation", entityId: r.id, summary: `${r.number} expired on ${today}` }, `job-expire-${r.id}`);
    return rows.length;
  });
}

export async function sendReminders(db: Db, deps: Deps): Promise<number> {
  const now = deps.now();
  const settings = await loadSettings(db);
  if (!settings.notifications.enabled) return 0;
  const today = businessDate(now, settings.business.timezone);
  let n = 0;
  if (settings.notifications.overdueFollowUps) {
    const rows = (await db.query<{ id: number; owner_id: number; subject: string }>(
      "SELECT id, owner_id, subject FROM sales_activities WHERE status = 'open' AND owner_id IS NOT NULL AND COALESCE(due_at, start_at) < $1 AND COALESCE(due_at, start_at) > $1::timestamptz - interval '30 days' LIMIT 500", [now.toISOString()])).rows;
    for (const r of rows) if (await notify(db, r.owner_id, { kind: "overdue_activity", title: "Overdue: " + r.subject.slice(0, 120), link: "/sales/activities?overdue=true", severity: "warning", dedupeKey: `overdue:${r.id}:${today}` })) n++;
  }
  if (settings.notifications.expiringQuotations) {
    const rows = (await db.query<{ id: number; owner_id: number; number: string; days: number }>(
      "SELECT id, owner_id, number, (validity_date - $1::date)::int AS days FROM sales_quotations WHERE status IN ('sent','viewed') AND owner_id IS NOT NULL AND validity_date BETWEEN $1::date AND $1::date + $2::int LIMIT 500", [today, settings.quotations.expiryReminderDays])).rows;
    for (const r of rows) if (await notify(db, r.owner_id, { kind: "quotation_expiring", title: `${r.number} expires in ${r.days} day(s)`, link: `/sales/quotations/${r.id}`, severity: "warning", dedupeKey: `qexp:${r.id}:${today}` })) n++;
  }
  if (settings.notifications.targetAtRisk) {
    const rows = (await db.query<{ id: number; scope_id: number; amount: string }>(
      `SELECT t.id, t.scope_id, t.amount::text FROM sales_targets t JOIN sales_target_periods p ON p.id = t.period_id WHERE p.status = 'approved' AND t.scope = 'member' AND t.metric = 'revenue' AND p.starts_on <= $1::date AND p.ends_on >= $1::date LIMIT 500`, [today])).rows;
    void rows; // evaluated by the "target.threshold_crossed" automation trigger; no built-in message is sent without a rule
  }
  return n;
}

export async function deliverReportSchedules(db: Db, deps: Deps): Promise<{ sent: number; waiting: number }> {
  const now = deps.now();
  const settings = await loadSettings(db);
  const due = (await db.query<any>("SELECT * FROM sales_report_schedules WHERE active AND next_run_at <= $1 ORDER BY next_run_at LIMIT 20", [now.toISOString()])).rows;
  if (!due.length) return { sent: 0, waiting: 0 };
  if (!settings.integrations.email.enabled || !deps.integrations.email) return { sent: 0, waiting: due.length }; // stay due until email is connected
  let sent = 0;
  for (const s of due) {
    const claimed = await db.query("UPDATE sales_report_schedules SET next_run_at = $2::timestamptz + (CASE cadence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '30 days' END), last_run_at = $2 WHERE id = $1 AND next_run_at = $3 RETURNING id", [s.id, now.toISOString(), s.next_run_at]);
    if (!claimed.rows[0]) continue; // another instance took it
    const period = (s.params?.period ?? "last_month") as Parameters<typeof rangeFor>[0];
    const range = rangeFor(period, now, settings.business.timezone, settings.business.weekStartsOn);
    const rep = await db.tx((q) => runReportRows(q, SYSTEM, s.report, range, settings));
    if (!rep) continue;
    const text = toCsv(rep.columns, rep.rows);
    for (const to of s.recipients as string[]) {
      await db.tx((q) => enqueue(q, { kind: "email.send", entityType: "report_schedule", entityId: s.id, idempotencyKey: `report:${s.id}:${now.toISOString().slice(0, 10)}:${to}`, payload: { message: { to, subject: `${rep.title} - ${range.label}`, html: `<p>${rep.title} for ${range.label} is attached (${rep.rows.length} rows).</p>`, text: `${rep.title} for ${range.label}: ${rep.rows.length} rows attached.`, attachments: [{ filename: `${s.report}.csv`, content: Buffer.from(text, "utf8").toString("base64"), contentType: "text/csv" }] } } }));
    }
    sent++;
  }
  return { sent, waiting: due.length - sent };
}

export async function weeklyForecastSnapshot(db: Db, deps: Deps): Promise<boolean> {
  const now = deps.now();
  const settings = await loadSettings(db);
  const range = rangeFor("quarter", now, settings.business.timezone, settings.business.weekStartsOn);
  const recent = await db.query("SELECT 1 FROM sales_forecast_snapshots WHERE range_from = $1 AND range_to = $2 AND taken_at > $3::timestamptz - interval '7 days' LIMIT 1", [range.from, range.to, now.toISOString()]);
  if (recent.rows[0]) return false;
  return db.tx(async (q) => {
    const f = await forecastFor(q, SYSTEM, {}, range, now, settings);
    await q.query("INSERT INTO sales_forecast_snapshots (label, range_from, range_to, committed, weighted, best_case, worst_case, closed, assumptions, taken_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,'Scheduler')",
      [`${range.label} weekly ${businessDate(now, settings.business.timezone)}`, range.from, range.to, f.commit, f.baseCase, f.bestCase, f.worstCase, f.closed, JSON.stringify({ assumptions: f.assumptions, reliability: f.reliability })]);
    return true;
  });
}

export async function housekeeping(db: Db, deps: Deps): Promise<void> {
  const settings = await loadSettings(db);
  await db.query("DELETE FROM sales_idempotency_keys WHERE created_at < now() - interval '7 days'");
  await db.query("DELETE FROM sales_outbox WHERE status = 'sent' AND sent_at < now() - ($1 || ' days')::interval", [String(settings.archival.purgeOutboxAfterDays)]);
  await db.query("DELETE FROM sales_notifications WHERE read_at IS NOT NULL AND created_at < now() - interval '90 days'");
  void deps;
}

let running = false;
let tick = 0;
/** One scheduler pass (called every minute). Returns a summary for logs and tests. */
export async function runSalesJobs(db: Db, deps: Deps): Promise<Record<string, unknown>> {
  if (running) return { skipped: "previous pass still running" };
  running = true;
  tick++;
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (err) { deps.log.error({ err, job: name }, "Sales job failed"); out[name] = "error"; }
  };
  try {
    await step("outbox", () => processOutbox(db, deps));
    await step("automationRetries", () => retryRuns(db, deps));
    if (tick % 5 === 1) {
      await step("expireQuotations", () => expireQuotations(db, deps));
      await step("automationSchedule", () => runScheduledTriggers(db, deps));
      await step("reminders", () => sendReminders(db, deps));
      await step("reports", () => deliverReportSchedules(db, deps));
    }
    if (tick % 60 === 1) {
      await step("forecastSnapshot", () => weeklyForecastSnapshot(db, deps));
      await step("housekeeping", () => housekeeping(db, deps));
    }
  } finally {
    running = false;
  }
  return out;
}
void rangeFromDates;
