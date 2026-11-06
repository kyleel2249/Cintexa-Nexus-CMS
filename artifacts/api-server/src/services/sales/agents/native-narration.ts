/**
 * Native (zero external API) narration for sales agents.
 * Produces deterministic headlines and summaries from structured findings/facts only.
 * Never invents companies, numbers, or research; never calls any external service.
 */
export interface NativeFindingLite {
  title?: string;
  whatDetected?: string;
  whyItMatters?: string;
  action?: string;
  severity?: string | number;
  priority?: number;
}

export interface NativeBriefing {
  headline: string;
  summary: string;
  status: "native_deterministic";
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + "…";
}

/** Rank findings by priority/severity for briefing order. */
function rank(f: NativeFindingLite): number {
  if (typeof f.priority === "number") return f.priority;
  const s = String(f.severity ?? "").toLowerCase();
  if (s === "critical" || s === "1") return 100;
  if (s === "high" || s === "2") return 80;
  if (s === "medium" || s === "3") return 50;
  if (s === "low" || s === "4") return 20;
  return 10;
}

/**
 * Build a leader-ready briefing from analyzer findings and optional numeric facts.
 * Pure function — no I/O, no secrets, no network.
 */
export function nativeBriefing(
  findings: NativeFindingLite[],
  facts?: Record<string, unknown>,
): NativeBriefing {
  const list = (Array.isArray(findings) ? findings : [])
    .filter((f) => f && (f.title || f.whatDetected))
    .slice()
    .sort((a, b) => rank(b) - rank(a));

  if (list.length === 0) {
    const open = typeof facts?.open_opportunities === "number" ? facts.open_opportunities : null;
    const pipeline = facts?.pipeline_value != null ? String(facts.pipeline_value) : null;
    const bits: string[] = [];
    if (open != null) bits.push(`${open} open opportunit${open === 1 ? "y" : "ies"}`);
    if (pipeline) bits.push(`pipeline value ${pipeline}`);
    const summary = bits.length
      ? `No agent findings this run. Current snapshot: ${bits.join("; ")}. Run agents after new activity to surface priorities.`
      : "No agent findings this run. Activate agents and run the network after CRM activity to surface priorities.";
    return {
      headline: "No priority findings this cycle",
      summary: clip(summary, 900),
      status: "native_deterministic",
    };
  }

  const top = list[0]!;
  const headline = clip(top.title || top.whatDetected || "Sales priority", 120);
  const parts: string[] = [];
  if (top.whatDetected) parts.push(clip(top.whatDetected, 280));
  if (top.whyItMatters) parts.push(clip(top.whyItMatters, 200));
  if (top.action) parts.push(`Suggested next step: ${clip(top.action, 200)}`);
  if (list.length > 1) {
    const more = list
      .slice(1, 4)
      .map((f) => f.title || f.whatDetected)
      .filter(Boolean)
      .map((t) => clip(String(t), 80));
    if (more.length) parts.push(`Also noted: ${more.join("; ")}.`);
  }
  return {
    headline,
    summary: clip(parts.join(" "), 900),
    status: "native_deterministic",
  };
}

/**
 * Answer a salesperson question using only supplied record facts and findings.
 * Rule-based: keyword match against finding titles/actions; no generative model.
 */
export function nativeContextAnswer(
  question: string,
  facts: Record<string, unknown>,
  findings: NativeFindingLite[],
): string {
  const q = String(question || "").toLowerCase().trim();
  if (!q) {
    return "Ask a specific question about this record. Answers are based only on stored CRM facts and agent findings — no external AI is used.";
  }

  const matched = findings.filter((f) => {
    const blob = `${f.title ?? ""} ${f.whatDetected ?? ""} ${f.action ?? ""}`.toLowerCase();
    return q.split(/\s+/).some((w) => w.length > 3 && blob.includes(w));
  });

  const lines: string[] = [];
  if (matched.length) {
    for (const f of matched.slice(0, 3)) {
      if (f.whatDetected) lines.push(clip(f.whatDetected, 200));
      else if (f.title) lines.push(clip(f.title, 120));
      if (f.action) lines.push(`Action: ${clip(f.action, 160)}`);
    }
  } else if (findings.length) {
    lines.push(`No finding directly matches that question. Top finding: ${clip(findings[0]!.title || findings[0]!.whatDetected || "—", 200)}`);
  }

  const keys = Object.keys(facts || {}).filter((k) => facts[k] != null && facts[k] !== "");
  if (keys.length) {
    const sample = keys.slice(0, 8).map((k) => `${k}=${clip(String(facts[k]), 60)}`).join("; ");
    lines.push(`Record fields: ${sample}`);
  }

  if (!lines.length) {
    return "Insufficient stored data to answer from CRM facts alone. Add activity, notes, or run agents on this record.";
  }
  return clip(lines.join(" "), 600);
}
