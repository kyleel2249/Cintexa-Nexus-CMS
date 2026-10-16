import type { Finding } from "@workspace/wi-core";

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
