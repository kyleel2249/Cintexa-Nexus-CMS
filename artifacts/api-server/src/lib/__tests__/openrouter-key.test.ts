import assert from "node:assert/strict";
import { normalizeApiKey } from "../openrouter";
import { stripKeyNoise } from "../providers/types";

/** Regression: valid keys must not be rejected by local normalization rules. */
function run() {
  assert.equal(normalizeApiKey("  sk-or-v1-abc123  "), "sk-or-v1-abc123");
  assert.equal(normalizeApiKey("Bearer sk-or-v1-abc123"), "sk-or-v1-abc123");
  assert.equal(normalizeApiKey("bearer sk-or-v1-abc123"), "sk-or-v1-abc123");
  assert.equal(normalizeApiKey('"sk-or-v1-abc123"'), "sk-or-v1-abc123");
  assert.equal(normalizeApiKey("'sk-or-v1-abc123'"), "sk-or-v1-abc123");
  assert.equal(normalizeApiKey(""), "");
  assert.equal(normalizeApiKey(null as any), "");
  // Must not invent or truncate a long valid key
  const long = "sk-or-v1-" + "a".repeat(64);
  assert.equal(normalizeApiKey(long), long);
  assert.equal(stripKeyNoise("Bearer " + long), long);
  console.log("openrouter-key.test.ts: PASS");
}

run();
