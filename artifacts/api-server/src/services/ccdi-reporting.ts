/**
 * CINTEXA CCDI — Phase 7 Reporting, Compliance & Executive Dashboards
 *
 * - Compliance framework catalogue and control mappings
 * - Posture and trend summaries (evidence-backed only)
 * - Report generation (executive / operational / audit)
 * - Evidence package assembly
 *
 * All metrics are derived from real database records. No fabricated statistics.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import * as engines from "./ccdi-engines";

export const CCDI_PHASE7_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_compliance_frameworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,

  `CREATE TABLE IF NOT EXISTS ccdi_compliance_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID NOT NULL REFERENCES ccdi_compliance_frameworks(id) ON DELETE CASCADE,
  control_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (framework_id, control_id)
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_controls_framework ON ccdi_compliance_controls(framework_id)`,

  `CREATE TABLE IF NOT EXISTS ccdi_compliance_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  control_id UUID NOT NULL REFERENCES ccdi_compliance_controls(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_assessed' CHECK (status IN (
    'not_assessed','in_progress','compliant','partial','non_compliant','not_applicable'
  )),
  evidence_notes TEXT,
  finding_ids UUID[] NOT NULL DEFAULT '{}',
  assessed_by TEXT,
  assessed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, control_id)
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_compliance_map_org ON ccdi_compliance_mappings(organization_id, status)`,

  `CREATE TABLE IF NOT EXISTS ccdi_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('executive','operational','audit','compliance','evidence_package')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('draft','generated','archived')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_by TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_reports_org ON ccdi_reports(organization_id, generated_at DESC)`,
];

/** Seed standard frameworks (idempotent). */
export async function seedComplianceFrameworks() {
  const frameworks = [
    { code: "ISO27001", name: "ISO/IEC 27001", version: "2022", description: "Information security management" },
    { code: "NIST-CSF", name: "NIST Cybersecurity Framework", version: "2.0", description: "Identify, Protect, Detect, Respond, Recover" },
    { code: "CIS-CONTROLS", name: "CIS Critical Security Controls", version: "v8", description: "Prioritised defensive actions" },
    { code: "PCI-DSS", name: "PCI DSS", version: "4.0", description: "Payment card industry data security" },
    { code: "SOC2", name: "SOC 2", version: "2017", description: "Trust services criteria" },
    { code: "GDPR", name: "GDPR", version: "2018", description: "EU general data protection regulation (security-relevant controls)" },
  ];

  for (const f of frameworks) {
    await pool.query(
      `INSERT INTO ccdi_compliance_frameworks (code, name, version, description)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (code) DO NOTHING`,
      [f.code, f.name, f.version, f.description],
    );
  }

  // Seed a minimal set of NIST CSF example controls
  const { rows: nist } = await pool.query(
    `SELECT id FROM ccdi_compliance_frameworks WHERE code = 'NIST-CSF' LIMIT 1`,
  );
  if (nist[0]) {
    const controls = [
      { id: "ID.AM-1", title: "Physical devices and systems inventoried", category: "Identify" },
      { id: "ID.AM-2", title: "Software platforms and applications inventoried", category: "Identify" },
      { id: "PR.AC-1", title: "Identities and credentials managed", category: "Protect" },
      { id: "PR.DS-1", title: "Data-at-rest protected", category: "Protect" },
      { id: "DE.CM-1", title: "Networks monitored", category: "Detect" },
      { id: "RS.RP-1", title: "Response plan executed", category: "Respond" },
      { id: "RC.RP-1", title: "Recovery plan executed", category: "Recover" },
    ];
    for (const c of controls) {
      await pool.query(
        `INSERT INTO ccdi_compliance_controls (framework_id, control_id, title, category)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (framework_id, control_id) DO NOTHING`,
        [nist[0].id, c.id, c.title, c.category],
      );
    }
  }
}

// ── Posture summary (evidence-backed) ──────────────────────────────────────

export async function buildPostureSummary(organizationId: string) {
  const findings = await engines.findingsSummary(organizationId);

  const [assets, jobs, evidence, compliance] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'approved')::int AS approved,
              count(*) FILTER (WHERE risk_level IN ('high','critical'))::int AS high_risk
       FROM ccdi_assets WHERE organization_id = $1 AND status <> 'retired'`,
      [organizationId],
    ),
    pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
              count(*) FILTER (WHERE status IN ('queued','running'))::int AS active
       FROM ccdi_jobs WHERE organization_id = $1`,
      [organizationId],
    ),
    pool.query(
      `SELECT count(*)::int AS total FROM ccdi_evidence WHERE organization_id = $1`,
      [organizationId],
    ),
    pool.query(
      `SELECT
         count(*)::int AS mapped,
         count(*) FILTER (WHERE status = 'compliant')::int AS compliant,
         count(*) FILTER (WHERE status = 'non_compliant')::int AS non_compliant,
         count(*) FILTER (WHERE status = 'partial')::int AS partial,
         count(*) FILTER (WHERE status = 'not_assessed')::int AS not_assessed
       FROM ccdi_compliance_mappings WHERE organization_id = $1`,
      [organizationId],
    ),
  ]);

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    assets: assets.rows[0] ?? { total: 0, approved: 0, high_risk: 0 },
    findings,
    jobs: jobs.rows[0] ?? { total: 0, succeeded: 0, active: 0 },
    evidenceCount: evidence.rows[0]?.total ?? 0,
    compliance: compliance.rows[0] ?? {
      mapped: 0, compliant: 0, non_compliant: 0, partial: 0, not_assessed: 0,
    },
    note: "All figures are derived from live database records.",
  };
}

