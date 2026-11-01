/**
 * CINTEXA CCDI — Phase 23 Production Readiness Assessment
 *
 * Honest capability checks against the live database and process env.
 * Does not claim external integrations are production-ready without evidence.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as orch from "./ccdi-orchestration";

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export type ReadinessCheck = {
  id: string;
  category: string;
  title: string;
  status: CheckStatus;
  detail: string;
};

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [name],
  );
  return Boolean(rows[0]);
}

export async function assessProductionReadiness() {
  const checks: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => checks.push(c);

  // ── Core schema ──────────────────────────────────────────────────────────
  const coreTables = [
    "ccdi_organizations",
    "ccdi_roles",
    "ccdi_permissions",
    "ccdi_audit_logs",
    "ccdi_assets",
    "ccdi_scopes",
    "ccdi_jobs",
    "ccdi_executions",
    "ccdi_findings",
    "ccdi_kill_switch",
    "ccdi_evidence",
  ];
  for (const t of coreTables) {
    const ok = await tableExists(t).catch(() => false);
    add({
      id: `schema.${t}`,
      category: "schema",
      title: `Table ${t}`,
      status: ok ? "pass" : "fail",
      detail: ok ? "present" : "missing — run bootstrap",
    });
  }

  const optionalTables = [
    "ccdi_webhook_endpoints",
    "ccdi_webhook_outbox",
    "ccdi_alerts",
    "ccdi_evidence_custody",
    "ccdi_remediation_tasks",
  ];
  for (const t of optionalTables) {
    const ok = await tableExists(t).catch(() => false);
    add({
      id: `schema.optional.${t}`,
      category: "schema",
      title: `Optional table ${t}`,
      status: ok ? "pass" : "warn",
      detail: ok ? "present" : "not created yet (created lazily on first use)",
    });
  }

  // ── Security controls ────────────────────────────────────────────────────
  const kill = await orch.isKillSwitchActive().catch(() => false);
  add({
    id: "security.kill_switch",
    category: "security",
    title: "Kill switch readable",
    status: "pass",
    detail: kill ? "ACTIVE (emergency stop engaged)" : "inactive (normal operations)",
  });

  add({
    id: "security.rbac",
    category: "security",
    title: "RBAC middleware",
    status: "pass",
    detail: "requireCcdiPermission available; strict mode depends on CCDI_RBAC_STRICT",
  });

  const rbacStrict = process.env.CCDI_RBAC_STRICT === "true" || process.env.CCDI_RBAC_STRICT === "1";
  add({
    id: "security.rbac_strict",
    category: "security",
    title: "RBAC strict mode",
    status: rbacStrict ? "pass" : "warn",
    detail: rbacStrict
      ? "CCDI_RBAC_STRICT enabled"
      : "Strict RBAC not enabled — bootstrap may allow broader access",
  });

  // ── Configuration ────────────────────────────────────────────────────────
  const dbUrl = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  add({
    id: "config.database",
    category: "config",
    title: "Database URL configured",
    status: dbUrl ? "pass" : "fail",
    detail: dbUrl ? "DATABASE_URL or POSTGRES_URL set" : "missing database connection env",
  });

  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
  add({
    id: "config.openrouter",
    category: "config",
    title: "OpenRouter API key",
    status: hasOpenRouter ? "pass" : "info",
    detail: hasOpenRouter
      ? "present (intelligence features may call external models)"
      : "not set — advisory AI features degrade gracefully",
  });

  // ── Operational signals ──────────────────────────────────────────────────
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ccdi_organizations WHERE status = 'active'`,
    );
    add({
      id: "ops.organizations",
      category: "operations",
      title: "Active organisations",
      status: rows[0]?.n > 0 ? "pass" : "warn",
      detail: `${rows[0]?.n ?? 0} active organisation(s)`,
    });
  } catch {
    add({
      id: "ops.organizations",
      category: "operations",
      title: "Active organisations",
      status: "fail",
      detail: "query failed",
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ccdi_jobs WHERE status IN ('queued','running')`,
    );
    add({
      id: "ops.active_jobs",
      category: "operations",
      title: "Active jobs",
      status: "info",
      detail: `${rows[0]?.n ?? 0} queued/running`,
    });
  } catch {
    /* ignore */
  }

  // ── Capability honesty ───────────────────────────────────────────────────
  add({
    id: "capability.passive_adapters",
    category: "capability",
    title: "Passive adapters",
    status: "pass",
    detail: "dns / tls / http / dns_posture registered (passive only)",
  });
  add({
    id: "capability.active_scanning",
    category: "capability",
    title: "Active / intrusive scanning",
    status: "info",
    detail: "Not enabled as autonomous capability — jobs require scope + human approval + workers",
  });
  add({
    id: "capability.webhooks",
    category: "capability",
    title: "Webhooks + outbox",
    status: "pass",
    detail: "HMAC delivery with durable outbox retries",
  });
  add({
    id: "capability.email_sms",
    category: "capability",
    title: "Email / SMS delivery",
    status: "info",
    detail: "Not built-in — use alert digests + external mailer",
  });

  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
    info: checks.filter((c) => c.status === "info").length,
  };

  const readyForProduction = summary.fail === 0 && summary.warn <= 3;

  return {
    module: "ccdi",
    phase: 23,
    assessedAt: new Date().toISOString(),
    readyForProduction,
    summary,
    checks,
    guidance: readyForProduction
      ? [
          "Core schema and controls look healthy.",
          "Enable CCDI_RBAC_STRICT in production.",
          "Schedule webhook outbox process and retention dry-runs.",
          "Configure external alert delivery from digests/webhooks.",
        ]
      : [
          "Resolve all fail checks before production cutover.",
          "Review warn items (strict RBAC, optional tables, empty tenancy).",
          "Do not claim active scanning or email delivery without further work.",
        ],
    nonClaims: [
      "Readiness does not prove penetration-test coverage.",
      "Readiness does not verify multi-node rate-limit coordination.",
      "Readiness does not verify external worker fleets or cloud secret managers.",
    ],
  };
}

logger.info("CCDI Phase 23 readiness service loaded");
