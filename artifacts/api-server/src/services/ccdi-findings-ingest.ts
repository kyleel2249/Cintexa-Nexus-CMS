/**
 * CINTEXA CCDI — Phase 14 Findings ingest from adapter results
 */
import { logger } from "../lib/logger";
import * as engines from "./ccdi-engines";
import type { AdapterResult } from "./ccdi-adapters";
import * as webhooks from "./ccdi-webhooks";

export async function ingestAdapterFindings(opts: {
  organizationId: string;
  jobId: string;
  executionId?: string;
  sourceAdapter?: string;
  result: AdapterResult;
}) {
  const findings = opts.result.findings ?? [];
  if (!findings.length) return { ingested: 0, findings: [] as unknown[] };

  const saved: unknown[] = [];
  for (const f of findings) {
    try {
      const row = await engines.upsertFinding({
        organizationId: opts.organizationId,
        jobId: opts.jobId,
        executionId: opts.executionId,
        title: f.title,
        description: f.description,
        severity: f.severity,
        evidenceSummary: f.evidence,
        category: "adapter",
        sourceConnector: opts.sourceAdapter ?? "ccdi-adapter",
        meta: { adapter: opts.sourceAdapter, phase: 14 },
      });
      saved.push(row);

      await webhooks
        .emitCcdiEvent({
          organizationId: opts.organizationId,
          eventType: "finding.created",
          data: {
            findingId: (row as { id?: string }).id,
            title: f.title,
            severity: f.severity,
            jobId: opts.jobId,
          },
        })
        .catch(() => undefined);
    } catch (err) {
      logger.warn({ err, title: f.title }, "ccdi.findings.ingest_one_failed");
    }
  }

  logger.info(
    { jobId: opts.jobId, ingested: saved.length },
    "ccdi.findings.ingested_from_adapter",
  );
  return { ingested: saved.length, findings: saved };
}