// ── Report generation ──────────────────────────────────────────────────────

export async function generateReport(opts: {
  organizationId: string;
  reportType: "executive" | "operational" | "audit" | "compliance" | "evidence_package";
  title?: string;
  generatedBy: string;
}) {
  const posture = await buildPostureSummary(opts.organizationId);

  const sections: Array<{ heading: string; body: unknown }> = [];

  if (opts.reportType === "executive" || opts.reportType === "operational") {
    sections.push(
      { heading: "Security Posture Overview", body: posture },
      {
        heading: "Key Risk Indicators",
        body: {
          openCriticalFindings: posture.findings.critical ?? 0,
          openHighFindings: posture.findings.high ?? 0,
          highRiskAssets: posture.assets.high_risk ?? 0,
          activeJobs: posture.jobs.active ?? 0,
        },
      },
    );
  }

  if (opts.reportType === "compliance" || opts.reportType === "audit") {
    const { rows: mappings } = await pool.query(
      `SELECT m.status, c.control_id, c.title, f.code AS framework
       FROM ccdi_compliance_mappings m
       JOIN ccdi_compliance_controls c ON c.id = m.control_id
       JOIN ccdi_compliance_frameworks f ON f.id = c.framework_id
       WHERE m.organization_id = $1
       ORDER BY f.code, c.control_id
       LIMIT 500`,
      [opts.organizationId],
    );
    sections.push(
      { heading: "Compliance Summary", body: posture.compliance },
      { heading: "Control Mappings", body: mappings },
    );
  }

  if (opts.reportType === "evidence_package" || opts.reportType === "audit") {
    const { rows: evidence } = await pool.query(
      `SELECT id, evidence_type, filename, sha256, collected_at, job_id
       FROM ccdi_evidence WHERE organization_id = $1
       ORDER BY collected_at DESC LIMIT 200`,
      [opts.organizationId],
    );
    sections.push({ heading: "Evidence Inventory", body: evidence });
  }

  if (opts.reportType === "operational") {
    const { rows: recentFindings } = await pool.query(
      `SELECT id, title, severity, status, cve_id, last_seen_at
       FROM ccdi_findings WHERE organization_id = $1 AND status IN ('open','confirmed','in_progress')
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, last_seen_at DESC
       LIMIT 50`,
      [opts.organizationId],
    );
    sections.push({ heading: "Open Findings (Top 50)", body: recentFindings });
  }

  const title =
    opts.title ||
    `${opts.reportType.charAt(0).toUpperCase() + opts.reportType.slice(1)} Report — ${new Date().toISOString().slice(0, 10)}`;

  const { rows } = await pool.query(
    `INSERT INTO ccdi_reports
       (organization_id, report_type, title, status, summary, sections, generated_by)
     VALUES ($1,$2,$3,'generated',$4,$5,$6)
     RETURNING *`,
    [
      opts.organizationId,
      opts.reportType,
      title,
      JSON.stringify(posture),
      JSON.stringify(sections),
      opts.generatedBy,
    ],
  );

  await pool.query(
    `INSERT INTO ccdi_audit_logs (organization_id, actor_ref, action, entity_type, entity_id, meta)
     VALUES ($1,$2,'report.generate','report',$3,$4)`,
    [opts.organizationId, opts.generatedBy, rows[0].id, JSON.stringify({ reportType: opts.reportType })],
  );

  return rows[0];
}

// ── Compliance mapping helpers ─────────────────────────────────────────────

export async function upsertComplianceMapping(opts: {
  organizationId: string;
  controlId: string;
  status: string;
  evidenceNotes?: string;
  findingIds?: string[];
  assessedBy: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO ccdi_compliance_mappings
       (organization_id, control_id, status, evidence_notes, finding_ids, assessed_by, assessed_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (organization_id, control_id) DO UPDATE SET
       status = EXCLUDED.status,
       evidence_notes = EXCLUDED.evidence_notes,
       finding_ids = EXCLUDED.finding_ids,
       assessed_by = EXCLUDED.assessed_by,
       assessed_at = now(),
       updated_at = now()
     RETURNING *`,
    [
      opts.organizationId,
      opts.controlId,
      opts.status,
      opts.evidenceNotes ?? null,
      opts.findingIds ?? [],
      opts.assessedBy,
    ],
  );
  return rows[0];
}

logger.info("CCDI Phase 7 reporting service loaded");
