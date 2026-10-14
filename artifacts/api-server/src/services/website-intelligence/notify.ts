import { dispatchWebhook } from "../../lib/webhooks";
import { logger } from "../../lib/logger";
import * as store from "./store";

async function sendEmail(to: string[], subject: string, text: string): Promise<void> {
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !to.length) return;
  try {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.default.createTransport({ host, port: parseInt(process.env.SMTP_PORT ?? "587"), secure: process.env.SMTP_SECURE === "true", auth: { user, pass } });
    await t.sendMail({ from: process.env.SMTP_FROM ?? user, to: to.join(","), subject, text });
  } catch (err) {
    logger.warn({ err }, "Website audit e-mail notification failed");
  }
}

export async function notifyAuditFinished(auditId: string): Promise<void> {
  const a = await store.getAudit(auditId);
  if (!a) return;
  const overall = a.scores?.overall ?? null;
  const payload = { auditId: a.id, hostname: a.hostname, url: a.url, status: a.status, overall, provisional: a.scores?.provisional ?? null, readiness: a.scores?.readiness.state ?? null, findings: a.progress.findings, completedAt: a.completedAt };
  dispatchWebhook(a.status === "failed" ? "website_audit.failed" : "website_audit.completed", payload);
  if (!a.monitorId || (a.status !== "completed" && a.status !== "partial")) return;
  const mon = await store.getMonitor(a.monitorId);
  if (!mon) return;
  const prevScore = mon.lastScore;
  await store.patchMonitor(mon.id, { lastRunAt: new Date(), lastAuditId: a.id, lastScore: overall, nextRunAt: store.nextRun(mon.frequency) });
  const threshold = mon.notify.scoreDropThreshold ?? 5;
  const newCritical = (await store.loadFindings(a.id)).filter((f) => f.kind === "defect" && f.severity === "critical" && f.verification !== "unverified");
  const dropped = prevScore !== null && overall !== null && prevScore - overall >= threshold;
  if (dropped || newCritical.length) {
    const reason = [dropped ? `score fell from ${prevScore} to ${overall}` : null, newCritical.length ? `${newCritical.length} critical finding(s)` : null].filter(Boolean).join("; ");
    dispatchWebhook("website_audit.regression", { ...payload, reason, monitorId: mon.id });
    await sendEmail(mon.notify.email ?? [], `Website audit alert for ${a.hostname}`, `The scheduled audit of ${a.url} finished: ${reason}.\nOverall score: ${overall ?? "n/a"}.\nOpen the audit in CINTEXA NEXUS to review the evidence.`);
  }
}
