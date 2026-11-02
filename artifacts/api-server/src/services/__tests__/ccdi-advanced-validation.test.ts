import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADVANCED_ENGINE_TYPES,
  ADVANCED_CONNECTOR_HINTS,
  ENGINE_JOB_TYPE,
  FORBIDDEN_CONNECTORS,
  validateAssessmentRequest,
  validateDomainFinding,
  validateIotMode,
} from "../ccdi-advanced-validation";

const ORG = "11111111-1111-4111-8111-111111111111";
const SCOPE = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

const base = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  scopeId: SCOPE,
  name: "Quarterly cloud posture",
  engineType: "cloud_audit",
  targets: [{ assetId: ASSET }],
  ...over,
});

// ── assessment request validation ────────────────────────────────────────────

test("valid assessment request is accepted and normalised", () => {
  const r = validateAssessmentRequest(base({ name: "  Posture  " }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.name, "Posture");
});

test("a scope is mandatory (no scope-less advanced assessments)", () => {
  assert.equal(validateAssessmentRequest(base({ scopeId: undefined })).ok, false);
  assert.equal(validateAssessmentRequest(base({ scopeId: "not-a-uuid" })).ok, false);
});

test("organizationId must be a UUID", () => {
  assert.equal(validateAssessmentRequest(base({ organizationId: "1 OR 1=1" })).ok, false);
});

test("unknown engine types, empty/oversized targets and bad names are rejected", () => {
  assert.equal(validateAssessmentRequest(base({ engineType: "exploit_everything" })).ok, false);
  assert.equal(validateAssessmentRequest(base({ targets: [] })).ok, false);
  assert.equal(validateAssessmentRequest(base({ targets: "10.0.0.1" })).ok, false);
  assert.equal(validateAssessmentRequest(base({ targets: new Array(501).fill("a") })).ok, false);
  assert.equal(validateAssessmentRequest(base({ name: "" })).ok, false);
  assert.equal(validateAssessmentRequest(base({ name: "x".repeat(201) })).ok, false);
  assert.equal(validateAssessmentRequest(null).ok, false);
});

test("callers cannot spoof server-controlled parameters", () => {
  const r = validateAssessmentRequest(
    base({ parameters: { engine: "x", phase: 99, approved: true, approvedBy: "me", scopeValidated: true, keep: 1 } }),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.parameters, { keep: 1 });
});

test("every engine maps to a Phase 3 job_type and none maps to active port scanning", () => {
  const allowed = new Set(["asset_discovery", "port_scan", "web_scan", "api_scan", "vuln_scan", "config_audit", "dependency_scan", "custom"]);
  for (const e of ADVANCED_ENGINE_TYPES) {
    assert.ok(allowed.has(ENGINE_JOB_TYPE[e]), `${e} maps to invalid job type`);
    assert.notEqual(ENGINE_JOB_TYPE[e], "port_scan", `${e} must not map to port_scan`);
  }
  assert.notEqual(ENGINE_JOB_TYPE.iot_scan, "port_scan");
});

// ── connector safety ─────────────────────────────────────────────────────────

test("exploitation / active-scanning connectors are rejected", () => {
  for (const key of ["sqlmap", "nmap", "shodan", "metasploit", "SQLMAP"]) {
    const r = validateAssessmentRequest(base({ connectorKey: key }));
    assert.equal(r.ok, false, `${key} should be rejected`);
  }
});

test("connector hints never advertise forbidden tools", () => {
  for (const [domain, keys] of Object.entries(ADVANCED_CONNECTOR_HINTS)) {
    for (const k of keys) assert.ok(!FORBIDDEN_CONNECTORS.has(k), `${domain} hint '${k}' is forbidden`);
  }
});

test("malformed connector keys are rejected", () => {
  for (const key of ["a b", "../etc/passwd", "x;rm -rf /", "$(id)"]) {
    assert.equal(validateAssessmentRequest(base({ connectorKey: key })).ok, false, key);
  }
});

test("dynamic mobile analysis needs mobile_scan and an explicitly authorised test app", () => {
  assert.equal(validateAssessmentRequest(base({ engineType: "mobile_scan", connectorKey: "frida" })).ok, false);
  assert.equal(validateAssessmentRequest(base({ engineType: "cloud_audit", connectorKey: "frida", parameters: { authorisedTestApplication: true } })).ok, false);
  assert.equal(
    validateAssessmentRequest(base({ engineType: "mobile_scan", connectorKey: "frida", parameters: { authorisedTestApplication: true } })).ok,
    true,
  );
});

// ── IoT / OT safety ──────────────────────────────────────────────────────────

test("IoT/OT defaults to passive mode", () => {
  const r = validateAssessmentRequest(base({ engineType: "iot_scan" }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.parameters.mode, "passive");
    assert.equal(r.value.parameters.requiresAdditionalApproval, undefined);
  }
});

test("active IoT/OT is refused without a complete authorisation package", () => {
  assert.equal(validateAssessmentRequest(base({ engineType: "iot_scan", parameters: { mode: "active" } })).ok, false);
  assert.equal(validateIotMode({ mode: "aggressive" }).ok, false);
  const partial = { systemOwnerPermissionRef: "PERM-1", approvedTestProcedureRef: "TP-9" };
  assert.equal(validateIotMode({ mode: "active", otAuthorisation: partial }).ok, false);
  const badWindow = {
    systemOwnerPermissionRef: "PERM-1", approvedTestProcedureRef: "TP-9", qualifiedOtReviewer: "A. Engineer",
    maintenanceWindow: { start: "2026-12-02T02:00:00Z", end: "2026-12-02T01:00:00Z" },
  };
  assert.equal(validateIotMode({ mode: "active", otAuthorisation: badWindow }).ok, false);
});

test("active IoT/OT with full authorisation is drafted but flagged for extra approval and OT review", () => {
  const r = validateAssessmentRequest(
    base({
      engineType: "iot_scan",
      parameters: {
        mode: "active",
        otAuthorisation: {
          systemOwnerPermissionRef: "PERM-1",
          approvedTestProcedureRef: "TP-9",
          qualifiedOtReviewer: "A. Engineer",
          maintenanceWindow: { start: "2026-12-02T01:00:00Z", end: "2026-12-02T03:00:00Z" },
        },
      },
    }),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.parameters.requiresAdditionalApproval, true);
    assert.equal(r.value.parameters.requiresQualifiedOtReview, true);
  }
});

