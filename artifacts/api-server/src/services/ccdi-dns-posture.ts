/**
 * CINTEXA CCDI — Phase 14 Passive DNS posture (SPF / DMARC / MX / CAA)
 * DNS queries only. No network scanning of hosts.
 */
import { resolveTxt, resolveMx, resolveCaa } from "dns/promises";
import type { Adapter, AdapterResult } from "./ccdi-adapters";

function isSafeHostname(t: string): boolean {
  if (!t || t.length > 253) return false;
  if (/[\s;|&$`<>\\]/.test(t)) return false;
  return /^[A-Za-z0-9._-]+$/.test(t);
}

async function collectPosture(domain: string) {
  const [txt, mx, caa] = await Promise.all([
    resolveTxt(domain).catch(() => [] as string[][]),
    resolveMx(domain).catch(() => [] as { exchange: string; priority: number }[]),
    resolveCaa(domain).catch(() => [] as { critical: number; issue?: string; issuewild?: string; iodef?: string }[]),
  ]);

  const flatTxt = txt.map((parts) => parts.join(""));
  const spf = flatTxt.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  const dmarcName = `_dmarc.${domain}`;
  const dmarcTxt = await resolveTxt(dmarcName).catch(() => [] as string[][]);
  const dmarc = dmarcTxt.map((p) => p.join("")).filter((r) => r.toLowerCase().startsWith("v=dmarc1"));

  return {
    domain,
    spf,
    dmarc,
    mx: mx.map((m) => ({ exchange: m.exchange, priority: m.priority })),
    caa: caa.map((c) => ({
      critical: c.critical,
      issue: (c as any).issue,
      issuewild: (c as any).issuewild,
      iodef: (c as any).iodef,
    })),
  };
}

export const passiveDnsPosture: Adapter = {
  key: "passive.dns_posture",
  name: "Passive DNS Email/Cert Posture",
  description: "Checks SPF, DMARC, MX and CAA records. DNS only.",
  jobTypes: ["dns_posture", "email_posture", "spf_dmarc", "passive_dns_posture"],
  async run(ctx) {
    const results: unknown[] = [];
    const findings: NonNullable<AdapterResult["findings"]> = [];

    for (const target of ctx.targets.slice(0, 25)) {
      const domain = target.replace(/^https?:\/\//i, "").split("/")[0]!.split(":")[0]!;
      if (!isSafeHostname(domain)) {
        results.push({ target, error: "target rejected by safety filter" });
        continue;
      }
      try {
        const posture = await collectPosture(domain);
        results.push(posture);

        if (!posture.spf.length) {
          findings.push({
            title: `Missing SPF record: ${domain}`,
            severity: "medium",
            description: "No TXT record starting with v=spf1 was found.",
            evidence: domain,
          });
        } else if (posture.spf.some((s) => /\s\+?all\s*$/i.test(s) || /\s\+all\b/i.test(s))) {
          findings.push({
            title: `SPF allows all (+all): ${domain}`,
            severity: "high",
            description: "SPF policy ends with +all which permits any sender.",
            evidence: posture.spf.join(" | "),
          });
        } else if (posture.spf.some((s) => /\s\?all\b/i.test(s))) {
          findings.push({
            title: `SPF neutral (?all): ${domain}`,
            severity: "low",
            description: "SPF uses ?all (neutral). Prefer ~all or -all.",
            evidence: posture.spf.join(" | "),
          });
        }

        if (!posture.dmarc.length) {
          findings.push({
            title: `Missing DMARC record: ${domain}`,
            severity: "medium",
            description: `No v=DMARC1 record at _dmarc.${domain}.`,
            evidence: `_dmarc.${domain}`,
          });
        } else {
          const policy = posture.dmarc.join(" ");
          if (/p\s*=\s*none/i.test(policy)) {
            findings.push({
              title: `DMARC policy is none: ${domain}`,
              severity: "low",
              description: "DMARC p=none monitors only; consider quarantine/reject when ready.",
              evidence: policy,
            });
          }
        }

        if (!posture.mx.length) {
          findings.push({
            title: `No MX records: ${domain}`,
            severity: "info",
            description: "Domain has no MX records (may be intentional if not mail-enabled).",
            evidence: domain,
          });
        }

        if (!posture.caa.length) {
          findings.push({
            title: `Missing CAA record: ${domain}`,
            severity: "info",
            description: "No CAA records; any CA may issue certificates for this domain.",
            evidence: domain,
          });
        }
      } catch (err: any) {
        results.push({ target, domain, error: String(err?.message || err) });
      }
    }

    const body = JSON.stringify({ results, collectedAt: new Date().toISOString() }, null, 2);
    return {
      success: true,
      stdoutSummary: body.slice(0, 4000),
      metrics: { adapter: "passive.dns_posture", targets: results.length, findings: findings.length },
      evidence: [
        {
          evidenceType: "json",
          storageRef: `inline:dns-posture:${ctx.jobId}`,
          filename: `dns-posture-${ctx.jobId.slice(0, 8)}.json`,
          sizeBytes: body.length,
        },
      ],
      findings,
    };
  },
};
