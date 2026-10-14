import type { Finding } from "@workspace/wi-core";
import { getOpenRouterClient, getOpenRouterModel } from "../../lib/openrouter";
import { logger } from "../../lib/logger";

export interface Explanation {
  source: "ai" | "deterministic";
  label: string;
  summary: string;
  whyItMatters: string;
  steps: string[];
  caveats: string[];
  generatedAt: string;
}

export function deterministicExplanation(f: Finding): Explanation {
  const why = [f.impact.user, f.impact.search, f.impact.business, f.impact.security].filter(Boolean).join(" ") || "This condition differs from the documented standard the test checks.";
  const steps = [f.fix, ...f.implementation.split(/(?<=\.)\s+/).filter(Boolean).slice(0, 4), `Verify: ${f.verify}`];
  const caveats = [
    f.provenance === "inferred" || f.verification !== "verified" ? "This result is a heuristic inference and should be confirmed manually before acting." : "",
    f.measurementMethod ? `How it was measured: ${f.measurementMethod}` : "",
    "The expected outcome is that the test passes after a retest. It is not a forecast of traffic, ranking or revenue.",
  ].filter(Boolean);
  return { source: "deterministic", label: "Generated from the audit evidence by fixed rules", summary: `${f.title}: ${f.description}${f.actual ? ` (observed: ${f.actual})` : ""}.`, whyItMatters: why, steps, caveats, generatedAt: new Date().toISOString() };
}

/** AI-assisted explanation. The model only restates and organises the supplied evidence; it never creates results. */
export async function explainFinding(f: Finding, enabled: boolean): Promise<Explanation> {
  const base = deterministicExplanation(f);
  if (!enabled) return base;
  try {
    const client = await getOpenRouterClient();
    if (!client) return base;
    const evidence = JSON.stringify({ test: f.title, severity: f.severity, status: f.status, description: f.description, observed: f.actual, expected: f.expected, affectedCount: f.affectedCount, applicableCount: f.applicableCount, evidence: f.evidence.slice(0, 5), method: f.measurementMethod, provenance: f.provenance, confidence: f.confidence, recommendedFix: f.fix, implementation: f.implementation });
    const completion = await client.chat.completions.create({
      model: await getOpenRouterModel(),
      messages: [
        { role: "system", content: "You explain website-audit findings to site owners. Use ONLY the evidence in the JSON. Never invent measurements, URLs, tools, traffic, ranking or revenue predictions. If the evidence is a heuristic inference, say so. Return JSON: {\"summary\": string (max 60 words), \"whyItMatters\": string (max 70 words), \"steps\": string[] (3-6 concrete steps), \"caveats\": string[] (0-3)}. Output only JSON." },
        { role: "user", content: evidence },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<Explanation>;
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.steps)) return base;
    return {
      source: "ai",
      label: "AI-assisted explanation of the audit evidence. It restates the evidence and is not an additional test result.",
      summary: parsed.summary.slice(0, 600),
      whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters.slice(0, 700) : base.whyItMatters,
      steps: parsed.steps.filter((s): s is string => typeof s === "string").slice(0, 8).map((s) => s.slice(0, 400)),
      caveats: [...(Array.isArray(parsed.caveats) ? parsed.caveats.filter((c): c is string => typeof c === "string").slice(0, 3) : []), "Expected outcome: the test passes after a retest; no traffic, ranking or revenue change is predicted."],
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ err }, "AI explanation failed; using deterministic explanation");
    return base;
  }
}
