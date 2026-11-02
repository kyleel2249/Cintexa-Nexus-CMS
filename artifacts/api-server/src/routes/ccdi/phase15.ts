/**
 * CINTEXA CCDI — Phase 15 routes (PDF export, webhook outbox)
 */
import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { logger } from "../../lib/logger";
import { buildSimplePdf, reportToPdfLines } from "../../services/ccdi-pdf";
import * as outbox from "../../services/ccdi-webhook-queue";
import { requireCcdiPermission } from "../../services/ccdi-rbac";
import { pid } from "./http-util";

const router = Router();

router.get("/reporting/reports/:id/export.pdf", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ccdi_reports WHERE id = $1`, [pid(req.params.id)]);
    if (!rows[0]) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const r = rows[0];
    const mapped = reportToPdfLines({
      title: r.title,
      report_type: r.report_type,
      generated_at: r.generated_at,
      generated_by: r.generated_by,
      summary: r.summary,
      sections: r.sections,
    });
    const pdf = buildSimplePdf(mapped);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ccdi-report-${String(r.id).slice(0, 8)}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    logger.error({ err }, "ccdi.reporting.export.pdf failed");
    res.status(500).json({ error: "PDF export failed" });
  }
});

router.post(
  "/webhooks/outbox/process",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.body?.limit) || 20, 100);
      const result = await outbox.processWebhookOutbox(limit);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "ccdi.webhooks.outbox.process failed");
      res.status(500).json({ error: "Outbox processing failed" });
    }
  },
);

router.get(
  "/webhooks/outbox",
  requireAuth,
  requireCcdiPermission("ccdi.org.admin"),
  async (req: Request, res: Response) => {
    try {
      await outbox.ensureWebhookOutboxSchema();
      const orgId = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
      const params: any[] = [];
      let where = "";
      if (orgId) {
        params.push(orgId);
        where = `WHERE organization_id = $1`;
      }
      params.push(50);
      const { rows } = await pool.query(
        `SELECT id, endpoint_id, organization_id, event_type, attempt_count, max_attempts,
                next_attempt_at, last_error, status, created_at, updated_at
         FROM ccdi_webhook_outbox ${where}
         ORDER BY updated_at DESC LIMIT $${params.length}`,
        params,
      );
      res.json({ outbox: rows });
    } catch (err) {
      logger.error({ err }, "ccdi.webhooks.outbox.list failed");
      res.status(500).json({ error: "Failed to list outbox" });
    }
  },
);

export default router;
