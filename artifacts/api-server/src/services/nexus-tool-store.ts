/**
 * DB persistence for CD Optimizer jobs and Finance analyses.
 * Falls back silently when DATABASE_URL/tables unavailable.
 */
import type { CdJob } from "./cd-optimizer-engine";

export async function persistCdJob(job: CdJob): Promise<boolean> {
  try {
    const { db, cdOptimizerJobsTable } = await import("@workspace/db");
    const row = {
      id: job.id,
      status: job.status,
      mode: job.mode,
      originalName: job.originalName,
      mimeType: job.mimeType || null,
      originalSize: job.originalSize,
      optimizedSize: job.optimizedSize ?? null,
      bytesSaved: job.bytesSaved ?? null,
      percentSaved: job.percentSaved != null ? String(job.percentSaved) : null,
      ratio: job.ratio != null ? String(job.ratio) : null,
      algorithm: job.algorithm || null,
      pipeline: job.pipeline || null,
      qualityScore: job.qualityScore != null ? String(job.qualityScore) : null,
      integrityOk: job.integrityOk ?? null,
      sha256Original: job.sha256Original || null,
      sha256Optimized: job.sha256Optimized || null,
      processingMs: job.processingMs ?? null,
      error: job.error || null,
      organizationId: job.organizationId || null,
      userId: job.userId || null,
      payload: { stages: job.stages },
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
    };
    await db
      .insert(cdOptimizerJobsTable)
      .values(row as any)
      .onConflictDoUpdate({
        target: cdOptimizerJobsTable.id,
        set: {
          status: row.status,
          optimizedSize: row.optimizedSize,
          bytesSaved: row.bytesSaved,
          percentSaved: row.percentSaved,
          ratio: row.ratio,
          algorithm: row.algorithm,
          pipeline: row.pipeline,
          qualityScore: row.qualityScore,
          integrityOk: row.integrityOk,
          sha256Optimized: row.sha256Optimized,
          processingMs: row.processingMs,
          error: row.error,
          payload: row.payload,
          completedAt: row.completedAt,
        } as any,
      });
    return true;
  } catch {
    return false;
  }
}

export async function loadCdJobsFromDb(organizationId?: string | null, limit = 50) {
  try {
    const { db, cdOptimizerJobsTable } = await import("@workspace/db");
    const { desc, eq } = await import("drizzle-orm");
    let rows = await db.select().from(cdOptimizerJobsTable).orderBy(desc(cdOptimizerJobsTable.createdAt)).limit(limit);
    if (organizationId) rows = rows.filter((r) => !r.organizationId || r.organizationId === organizationId);
    return rows;
  } catch {
    return [];
  }
}

export async function persistFinanceAnalysis(record: {
  id: string;
  companyName: string;
  periodLabel?: string;
  currency?: string;
  input: unknown;
  health: unknown;
  distress: unknown;
  survival: unknown;
  organizationId?: string | null;
  userId?: string | null;
  createdAt: string;
}): Promise<boolean> {
  try {
    const { db, nexusFinanceAnalysesTable } = await import("@workspace/db");
    await db.insert(nexusFinanceAnalysesTable).values({
      id: record.id,
      companyName: record.companyName,
      periodLabel: record.periodLabel || null,
      currency: record.currency || "GHS",
      input: record.input as any,
      health: record.health as any,
      distress: record.distress as any,
      survival: record.survival as any,
      organizationId: record.organizationId || null,
      userId: record.userId || null,
      createdAt: new Date(record.createdAt),
    } as any);
    return true;
  } catch {
    return false;
  }
}

export async function loadFinanceAnalysesFromDb(organizationId?: string | null, limit = 50) {
  try {
    const { db, nexusFinanceAnalysesTable } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");
    let rows = await db.select().from(nexusFinanceAnalysesTable).orderBy(desc(nexusFinanceAnalysesTable.createdAt)).limit(limit);
    if (organizationId) rows = rows.filter((r) => !r.organizationId || r.organizationId === organizationId);
    return rows;
  } catch {
    return [];
  }
}
