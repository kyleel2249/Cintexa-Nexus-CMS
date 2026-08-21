import { Router } from "express";
import {
  compressJob,
  getJob,
  getJobResult,
  listJobs,
  analyzeBuffer,
  metricsSummary,
  featureEnabled,
  getMaxFileSize,
  type CompressionMode,
} from "../services/cd-optimizer-engine";
import { persistCdJob, loadCdJobsFromDb } from "../services/nexus-tool-store";
import { enforceModuleAuth, tenantMatch } from "../lib/permissions";
import { clearCache } from "../lib/http-cache";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    enabled: featureEnabled(),
    maxFileSize: getMaxFileSize(),
    serviceUrl: process.env.CD_OPTIMIZER_SERVICE_URL || null,
    note: process.env.CD_OPTIMIZER_SERVICE_URL
      ? "External CD Optimizer service configured"
      : "Using Nexus-native zlib/gzip/brotli engine",
  });
});

router.get("/metrics", enforceModuleAuth("cd_optimizer.view", { optional: true }), (_req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "CD Optimizer disabled" });
  res.json(metricsSummary());
});

router.get("/jobs", enforceModuleAuth("cd_optimizer.view", { optional: true }), async (req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "CD Optimizer disabled" });
  const mem = listJobs();
  const dbRows = await loadCdJobsFromDb(req.organizationId);
  const fromDb = dbRows.map((r) => ({
    id: r.id,
    status: r.status,
    mode: r.mode,
    originalName: r.originalName,
    originalSize: r.originalSize,
    optimizedSize: r.optimizedSize,
    percentSaved: r.percentSaved != null ? Number(r.percentSaved) : undefined,
    pipeline: r.pipeline,
    algorithm: r.algorithm,
    createdAt: r.createdAt?.toISOString?.() || r.createdAt,
    organizationId: r.organizationId,
  }));
  const byId = new Map<string, any>();
  for (const j of fromDb) byId.set(j.id, j);
  for (const j of mem) {
    if (tenantMatch(j.organizationId, req.organizationId)) byId.set(j.id, j);
  }
  res.json({ items: [...byId.values()].slice(0, 50) });
});

router.get("/jobs/:id", enforceModuleAuth("cd_optimizer.view", { optional: true }), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!tenantMatch(job.organizationId, req.organizationId)) {
    return res.status(403).json({ error: "Tenant mismatch" });
  }
  res.json(job);
});

router.get("/jobs/:id/download", enforceModuleAuth("cd_optimizer.download", { optional: true }), (req, res) => {
  const job = getJob(req.params.id);
  const data = getJobResult(req.params.id);
  if (!job || !data) return res.status(404).json({ error: "Result not found" });
  if (!tenantMatch(job.organizationId, req.organizationId)) {
    return res.status(403).json({ error: "Tenant mismatch" });
  }
  const name = `${job.originalName}.optimized`;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(data);
});

router.post("/analyze", enforceModuleAuth("cd_optimizer.compress", { optional: true }), async (req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "CD Optimizer disabled" });
  try {
    const { filename, dataBase64 } = req.body ?? {};
    if (!dataBase64) return res.status(400).json({ error: "dataBase64 required" });
    const buf = Buffer.from(String(dataBase64), "base64");
    if (buf.length > getMaxFileSize()) return res.status(413).json({ error: "File too large" });
    res.json(analyzeBuffer(buf, filename || "file.bin"));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Analyze failed" });
  }
});

router.post("/compress", enforceModuleAuth("cd_optimizer.compress", { optional: true }), async (req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "CD Optimizer disabled" });
  try {
    const { filename, dataBase64, mode, mimeType } = req.body ?? {};
    if (!dataBase64) return res.status(400).json({ error: "dataBase64 required" });
    const buf = Buffer.from(String(dataBase64), "base64");
    const job = await compressJob({
      buffer: buf,
      originalName: filename || "upload.bin",
      mimeType,
      mode: (mode as CompressionMode) || "balanced",
      organizationId: req.organizationId,
      userId: req.auth?.sub != null ? String(req.auth.sub) : null,
    });
    await persistCdJob(job);
    clearCache("cd-optimizer");
    res.status(201).json(job);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Compress failed" });
  }
});

router.post("/batch", enforceModuleAuth("cd_optimizer.compress", { optional: true }), async (req, res) => {
  if (!featureEnabled()) return res.status(403).json({ error: "CD Optimizer disabled" });
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ error: "files[] required" });
  const mode = (req.body?.mode as CompressionMode) || "balanced";
  const jobs = [];
  for (const f of files.slice(0, 20)) {
    try {
      const buf = Buffer.from(String(f.dataBase64 || ""), "base64");
      const job = await compressJob({
        buffer: buf,
        originalName: f.filename || "file.bin",
        mimeType: f.mimeType,
        mode,
        organizationId: req.organizationId,
        userId: req.auth?.sub != null ? String(req.auth.sub) : null,
      });
      await persistCdJob(job);
      jobs.push(job);
    } catch (err: any) {
      jobs.push({ status: "failed", error: err?.message, originalName: f.filename });
    }
  }
  res.status(201).json({ items: jobs, count: jobs.length });
});

export default router;
