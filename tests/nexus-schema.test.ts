/** The shipped SQL migration must contain exactly the statements the code bootstraps at runtime. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEXUS_SCHEMA_SQL } from "../functions/_lib/nexus-db.ts";

const norm = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/;\s*$/, "").trim();

test("migrations/d1/0009_nexus_sync_v2.sql matches NEXUS_SCHEMA_SQL", () => {
  const file = readFileSync(new URL("../migrations/d1/0009_nexus_sync_v2.sql", import.meta.url), "utf8");
  const fromFile = file.split(/;\s*(?:\n|$)/).map(norm).filter(Boolean);
  assert.deepEqual(fromFile, NEXUS_SCHEMA_SQL.map(norm));
});
