import test from "node:test";
import assert from "node:assert/strict";
import { callModelChain, parseModelJson, sanitizeNarrative, tierModel, NarrativeSchema, TIER_DEFAULT_MODELS } from "../agents/llm";

test("model chain tries distinct models in order and reports fallback use", async () => {
  const tried: string[] = [];
  const prov: any = { name: "x", external: true, complete: async (r: any) => { tried.push(r.model); if (r.model !== "c") throw new Error("down"); return { text: "ok", model: "c" }; } };
  const out = await callModelChain(prov, ["a", "a", null, "b", "c", "d"], { feature: "t", system: "s", prompt: "p" });
  assert.deepEqual(tried, ["a", "b", "c"]); assert.equal(out.usedFallback, true); assert.equal(out.modelUsed, "c");
  await assert.rejects(() => callModelChain({ ...prov, complete: async () => { throw new Error("all down"); } }, ["a", "b"], { feature: "t", system: "s", prompt: "p" }), /all down/);
});

test("structured output is validated: fenced JSON passes, everything else is rejected", () => {
  const ok = parseModelJson<any>('```json\n{"items":[{"i":0,"narrative":"fine"}]}\n```', NarrativeSchema);
  assert.equal(ok?.items[0]?.narrative, "fine");
  for (const bad of ["", "not json", '{"items":"x"}', '{"items":[{"i":"zero","narrative":"x"}]}', '{"items":[{"i":0}]}', '{"items":[{"i":99,"narrative":"x"}]}', "{" + "a".repeat(10)]) assert.equal(parseModelJson(bad, NarrativeSchema), null, bad.slice(0, 20));
});

test("narratives are inert text: markup and links removed, length bounded", () => {
  assert.equal(sanitizeNarrative("Hi <b>there</b> [x](http://e.example) see https://e.example/p ok"), "Hi there x see [link removed] ok");
  assert.equal(sanitizeNarrative("a".repeat(900), 400).length, 400);
});

test("model tiers: neutral defaults, overridable by environment, never hard-coded in agents", () => {
  assert.equal(tierModel("economy", {}), TIER_DEFAULT_MODELS.economy);
  assert.equal(tierModel("reasoning", { SALES_AI_MODEL_REASONING: " vendor/big " } as any), "vendor/big");
});

test("no model provider or network client ships with the agent layer", async () => {
  const mod: Record<string, unknown> = await import("../agents/llm");
  assert.ok(!Object.keys(mod).some((k) => /openrouter|provider$/i.test(k)), "no vendor adapter is exported");
  for (const m of Object.values(TIER_DEFAULT_MODELS)) assert.ok(!/\//.test(m), "default tier names are not vendor model ids");
});
