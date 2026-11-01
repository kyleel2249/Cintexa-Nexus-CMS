/**
 * CINTEXA CCDI — Phase 12 Adapter & operational routes
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import * as adapters from "../../services/ccdi-adapters";
import * as workers from "../../services/ccdi-workers";
import * as orch from "../../services/ccdi-orchestration";
import * as webhooks from "../../services/ccdi-webhooks";
import { requireCcdiPermission } from "../../services/ccdi-rbac";

const router = Router();

// ── Adapter catalogue ──────────────────────────────────────────────────────
router.get("/adapters", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    adapters: adapters.listAdapters(),
    note: "Only demo.echo and passive.dns are built in. No vulnerability scanners ship with the control plane.",
  });
});

/**
 * In-process worker helper for environments without a separate worker process.
 * Claims (or uses provided execution), runs the adapter, completes the job.
 * Still subject to kill-switch and queue state.
 */
router.post(
  "/adapters/run-next",
  requireAuth,
  requireCcdiPermission("ccdi.job.execute"),
  async (req: Request, res: Response) => {
    try {
      if (await orch.isKillSwitchActive()) {
        res.status(503).json({ error: "Kill switch active" });
        return;
      }

      const workerId = String(req.body?.workerId || `inprocess-${req.auth?.sub || "api"}`);
      const organizationId = req.body?.organizationId ? String(req.body.organizationId) : undefined;

      const claimed = await workers.claimNextJob(workerId, organizationId);
      if ("error" in claimed) {
        res.status(claimed.status).json({ error: claimed.error });
        return;
      }
      if (!claimed.job) {
        res.json({ job: null, message: "No queued jobs" });
        return;
      }

      const job = claimed.job as any;
      const result = await adapters.runAdapter({
        jobId: job.id,
        organizationId: job.organization_id,
        jobType: job.job_type,
        parameters: job.parameters || {},
        targets: Array.isArray(job.targets) ? job.targets : [],
        workerId,
      });

      const completion = await workers.completeExecution({
        executionId: claimed.execution.id,
        workerId,
        success: result.success,
        exitCode: result.success ? 0 : 1,
        stdoutSummary: result.stdoutSummary,
        stderrSummary: result.stderrSummary,
        metrics: result.metrics,
        evidence: result.evidence,
      });

      // Best-effort webhook
      await webhooks
        .emitCcdiEvent({
          organizationId: job.organization_id,
          eventType: result.success ? "job.completed" : "job.failed",
          data: { jobId: job.id, adapter: result.metrics?.adapter, success: result.success },
        })
        .catch(() => undefined);

      res.json({
        jobId: job.id,
        executionId: claimed.execution.id,
        result,
        completion,
      });
    } catch (err) {
      logger.error({ err }, "ccdi.adapters.run-next failed");
      res.status(500).json({ error: "Adapter run failed" });
    }
  },
);

// ── Webhook retry (single pass over recent failures) ───────────────────────
router.post(
  "/webhooks/retry",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      const orgId = req.body?.organizationId;
      if (!orgId) {
        res.status(400).json({ error: "organizationId is required" });
        return;
      }

      // Ensure schema
      for (const stmt of webhooks.CCDI_PHASE11_SCHEMA) {
        await pool.query(stmt).catch(() => undefined);
      }

      const { rows: failed } = await pool.query(
        `SELECT d.id, d.endpoint_id, d.event_type, d.payload, e.url, e.secret, e.status AS ep_status
         FROM ccdi_webhook_deliveries d
         JOIN ccdi_webhook_endpoints e ON e.id = d.endpoint_id
         WHERE d.organization_id = $1 AND d.success = false AND e.status = 'active'
         ORDER BY d.attempted_at DESC
         LIMIT 20`,
        [orgId],
      );

      let retried = 0;
      let succeeded = 0;
      for (const d of failed) {
        retried += 1;
        try {
          const { createHmac } = await import("crypto");
          const signature = createHmac("sha256", d.secret).update(d.payload).digest("hex");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8_000);
          const resFetch = await fetch(d.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CCDI-Event": d.event_type,
              "X-CCDI-Signature": `sha256=${signature}`,
              "X-CCDI-Retry": "1",
              "User-Agent": "CINTEXA-CCDI-Webhook/1.0",
            },
            body: typeof d.payload === "string" ? d.payload : JSON.stringify(d.payload),
            signal: controller.signal,
          });
          clearTimeout(timer);

          await pool.query(
            `INSERT INTO ccdi_webhook_deliveries
               (endpoint_id, organization_id, event_type, payload, http_status, success)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [d.endpoint_id, orgId, d.event_type, d.payload, resFetch.status, resFetch.ok],
          );
          if (resFetch.ok) succeeded += 1;
        } catch (err: any) {
          await pool.query(
            `INSERT INTO ccdi_webhook_deliveries
               (endpoint_id, organization_id, event_type, payload, success, error_message)
             VALUES ($1,$2,$3,$4,false,$5)`,
            [d.endpoint_id, orgId, d.event_type, d.payload, String(err?.message || err)],
          );
        }
      }

      res.json({ retried, succeeded });
    } catch (err) {
      logger.error({ err }, "ccdi.webhooks.retry failed");
      res.status(500).json({ error: "Retry failed" });
    }
  },
);

// ── HTML report export ─────────────────────────────────────────────────────
router.get("/reporting/reports/:id/export.html", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ccdi_reports WHERE id = $1`, [req.params.id]);
    if (!rows[0]) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const r = rows[0];
    const sections = Array.isArray(r.sections) ? r.sections : [];
    const escape = (s: string) =>
      String(s)
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, """);

    const sectionHtml = sections
      .map(
        (sec: any) => `
      <section>
        <h2>${escape(sec.heading || "Section")}</h2>
        <pre>${escape(JSON.stringify(sec.body ?? {}, null, 2))}</pre>
      </section>`,
      )
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escape(r.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; color: #0f172a; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.1rem; margin-top: 1.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: .25rem; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 1rem; overflow: auto; font-size: 12px; }
    .meta { color: #64748b; font-size: 0.875rem; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${escape(r.title)}</h1>
  <p class="meta">Type: ${escape(r.report_type)} · Generated: ${escape(String(r.generated_at))} · By: ${escape(String(r.generated_by || "n/a"))}</p>
  <section>
    <h2>Summary</h2>
    <pre>${escape(JSON.stringify(r.summary ?? {}, null, 2))}</pre>
  </section>
  ${sectionHtml}
  <p class="meta">Generated by CINTEXA CCDI. Evidence-backed data only.</p>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ccdi-report-${r.id.slice(0, 8)}.html"`,
    );
    res.send(html);
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.export.html failed");
    res.status(500).json({ error: "HTML export failed" });
  }
});

export default router;
