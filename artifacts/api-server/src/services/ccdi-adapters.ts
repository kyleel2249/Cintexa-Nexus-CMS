/**
 * CINTEXA CCDI — Phase 12 Worker Adapters
 *
 * Adapters execute ONLY after a job has been claimed through the control plane
 * (approved scope, human approval, kill-switch clear).
 *
 * Built-in adapters:
 * - demo.echo — no network; returns parameters for pipeline testing
 * - passive.dns — DNS resolution of targets already in an approved scope
 *
 * No port scanners, vulnerability scanners, or exploit tools are included.
 */
import { resolve4, resolve6 } from "dns/promises";
import { logger } from "../lib/logger";

export type AdapterContext = {
  jobId: string;
  organizationId: string;
  jobType: string;
  parameters: Record<string, unknown>;
  targets: string[];
  workerId: string;
};

export type AdapterResult = {
  success: boolean;
  stdoutSummary?: string;
  stderrSummary?: string;
  metrics?: Record<string, unknown>;
  evidence?: Array<{
    evidenceType: string;
    storageRef: string;
    filename?: string;
    sha256?: string;
    sizeBytes?: number;
  }>;
  findings?: Array<{
    title: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    description?: string;
    evidence?: string;
  }>;
};

export type Adapter = {
  key: string;
  name: string;
  description: string;
  /** job_type values this adapter handles */
  jobTypes: string[];
  run: (ctx: AdapterContext) => Promise<AdapterResult>;
};

// ── Built-in adapters ──────────────────────────────────────────────────────

const demoEcho: Adapter = {
  key: "demo.echo",
  name: "Demo Echo",
  description: "No network. Echoes job parameters for control-plane testing.",
  jobTypes: ["demo", "echo", "pipeline_test"],
  async run(ctx) {
    const payload = {
      jobId: ctx.jobId,
      targets: ctx.targets,
      parameters: ctx.parameters,
      workerId: ctx.workerId,
      ranAt: new Date().toISOString(),
    };
    return {
      success: true,
      stdoutSummary: JSON.stringify(payload).slice(0, 2000),
      metrics: { adapter: "demo.echo", targetCount: ctx.targets.length },
      evidence: [
        {
          evidenceType: "json",
          storageRef: `inline:demo-echo:${ctx.jobId}`,
          filename: `demo-echo-${ctx.jobId.slice(0, 8)}.json`,
          sizeBytes: JSON.stringify(payload).length,
        },
      ],
    };
  },
};

/** Allow only hostnames/IPs that look like normal targets; no shell metacharacters. */
function isSafeTarget(t: string): boolean {
  if (!t || t.length > 253) return false;
  // hostname or IPv4/IPv6-ish — reject spaces and shell chars
  if (/[\s;|&$`<>\\]/.test(t)) return false;
  return /^[A-Za-z0-9._:\\[\\]-]+$/.test(t);
}

const passiveDns: Adapter = {
  key: "passive.dns",
  name: "Passive DNS Lookup",
  description: "Resolves A/AAAA for approved-scope hostnames. No port scanning.",
  jobTypes: ["dns_lookup", "passive_dns", "asset_resolve"],
  async run(ctx) {
    const results: Array<{ target: string; a?: string[]; aaaa?: string[]; error?: string }> = [];
    for (const target of ctx.targets.slice(0, 50)) {
      if (!isSafeTarget(target)) {
        results.push({ target, error: "target rejected by safety filter" });
        continue;
      }
      try {
        const [a, aaaa] = await Promise.all([
          resolve4(target).catch(() => [] as string[]),
          resolve6(target).catch(() => [] as string[]),
        ]);
        results.push({ target, a, aaaa });
      } catch (err: any) {
        results.push({ target, error: String(err?.message || err) });
      }
    }

    const body = JSON.stringify({ results, resolvedAt: new Date().toISOString() }, null, 2);
    return {
      success: true,
      stdoutSummary: body.slice(0, 4000),
      metrics: {
        adapter: "passive.dns",
        targets: results.length,
        resolved: results.filter((r) => (r.a?.length || r.aaaa?.length)).length,
      },
      evidence: [
        {
          evidenceType: "json",
          storageRef: `inline:passive-dns:${ctx.jobId}`,
          filename: `passive-dns-${ctx.jobId.slice(0, 8)}.json`,
          sizeBytes: body.length,
        },
      ],
      findings: results
        .filter((r) => r.error)
        .map((r) => ({
          title: `DNS resolution issue: ${r.target}`,
          severity: "info" as const,
          description: r.error,
        })),
    };
  },
};

const ADAPTERS: Adapter[] = [demoEcho, passiveDns];

export function listAdapters() {
  return ADAPTERS.map((a) => ({
    key: a.key,
    name: a.name,
    description: a.description,
    jobTypes: a.jobTypes,
  }));
}

export function resolveAdapter(jobType: string): Adapter | null {
  const t = String(jobType || "").toLowerCase();
  return ADAPTERS.find((a) => a.jobTypes.includes(t) || a.key === t) ?? null;
}

/**
 * Run an adapter for a claimed job context.
 * Callers must ensure the job was legitimately claimed.
 */
export async function runAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const adapter = resolveAdapter(ctx.jobType);
  if (!adapter) {
    return {
      success: false,
      stderrSummary: `No adapter registered for job_type=${ctx.jobType}. Available: ${ADAPTERS.map((a) => a.key).join(", ")}`,
    };
  }
  logger.info({ jobId: ctx.jobId, adapter: adapter.key }, "ccdi.adapter.run");
  try {
    return await adapter.run(ctx);
  } catch (err: any) {
    logger.error({ err, jobId: ctx.jobId }, "ccdi.adapter.error");
    return {
      success: false,
      stderrSummary: String(err?.message || err),
    };
  }
}

logger.info({ adapters: ADAPTERS.map((a) => a.key) }, "CCDI Phase 12 adapters loaded");
