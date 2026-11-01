/**
 * CINTEXA CCDI — Phase 12–14 Worker Adapters
 *
 * Adapters execute ONLY after a job has been claimed through the control plane
 * (approved scope, human approval, kill-switch clear).
 *
 * Built-in adapters:
 * - demo.echo — no network; returns parameters for pipeline testing
 * - passive.dns — DNS resolution of targets already in an approved scope
 * - passive.tls — TLS certificate metadata (no vulnerability scanning)
 * - passive.http — HTTP HEAD/GET metadata (headers only, no crawling)
 * - passive.dns_posture — SPF/DMARC/MX/CAA DNS checks
 *
 * No port scanners, vulnerability scanners, or exploit tools are included.
 */
import { resolve4, resolve6 } from "dns/promises";
import tls from "tls";
import { logger } from "../lib/logger";
import { passiveDnsPosture } from "./ccdi-dns-posture";

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
  jobTypes: string[];
  run: (ctx: AdapterContext) => Promise<AdapterResult>;
};

/** Allow only hostnames/IPs that look like normal targets; no shell metacharacters. */
function isSafeTarget(t: string): boolean {
  if (!t || t.length > 253) return false;
  if (/[\s;|&$`<>\\]/.test(t)) return false;
  return /^[A-Za-z0-9._:\[\]-]+$/.test(t);
}

function stripUrlToHost(target: string): { host: string; port: number } | null {
  let host = target.trim();
  let port = 443;
  try {
    if (host.includes("://")) {
      const u = new URL(host);
      host = u.hostname;
      port = u.port ? Number(u.port) : u.protocol === "http:" ? 80 : 443;
    } else if (host.includes(":") && !host.includes("://") && !host.startsWith("[")) {
      const parts = host.split(":");
      if (parts.length === 2 && /^\d+$/.test(parts[1]!)) {
        host = parts[0]!;
        port = Number(parts[1]);
      }
    }
  } catch {
    return null;
  }
  if (!isSafeTarget(host)) return null;
  if (port < 1 || port > 65535) return null;
  return { host, port };
}

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
        resolved: results.filter((r) => r.a?.length || r.aaaa?.length).length,
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

function fetchTlsMeta(host: string, port: number, timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol();
        const cipher = socket.getCipher();
        socket.end();
        if (!cert || !Object.keys(cert).length) {
          reject(new Error("No peer certificate"));
          return;
        }
        resolve({
          host,
          port,
          protocol,
          cipher: cipher ? { name: cipher.name, version: cipher.version } : null,
          subject: cert.subject,
          issuer: cert.issuer,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
          serialNumber: cert.serialNumber,
          fingerprint: cert.fingerprint,
          fingerprint256: cert.fingerprint256,
          subjectaltname: cert.subjectaltname,
        });
      },
    );
    socket.on("error", (err) => reject(err));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timeout"));
    });
  });
}

const passiveTls: Adapter = {
  key: "passive.tls",
  name: "Passive TLS Certificate Metadata",
  description: "Collects certificate subject/issuer/validity. No cipher brute-force or vuln scanning.",
  jobTypes: ["tls_cert", "passive_tls", "cert_metadata"],
  async run(ctx) {
    const results: Array<Record<string, unknown>> = [];
    const findings: AdapterResult["findings"] = [];

    for (const target of ctx.targets.slice(0, 25)) {
      const parsed = stripUrlToHost(target);
      if (!parsed) {
        results.push({ target, error: "target rejected by safety filter" });
        continue;
      }
      try {
        const meta = await fetchTlsMeta(parsed.host, parsed.port === 80 ? 443 : parsed.port);
        results.push(meta);

        if (typeof meta.valid_to === "string") {
          const exp = new Date(meta.valid_to as string).getTime();
          const days = (exp - Date.now()) / (86400 * 1000);
          if (days < 0) {
            findings!.push({
              title: `TLS certificate expired: ${parsed.host}`,
              severity: "high",
              description: `Certificate valid_to=${meta.valid_to}`,
            });
          } else if (days < 30) {
            findings!.push({
              title: `TLS certificate expires within 30 days: ${parsed.host}`,
              severity: "medium",
              description: `Certificate valid_to=${meta.valid_to}`,
            });
          }
        }
      } catch (err: any) {
        results.push({ target, host: parsed.host, error: String(err?.message || err) });
      }
    }

    const body = JSON.stringify({ results, collectedAt: new Date().toISOString() }, null, 2);
    return {
      success: true,
      stdoutSummary: body.slice(0, 4000),
      metrics: { adapter: "passive.tls", targets: results.length },
      evidence: [
        {
          evidenceType: "json",
          storageRef: `inline:passive-tls:${ctx.jobId}`,
          filename: `passive-tls-${ctx.jobId.slice(0, 8)}.json`,
          sizeBytes: body.length,
        },
      ],
      findings,
    };
  },
};

const passiveHttp: Adapter = {
  key: "passive.http",
  name: "Passive HTTP Metadata",
  description: "HTTP HEAD (fallback GET) for status and security-relevant response headers only.",
  jobTypes: ["http_headers", "passive_http", "header_check"],
  async run(ctx) {
    const results: Array<Record<string, unknown>> = [];
    const findings: AdapterResult["findings"] = [];

    for (const target of ctx.targets.slice(0, 25)) {
      let url = target.trim();
      if (!/^https?:\/\//i.test(url)) {
        if (!isSafeTarget(url)) {
          results.push({ target, error: "target rejected by safety filter" });
          continue;
        }
        url = `https://${url}`;
      } else {
        try {
          const u = new URL(url);
          if (!isSafeTarget(u.hostname)) {
            results.push({ target, error: "hostname rejected by safety filter" });
            continue;
          }
        } catch {
          results.push({ target, error: "invalid URL" });
          continue;
        }
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res = await fetch(url, {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "CINTEXA-CCDI-Passive/1.0" },
        });
        if (res.status === 405 || res.status === 501) {
          res = await fetch(url, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: { "User-Agent": "CINTEXA-CCDI-Passive/1.0" },
          });
        }
        clearTimeout(timer);

        const headerNames = [
          "strict-transport-security",
          "content-security-policy",
          "x-frame-options",
          "x-content-type-options",
          "referrer-policy",
          "permissions-policy",
          "server",
          "x-powered-by",
          "location",
        ];
        const headers: Record<string, string> = {};
        for (const h of headerNames) {
          const v = res.headers.get(h);
          if (v) headers[h] = v;
        }

        results.push({ url, status: res.status, statusText: res.statusText, headers });

        if (!headers["strict-transport-security"] && url.startsWith("https:")) {
          findings!.push({
            title: `Missing HSTS header: ${url}`,
            severity: "low",
            description: "strict-transport-security not present on HTTPS response",
          });
        }
        if (!headers["x-content-type-options"]) {
          findings!.push({
            title: `Missing X-Content-Type-Options: ${url}`,
            severity: "info",
            description: "Consider nosniff",
          });
        }
      } catch (err: any) {
        results.push({ target, url, error: String(err?.message || err) });
      }
    }

    const body = JSON.stringify({ results, collectedAt: new Date().toISOString() }, null, 2);
    return {
      success: true,
      stdoutSummary: body.slice(0, 4000),
      metrics: { adapter: "passive.http", targets: results.length },
      evidence: [
        {
          evidenceType: "json",
          storageRef: `inline:passive-http:${ctx.jobId}`,
          filename: `passive-http-${ctx.jobId.slice(0, 8)}.json`,
          sizeBytes: body.length,
        },
      ],
      findings,
    };
  },
};

const ADAPTERS: Adapter[] = [demoEcho, passiveDns, passiveTls, passiveHttp, passiveDnsPosture];

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

logger.info({ adapters: ADAPTERS.map((a) => a.key) }, "CCDI Phase 14 adapters loaded");
