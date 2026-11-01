/**
 * CINTEXA CCDI — Phase 10 Connector health checks
 *
 * Validates connector registration and configuration readiness.
 * Does NOT execute external scanners or reach out to targets.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

export type HealthResult = {
  connectorId: string;
  connectorKey: string;
  status: "healthy" | "unhealthy" | "configured" | "registered";
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  lastError?: string | null;
};

/**
 * Perform local readiness checks for a connector.
 * No network probes against customer assets.
 */
export async function checkConnectorHealth(
  connectorId: string,
  organizationId?: string,
): Promise<{ result?: HealthResult; error?: string; status?: number }> {
  const params: any[] = [connectorId];
  let orgClause = "";
  if (organizationId) {
    params.push(organizationId);
    orgClause = ` AND (organization_id = $2 OR organization_id IS NULL)`;
  }

  const { rows } = await pool.query(
    `SELECT * FROM ccdi_connectors WHERE id = $1${orgClause} LIMIT 1`,
    params,
  );
  if (!rows[0]) return { error: "Connector not found", status: 404 };

  const c = rows[0];
  const checks: HealthResult["checks"] = [];

  checks.push({
    name: "registered",
    ok: true,
    detail: `key=${c.connector_key} category=${c.category}`,
  });

  const hasConfig = c.config && typeof c.config === "object" && Object.keys(c.config).length > 0;
  checks.push({
    name: "config_present",
    ok: hasConfig || c.status === "registered",
    detail: hasConfig ? "config object present" : "no config yet (registered-only is OK)",
  });

  checks.push({
    name: "not_disabled",
    ok: c.status !== "disabled",
    detail: c.status === "disabled" ? "connector is disabled" : undefined,
  });

  // Secret ref is optional for many tools; flag if referenced but missing
  if (c.secret_ref_id) {
    const { rows: secrets } = await pool.query(
      `SELECT id FROM ccdi_secret_refs WHERE id = $1`,
      [c.secret_ref_id],
    );
    checks.push({
      name: "secret_ref_valid",
      ok: secrets.length > 0,
      detail: secrets.length ? "secret ref exists" : "secret_ref_id points to missing row",
    });
  } else {
    checks.push({
      name: "secret_ref_valid",
      ok: true,
      detail: "no secret required or not linked",
    });
  }

  const allOk = checks.every((x) => x.ok);
  const nextStatus: HealthResult["status"] = !allOk
    ? "unhealthy"
    : hasConfig
      ? "healthy"
      : "registered";

  await pool.query(
    `UPDATE ccdi_connectors
     SET status = $1,
         health_checked_at = now(),
         last_error = $2,
         updated_at = now()
     WHERE id = $3`,
    [nextStatus === "healthy" ? "healthy" : nextStatus === "unhealthy" ? "unhealthy" : c.status, allOk ? null : checks.find((x) => !x.ok)?.detail ?? "check failed", connectorId],
  );

  logger.info({ connectorId, status: nextStatus }, "ccdi.connector.health");

  return {
    result: {
      connectorId: c.id,
      connectorKey: c.connector_key,
      status: nextStatus,
      checks,
      lastError: allOk ? null : checks.find((x) => !x.ok)?.detail,
    },
  };
}

export async function checkAllConnectors(organizationId?: string) {
  const params: any[] = [];
  let where = "WHERE status <> 'disabled'";
  if (organizationId) {
    params.push(organizationId);
    where += ` AND (organization_id = $1 OR organization_id IS NULL)`;
  }
  const { rows } = await pool.query(
    `SELECT id FROM ccdi_connectors ${where} ORDER BY category, name LIMIT 100`,
    params,
  );
  const results: HealthResult[] = [];
  for (const r of rows) {
    const out = await checkConnectorHealth(r.id, organizationId);
    if (out.result) results.push(out.result);
  }
  return results;
}
