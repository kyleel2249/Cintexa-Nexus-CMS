import test from "node:test";
import assert from "node:assert/strict";
import { createOpenRouterProvider, callModelChain, parseModelJson, sanitizeNarrative, tierModel, NarrativeSchema, AiError, TIER_DEFAULT_MODELS } from "../agents/llm";

const KEY = "sk-or-v1-TESTKEY-must-never-leak";
const resp = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;
const base = { resolveKey: async () => KEY, defaultModel: async () => "platform/default", sleep: async () => undefined };

test("OpenRouter adapter: sends the key only in the Authorization header, parses usage and cost", async () => {
  let seen: any;
  const p = createOpenRouterProvider({ ...base, fetchImpl: (async (url: string, init: any) => { seen = { url, init }; return resp(200, { model: "m1", choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.002 } }); }) as any });
  const r = await p.complete({ feature: "t", system: "s", prompt: "p", model: "m1" });
  assert.equal(r.text, "hello"); assert.equal(r.promptTokens, 7); assert.equal(r.costUsd, 0.002);
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!seen.init.body.includes(KEY), "the key is never in the request body");
  assert.equal(JSON.parse(seen.init.body).model, "m1");
});

test("OpenRouter adapter: uses the platform default model when none is given, retries 429/5xx, never retries 4xx", async () => {
  let n = 0; const models: string[] = [];
  const p = createOpenRouterProvider({ ...base, fetchImpl: (async (_u: string, init: any) => { n++; models.push(JSON.parse(init.body).model); return n < 3 ? resp(n === 1 ? 429 : 503, {}) : resp(200, { choices: [{ message: { content: "ok" } }] }); }) as any });
  assert.equal((await p.complete({ feature: "t", system: "s", prompt: "p" })).text, "ok"); assert.equal(n, 3); assert.equal(models[0], "platform/default");
  let m = 0;
  const q = createOpenRouterProvider({ ...base, fetchImpl: (async () => { m++; return resp(401, {}); }) as any });
  await assert.rejects(() => q.complete({ feature: "t", system: "s", prompt: "p" }), (e: any) => e instanceof AiError && !e.retryable && e.status === 401);
  assert.equal(m, 1);
});

test("OpenRouter adapter: missing key, timeouts and empty answers fail safely without leaking the key", async () => {
  await assert.rejects(() => createOpenRouterProvider({ ...base, resolveKey: async () => null, fetchImpl: (async () => resp(200, {})) as any }).complete({ feature: "t", system: "s", prompt: "p" }), /not configured/);
  const slow = createOpenRouterProvider({ ...base, timeoutMs: 20, retries: 0, fetchImpl: ((_u: string, init: any) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as any });
  await assert.rejects(() => slow.complete({ feature: "t", system: "s", prompt: "p" }), (e: any) => /timed out/.test(e.message) && !e.message.includes(KEY));
  const empty = createOpenRouterProvider({ ...base, retries: 0, fetchImpl: (async () => resp(200, { choices: [{ message: { content: "  " } }] })) as any });
  await assert.rejects(() => empty.complete({ feature: "t", system: "s", prompt: "p" }), /no text/);
});

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

test("model tiers: sensible defaults, overridable by environment, never hard-coded in agents", () => {
  assert.equal(tierModel("economy", {}), TIER_DEFAULT_MODELS.economy);
  assert.equal(tierModel("reasoning", { SALES_AI_MODEL_REASONING: " vendor/big " } as any), "vendor/big");
});
