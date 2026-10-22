import { S } from './validate';
import type { ToolRegistry } from './tools';
import type { IntelDb } from './sql-store';

/** Reads the latest completed Website Intelligence audit (server runtime only: audit history lives in wi_* tables). Page text is untrusted data. */
export function registerWebsiteTools(reg: ToolRegistry, db: IntelDb): void {
  reg.register({
    name: 'wi.latest_audit', risk: 'read', description: 'Latest completed website audit and its highest-priority findings.', args: S.obj({}),
    async handler() {
      const a = (await db.query<any>(`SELECT id, url, hostname, status, to_char(completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') finished_at, scores
        FROM wi_audits WHERE deleted_at IS NULL AND status NOT IN ('queued','running','failed','cancelled') ORDER BY completed_at DESC NULLS LAST LIMIT 1`)).rows[0];
      if (!a) return { audit: null, findings: [] };
      const rows = (await db.query<any>(`SELECT f.fingerprint, f.severity, f.test_id, f.data FROM wi_findings f
        LEFT JOIN wi_finding_workflow w ON w.audit_id = f.audit_id AND w.fingerprint = f.fingerprint
        WHERE f.audit_id = $1 AND f.kind <> 'pass' AND COALESCE(w.status,'open') NOT IN ('resolved','dismissed','accepted_risk','verified') ORDER BY f.priority DESC LIMIT 15`, [a.id])).rows;
      const map: Record<string, string> = { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFORMATIONAL', informational: 'INFORMATIONAL' };
      return { audit: a, findings: rows.map((r) => ({ id: r.fingerprint, severity: map[String(r.severity).toLowerCase()] ?? 'LOW', title: r.data?.title ?? r.test_id, detail: r.data?.detail ?? r.data?.description ?? r.data?.summary ?? '' })) };
    },
  });
}
