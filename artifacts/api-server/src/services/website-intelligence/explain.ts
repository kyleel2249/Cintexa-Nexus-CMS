import type { Finding } from "@workspace/wi-core";
import { deterministicExplanation, type Explanation } from "@workspace/wi-engine/explain";

export type { Explanation } from "@workspace/wi-engine/explain";
export { deterministicExplanation } from "@workspace/wi-engine/explain";

/**
 * Explanations are always built from the recorded audit evidence by the built-in engine; no external model is involved.
 * The `enabled` flag is kept for API compatibility with stored audit settings and has no effect.
 */
export async function explainFinding(f: Finding, _enabled: boolean): Promise<Explanation> {
  return deterministicExplanation(f);
}
