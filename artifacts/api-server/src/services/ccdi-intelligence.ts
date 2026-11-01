/**
 * CINTEXA CCDI — Phase 6 Intelligence, Automation & AI Agents
 *
 * - Correlation of findings / assets / attack surface
 * - Risk prioritisation scoring
 * - Automated triage suggestions
 * - SOAR-style workflow definitions (advisory / semi-automated only)
 * - Threat intelligence record store (manual + feed stubs)
 * - AI advisory agents (recommendation only — no autonomous exploitation)
 *
 * All AI output is advisory. Kill-switch and scope rules still apply.
 * No autonomous attack or unauthorised action is taken.
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { getOpenRouterClient, getOpenRouterModel } from "../lib/openrouter";
import * as orch from "./ccdi-orchestration";

// ── Schema statements (appended at runtime via bootstrap if needed) ────────

export const CCDI_PHASE6_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ccdi_threat_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  indicator_type TEXT NOT NULL CHECK (indicator_type IN ('ip','domain','url','hash','cve','email','other')),
  indicator_value TEXT NOT NULL,
  title TEXT,
  description TEXT,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('info','low','medium','high','critical')),
  confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_threat_intel_org ON ccdi_threat_intel(organization_id, last_seen_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_threat_intel_value ON ccdi_threat_intel(indicator_value)`,

  `CREATE TABLE IF NOT EXISTS ccdi_correlations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('info','low','medium','high','critical')),
  score NUMERIC(5,2) NOT NULL DEFAULT 0,
  finding_ids UUID[] NOT NULL DEFAULT '{}',
  asset_ids UUID[] NOT NULL DEFAULT '{}',
  intel_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_correlations_org ON ccdi_correlations(organization_id, severity, status)`,

  `CREATE TABLE IF NOT EXISTS ccdi_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('finding_created','severity_threshold','manual','schedule','correlation')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_workflows_org ON ccdi_workflows(organization_id, enabled)`,

  `CREATE TABLE IF NOT EXISTS ccdi_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES ccdi_workflows(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_workflow_runs_wf ON ccdi_workflow_runs(workflow_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS ccdi_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES ccdi_organizations(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('triage','prioritisation','correlation','advisory','remediation')),
  input_summary TEXT,
  output_summary TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','running','completed','failed')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS ix_ccdi_agent_runs_org ON ccdi_agent_runs(organization_id, created_at DESC)`,
];

// ── Risk prioritisation ────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high: 75,
  medium: 40,
  low: 15,
  info: 5,
};

export function computePriorityScore(finding: {
  severity: string;
  cvss_score?: number | null;
  status?: string;
  asset_risk?: string;
}): number {
  let score = SEVERITY_WEIGHT[finding.severity] ?? 20;
  if (finding.cvss_score != null) {
    score = Math.max(score, Number(finding.cvss_score) * 10);
  }
  if (finding.asset_risk === "critical" || finding.asset_risk === "high") {
    score += 15;
  }
  if (finding.status === "resolved" || finding.status === "false_positive") {
    score = 0;
  }
  return Math.min(100, Math.round(score));
}

export async function prioritiseFindings(organizationId: string, limit = 50) {
  const { rows } = await pool.query(
    `SELECT f.id, f.title, f.severity, f.cvss_score, f.status, f.asset_id, f.cve_id,
            a.risk_level AS asset_risk, a.name AS asset_name
     FROM ccdi_findings f
     LEFT JOIN ccdi_assets a ON a.id = f.asset_id
     WHERE f.organization_id = $1 AND f.status IN ('open','confirmed','in_progress')
     ORDER BY
       CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
       f.cvss_score DESC NULLS LAST
     LIMIT $2`,
    [organizationId, limit],
  );

  return rows.map((r) => ({
    ...r,
    priorityScore: computePriorityScore(r),
  })).sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── Correlation (rule-based foundation) ────────────────────────────────────

export async function runCorrelation(organizationId: string) {
  // Group open critical/high findings by asset
  const { rows: groups } = await pool.query(
    `SELECT asset_id,
            array_agg(id) AS finding_ids,
            count(*)::int AS cnt,
            max(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS max_sev
     FROM ccdi_findings
     WHERE organization_id = $1 AND status IN ('open','confirmed') AND severity IN ('critical','high')
     GROUP BY asset_id
     HAVING count(*) >= 2`,
    [organizationId],
  );

  const created = [];
  for (const g of groups) {
    const severity = g.max_sev >= 4 ? "critical" : "high";
    const score = g.cnt * (severity === "critical" ? 25 : 15);
    const { rows } = await pool.query(
      `INSERT INTO ccdi_correlations
         (organization_id, title, summary, severity, score, finding_ids, asset_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        organizationId,
        `Multiple high-severity findings on same asset (${g.cnt})`,
        `Correlated ${g.cnt} open high/critical findings on asset ${g.asset_id ?? "unknown"}`,
        severity,
        Math.min(100, score),
        g.finding_ids,
        g.asset_id ? [g.asset_id] : [],
      ],
    );
    created.push(rows[0]);
  }
  return created;
}

// ── Automated triage (rules + optional AI) ─────────────────────────────────

export async function triageFinding(findingId: string, organizationId: string, actor: string) {
  const { rows } = await pool.query(
    `SELECT * FROM ccdi_findings WHERE id = $1 AND organization_id = $2`,
    [findingId, organizationId],
  );
  if (!rows[0]) return { error: "Finding not found", status: 404 as const };
  const f = rows[0];

  const suggestions: string[] = [];
  if (f.severity === "critical" || f.severity === "high") {
    suggestions.push("Escalate to security manager and create remediation task.");
  }
  if (f.cve_id) {
    suggestions.push(`Cross-check ${f.cve_id} against threat intelligence and vendor advisories.`);
  }
  if (!f.remediation) {
    suggestions.push("Request remediation guidance from advisory agent or knowledge base.");
  }
  if (f.status === "open") {
    suggestions.push("Confirm exploitability in authorised scope before prioritising for fix.");
  }

  // Optional AI enrichment (advisory only)
  let aiAdvice: string | null = null;
  try {
    const client = await getOpenRouterClient();
    if (client) {
      const model = await getOpenRouterModel();
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a senior cybersecurity analyst for CINTEXA CCDI. Provide concise, actionable triage advice only. Never suggest unauthorised scanning or exploitation. Output plain text.",
          },
          {
            role: "user",
            content: `Triage this finding:\nTitle: ${f.title}\nSeverity: ${f.severity}\nCVE: ${f.cve_id ?? "n/a"}\nDescription: ${(f.description || "").slice(0, 800)}`,
          },
        ],
        max_tokens: 400,
      });
      aiAdvice = completion.choices[0]?.message?.content?.trim() ?? null;
    }
  } catch (err) {
    logger.warn({ err }, "ccdi.triage AI enrichment failed (non-fatal)");
  }

  await pool.query(
    `INSERT INTO ccdi_agent_runs (organization_id, agent_type, input_summary, output_summary, status, created_by, meta)
     VALUES ($1, 'triage', $2, $3, 'completed', $4, $5)`,
    [
      organizationId,
      f.title,
      aiAdvice ?? suggestions.join(" "),
      actor,
      JSON.stringify({ findingId, ruleSuggestions: suggestions, aiUsed: Boolean(aiAdvice) }),
    ],
  );

  return {
    findingId,
    ruleSuggestions: suggestions,
    aiAdvice,
    priorityScore: computePriorityScore(f),
    note: "Triage is advisory only. No automatic status change or exploitation is performed.",
  };
}

// ── AI advisory agent ──────────────────────────────────────────────────────

export async function runAdvisoryAgent(opts: {
  organizationId: string;
  question: string;
  contextFindingIds?: string[];
  actor: string;
}) {
  if (await orch.isKillSwitchActive()) {
    return { error: "Global emergency stop is active", status: 503 as const };
  }

  const client = await getOpenRouterClient();
  if (!client) {
    return {
      error: "OpenRouter is not configured. Set OPENROUTER_API_KEY or platform settings.",
      status: 503 as const,
    };
  }

  let contextBlock = "";
  if (opts.contextFindingIds?.length) {
    const { rows } = await pool.query(
      `SELECT title, severity, cve_id, status, remediation FROM ccdi_findings
       WHERE organization_id = $1 AND id = ANY($2::uuid[]) LIMIT 20`,
      [opts.organizationId, opts.contextFindingIds],
    );
    contextBlock = rows
      .map((r) => `- [${r.severity}] ${r.title} (CVE: ${r.cve_id ?? "n/a"}, status: ${r.status})`)
      .join("\n");
  }

  const model = await getOpenRouterModel();
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are the CINTEXA CCDI Security Advisory Agent. Provide accurate, evidence-based cybersecurity recommendations. Never recommend unauthorised scanning, exploitation, or actions outside approved scope. Be concise and practical.",
      },
      {
        role: "user",
        content: contextBlock
          ? `Context findings:\n${contextBlock}\n\nQuestion: ${opts.question}`
          : opts.question,
      },
    ],
    max_tokens: 800,
  });

  const answer = completion.choices[0]?.message?.content?.trim() ?? "No response generated.";

  await pool.query(
    `INSERT INTO ccdi_agent_runs (organization_id, agent_type, input_summary, output_summary, model, status, created_by)
     VALUES ($1, 'advisory', $2, $3, $4, 'completed', $5)`,
    [opts.organizationId, opts.question.slice(0, 500), answer.slice(0, 2000), model, opts.actor],
  );

  return {
    answer,
    model,
    note: "Advisory only. Human review required before any operational action.",
  };
}

// ── Threat intel ───────────────────────────────────────────────────────────

export async function addThreatIntel(opts: {
  organizationId?: string | null;
  source: string;
  indicatorType: string;
  indicatorValue: string;
  title?: string;
  description?: string;
  severity?: string;
  confidence?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}) {
  const { rows } = await pool.query(
    `INSERT INTO ccdi_threat_intel
       (organization_id, source, indicator_type, indicator_value, title, description, severity, confidence, tags, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      opts.organizationId ?? null,
      opts.source,
      opts.indicatorType,
      opts.indicatorValue,
      opts.title ?? null,
      opts.description ?? null,
      opts.severity ?? "medium",
      opts.confidence ?? "medium",
      opts.tags ?? [],
      opts.meta ?? {},
    ],
  );
  return rows[0];
}

// ── Workflows (SOAR-style definitions) ─────────────────────────────────────

export async function createWorkflow(opts: {
  organizationId: string;
  name: string;
  description?: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  steps?: unknown[];
  createdBy: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO ccdi_workflows
       (organization_id, name, description, trigger_type, trigger_config, steps, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      opts.organizationId,
      opts.name,
      opts.description ?? null,
      opts.triggerType,
      opts.triggerConfig ?? {},
      JSON.stringify(opts.steps ?? []),
      opts.createdBy,
    ],
  );
  return rows[0];
}

logger.info("CCDI Phase 6 intelligence service loaded");
