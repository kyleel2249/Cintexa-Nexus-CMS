/**
 * Rule-based security advisory for CCDI. Pure functions: no network, no model. Answers are assembled from the
 * organisation's own recorded findings plus a small built-in knowledge base, and always say where each statement came from.
 */

export interface AdvisoryFinding {
  title: string;
  severity: string;
  status?: string | null;
  cve_id?: string | null;
  remediation?: string | null;
  description?: string | null;
  cvss_score?: number | null;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

const SEVERITY_ACTION: Record<string, string> = {
  critical: "Treat as an incident: assign an owner today, confirm exposure within authorised scope, and fix or isolate first.",
  high: "Schedule remediation in the current cycle and confirm exploitability in authorised scope before prioritising.",
  medium: "Plan remediation in the next maintenance window and track it to closure.",
  low: "Batch with routine maintenance; verify it does not combine with other findings.",
  info: "Record for awareness; no remediation required unless it supports another finding.",
};

interface Topic {
  id: string;
  keywords: RegExp;
  title: string;
  steps: string[];
}

export const KNOWLEDGE_BASE: Topic[] = [
  { id: "patching", keywords: /\b(patch|update|vulnerab|cve|outdated|upgrade)/i, title: "Patching and vulnerability management", steps: ["Inventory the affected assets and their owners.", "Apply vendor patches in a test group first, then production; record the date.", "Re-scan within authorised scope to confirm the fix.", "Where a patch is not possible, restrict network exposure and monitor."] },
  { id: "credentials", keywords: /\b(password|credential|mfa|2fa|login|account takeover|brute)/i, title: "Credentials and access", steps: ["Enforce multi-factor authentication on administrator and remote-access accounts.", "Rotate any credential that may have been exposed and remove unused accounts.", "Apply least privilege: remove standing admin rights that are not needed.", "Review sign-in logs for repeated failures or unusual locations."] },
  { id: "phishing", keywords: /\b(phish|email|spoof|spam|social engineering)/i, title: "Phishing and email security", steps: ["Publish SPF, DKIM and DMARC records for each sending domain.", "Tell staff to report suspicious messages instead of replying or clicking.", "Block known malicious senders and attachments types you never need.", "Confirm with the sender through a separate channel before acting on payment or credential requests."] },
  { id: "ransomware", keywords: /\b(ransom|encrypt|malware|virus|backup)/i, title: "Malware, ransomware and backups", steps: ["Keep at least one backup copy offline or immutable and test a restore.", "Disconnect an affected device from the network before investigating.", "Do not pay or negotiate before preserving evidence and getting qualified incident-response help.", "Check that endpoint protection and updates are running on every device."] },
  { id: "network", keywords: /\b(firewall|port|exposed|network|rdp|ssh|vpn|dns)/i, title: "Network exposure", steps: ["List every internet-facing service and close any that are not required.", "Place remote administration (RDP, SSH) behind a VPN or allow-list.", "Review firewall rules and remove broad 'any' allowances.", "Monitor for new exposed services after each change."] },
  { id: "logging", keywords: /\b(log|monitor|detect|alert|audit|siem|incident)/i, title: "Logging, detection and response", steps: ["Turn on audit logging for sign-ins, administrative changes and data exports.", "Keep logs long enough to investigate (at least 90 days) and protect them from tampering.", "Write down who is called, in what order, when an incident is suspected.", "After each incident record what happened, the cause and the fix."] },
  { id: "data", keywords: /\b(data|privacy|leak|breach|personal|gdpr|compliance)/i, title: "Data protection and breach handling", steps: ["Identify what personal or sensitive data is affected and who it belongs to.", "Contain the exposure first, then document the timeline.", "Check which legal or contractual notification duties apply and their deadlines.", "Take legal or regulatory advice before notifying; this tool does not decide that for you."] },
];

export function rankFindings<T extends AdvisoryFinding>(findings: T[]): T[] {
  return [...findings].sort((a, b) => {
    const ra = SEVERITY_ORDER.indexOf(String(a.severity).toLowerCase());
    const rb = SEVERITY_ORDER.indexOf(String(b.severity).toLowerCase());
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
}

export function matchTopics(question: string): Topic[] {
  return KNOWLEDGE_BASE.filter((t) => t.keywords.test(question)).slice(0, 3);
}

/** Per-finding guidance from recorded fields only. */
export function findingGuidance(f: AdvisoryFinding): string[] {
  const out: string[] = [SEVERITY_ACTION[String(f.severity).toLowerCase()] ?? SEVERITY_ACTION.medium!];
  if (f.cve_id) out.push(`Cross-check ${f.cve_id} against the vendor advisory and your threat-intelligence records.`);
  if (f.remediation && f.remediation.trim()) out.push(`Recorded remediation: ${f.remediation.trim().slice(0, 400)}`);
  else out.push("No remediation is recorded for this finding: add one after confirming the fix with the asset owner.");
  if (f.status === "open") out.push("Status is open: confirm the issue still exists before scheduling work.");
  return out;
}

export function buildAdvisoryAnswer(question: string, findings: AdvisoryFinding[]): string {
  const q = String(question ?? "").trim();
  const lines: string[] = [];
  const ranked = rankFindings(findings.filter((f) => f.status !== "resolved" && f.status !== "false_positive"));

  if (ranked.length) {
    lines.push(`Based on the ${ranked.length} unresolved finding${ranked.length === 1 ? "" : "s"} recorded for this organisation (highest severity first):`);
    ranked.slice(0, 8).forEach((f, i) => {
      lines.push(`${i + 1}. [${String(f.severity).toUpperCase()}] ${f.title}${f.cve_id ? ` (${f.cve_id})` : ""}`);
      findingGuidance(f).slice(0, 3).forEach((g) => lines.push(`   - ${g}`));
    });
  } else {
    lines.push("No unresolved findings were supplied, so this answer uses general guidance only.");
  }

  const topics = matchTopics(q);
  if (topics.length) {
    topics.forEach((t) => {
      lines.push("", `${t.title}:`);
      t.steps.forEach((s) => lines.push(`- ${s}`));
    });
  } else if (!ranked.length) {
    lines.push("", "Start with the basics: multi-factor authentication, patching, tested backups, and logging of sign-ins and administrative changes.");
  }

  lines.push("", "This guidance is rule-based and built from your recorded data and a built-in checklist; it is not a model's judgement. Work only within authorised scope and have a qualified person review it before acting.");
  return lines.join("\n");
}