// ── domain findings ──────────────────────────────────────────────────────────

const finding = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG, domain: "cloud", title: "Public bucket", severity: "high", ...over,
});

test("valid finding is accepted; CVE is upper-cased", () => {
  const r = validateDomainFinding(finding({ cveId: "cve-2024-12345", assetId: ASSET }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.cveId, "CVE-2024-12345");
});

test("invalid severity is a validation error (would otherwise hit the DB CHECK constraint)", () => {
  for (const s of ["urgent", "HIGH", "", undefined, 5]) assert.equal(validateDomainFinding(finding({ severity: s })).ok, false, String(s));
});

test("invalid domain, ids, CVE and field types are rejected", () => {
  assert.equal(validateDomainFinding(finding({ domain: "mainframe" })).ok, false);
  assert.equal(validateDomainFinding(finding({ assetId: "abc" })).ok, false);
  assert.equal(validateDomainFinding(finding({ jobId: "abc" })).ok, false);
  assert.equal(validateDomainFinding(finding({ cveId: "CVE-24-1" })).ok, false);
  assert.equal(validateDomainFinding(finding({ title: "" })).ok, false);
  assert.equal(validateDomainFinding(finding({ description: { x: 1 } })).ok, false);
  assert.equal(validateDomainFinding(finding({ meta: [1] })).ok, false);
  assert.equal(validateDomainFinding(finding({ organizationId: "nope" })).ok, false);
});

// ── RBAC regression: every permission code used must exist in the seed ──────

test("every requireCcdiPermission code used in the API exists in CCDI_PERMISSION_SEED", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const apiSrc = join(here, "..", "..");
  const schema = readFileSync(join(apiSrc, "..", "..", "..", "lib", "db", "src", "ccdi-schema.ts"), "utf8");
  const seeded = new Set([...schema.matchAll(/\{ code: "(ccdi\.[a-z_.]+)"/g)].map((m) => m[1]));
  assert.ok(seeded.size >= 20, "could not parse permission seed");

  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? (f === "__tests__" || f === "node_modules" ? [] : walk(p)) : p.endsWith(".ts") ? [p] : [];
    });

  const unseeded: string[] = [];
  for (const file of walk(apiSrc)) {
    for (const m of readFileSync(file, "utf8").matchAll(/requireCcdiPermission\("(ccdi\.[a-z_.]+)"\)/g)) {
      if (!seeded.has(m[1])) unseeded.push(`${file.replace(apiSrc, "")}: ${m[1]}`);
    }
  }
  assert.deepEqual(unseeded, [], "permission codes used but never seeded can never be granted to a role");
});
