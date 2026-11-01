/**
 * CINTEXA CCDI — Phase 18 Prometheus-style metrics exposition
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as metrics from "../../services/ccdi-metrics";

const router = Router();

function promLine(name: string, value: number, labels?: Record<string, string>) {
  const labelStr = labels
    ? "{" + Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, "\\\"")}"`).join(",") + "}"
    : "";
  return `${name}${labelStr} ${Number.isFinite(value) ? value : 0}`;
}

router.get("/metrics/prometheus", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const m = await metrics.collectCcdiMetrics(organizationId);
    const labels = organizationId ? { organization_id: organizationId } : undefined;

    const lines: string[] = [
      "# HELP ccdi_kill_switch_active CCDI global kill switch (1=active)",
      "# TYPE ccdi_kill_switch_active gauge",
      promLine("ccdi_kill_switch_active", m.killSwitchActive ? 1 : 0),
      "# HELP ccdi_organizations_active Active CCDI organisations",
      "# TYPE ccdi_organizations_active gauge",
      promLine("ccdi_organizations_active", m.organizationsActive),
      "# HELP ccdi_jobs_total Jobs by state",
      "# TYPE ccdi_jobs_total gauge",
      promLine("ccdi_jobs_total", m.jobs?.total ?? 0, { ...(labels || {}), state: "all" }),
      promLine("ccdi_jobs_total", m.jobs?.queued ?? 0, { ...(labels || {}), state: "queued" }),
      promLine("ccdi_jobs_total", m.jobs?.running ?? 0, { ...(labels || {}), state: "running" }),
      promLine("ccdi_jobs_total", m.jobs?.failed ?? 0, { ...(labels || {}), state: "failed" }),
      "# HELP ccdi_findings_total Findings by severity/status aggregate",
      "# TYPE ccdi_findings_total gauge",
      promLine("ccdi_findings_total", m.findings?.total ?? 0, { ...(labels || {}), bucket: "total" }),
      promLine("ccdi_findings_total", m.findings?.open ?? 0, { ...(labels || {}), bucket: "open" }),
      promLine("ccdi_findings_total", m.findings?.critical ?? 0, { ...(labels || {}), bucket: "critical" }),
      promLine("ccdi_findings_total", m.findings?.high ?? 0, { ...(labels || {}), bucket: "high" }),
      "# HELP ccdi_evidence_total Evidence records",
      "# TYPE ccdi_evidence_total gauge",
      promLine("ccdi_evidence_total", m.evidenceTotal ?? 0, labels),
      "# HELP ccdi_webhook_outbox Webhook outbox depth",
      "# TYPE ccdi_webhook_outbox gauge",
      promLine("ccdi_webhook_outbox", m.webhooks?.outboxPending ?? 0, { ...(labels || {}), state: "pending" }),
      promLine("ccdi_webhook_outbox", m.webhooks?.outboxDead ?? 0, { ...(labels || {}), state: "dead" }),
      "# HELP ccdi_phase Current CCDI implementation phase",
      "# TYPE ccdi_phase gauge",
      promLine("ccdi_phase", 18),
    ];

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n") + "\n");
  } catch (err) {
    logger.error({ err }, "ccdi.metrics.prometheus failed");
    res.status(500).type("text/plain").send("# error collecting metrics\n");
  }
});

export default router;
