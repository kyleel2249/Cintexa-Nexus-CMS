import { aggregateOutcomes, applyRetestOutcome, type AuditConfig, type AuditSummary, type Finding, type RetestStatus } from "@workspace/wi-core";
import * as store from "./store";

/** Builds the configuration of a targeted retest: only the affected URLs and tests of the selected findings. */
export function buildRetestConfig(parent: AuditSummary, findings: Finding[], email: string): AuditConfig {
  const urls = [...new Set(findings.flatMap((f) => f.affectedUrls))].slice(0, 25);
  return {
    ...parent.config,
    importantPages: urls,
    maxPages: Math.min(30, urls.length + 2),
    maxDepth: 1,
    profile: "standard",
    externalLinkCheck: findings.some((f) => f.testId === "func.links.external_broken"),
    authenticated: { ...parent.config.authenticated, enabled: false, credentialSupplied: false },
    retest: { parentAuditId: parent.id, fingerprints: findings.map((f) => f.fingerprint), testIds: [...new Set(findings.map((f) => f.testId))] },
    authorization: { ...parent.config.authorization, confirmedBy: email, confirmedAt: new Date().toISOString() },
  };
}

/** After a retest audit finishes, records the result on the findings of the audit it verifies. */
export async function finalizeRetest(retestAuditId: string): Promise<void> {
  const audit = await store.getAudit(retestAuditId);
  const rt = audit?.config.retest;
  if (!audit || !rt) return;
  const results = await store.loadChecks(retestAuditId);
  const outcomes = aggregateOutcomes(results);
  const finished = audit.status === "completed" || audit.status === "partial";
  for (const fp of rt.fingerprints) {
    const parentFinding = (await store.loadFindings(rt.parentAuditId)).find((f) => f.fingerprint === fp);
    if (!parentFinding) continue;
    const o = outcomes.get(parentFinding.testId);
    let outcome: RetestStatus = "inconclusive";
    if (finished && o) {
      if (o.status === "passed" || o.status === "not_applicable") outcome = "passed";
      else if (o.status === "failed" || o.status === "warning") outcome = "failed";
    }
    const wf = await store.getWorkflow(rt.parentAuditId, fp);
    if (!wf) continue;
    const next = applyRetestOutcome(wf, outcome);
    await store.patchWorkflow(rt.parentAuditId, fp, {
      status: next.status, retestStatus: next.retestStatus, retestAuditId,
      ...(outcome === "passed" ? { verifiedAt: new Date(), verifiedBy: `retest ${retestAuditId}`, verificationMethod: "retest" as const } : {}),
    });
  }
}
