import { SEARCH_AND_PERFORMANCE_TESTS } from "./catalog-search";
import { QUALITY_TESTS } from "./catalog-quality";
import type { AuditConfig, AuditModules, TestDefinition, WebsiteType } from "./types";

/** The complete, versioned test catalogue. Every result the engine produces refers to one of these ids. */
export const ALL_TESTS: readonly TestDefinition[] = Object.freeze([...SEARCH_AND_PERFORMANCE_TESTS, ...QUALITY_TESTS]);

export const TEST_BY_ID: ReadonlyMap<string, TestDefinition> = new Map(ALL_TESTS.map((t) => [t.id, t]));

export function getTest(id: string): TestDefinition | undefined {
  return TEST_BY_ID.get(id);
}

/** Structural validation of the catalogue: unique ids, resolvable dependencies. Used by tests and at boot. */
export function validateCatalog(tests: readonly TestDefinition[] = ALL_TESTS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of tests) {
    if (seen.has(t.id)) problems.push(`duplicate test id ${t.id}`);
    seen.add(t.id);
  }
  for (const t of tests) {
    for (const d of t.dependsOn ?? []) if (!seen.has(d)) problems.push(`${t.id} depends on unknown test ${d}`);
    if (!t.fix || !t.pass || !t.fail || t.refs.length === 0) problems.push(`${t.id} is missing required narrative fields`);
  }
  return problems;
}

/** Whether a test is in scope for an audit configuration (module switch and website type). */
export function testApplies(t: TestDefinition, cfg: Pick<AuditConfig, "modules" | "websiteType">): boolean {
  if (!cfg.modules[t.module]) return false;
  if (t.appliesToTypes && t.appliesToTypes.length > 0 && !t.appliesToTypes.includes(cfg.websiteType)) return false;
  return true;
}

export function testsForConfig(cfg: Pick<AuditConfig, "modules" | "websiteType">): TestDefinition[] {
  return ALL_TESTS.filter((t) => testApplies(t, cfg));
}

export function testsByModule(): Record<keyof AuditModules, TestDefinition[]> {
  const out = {} as Record<keyof AuditModules, TestDefinition[]>;
  for (const t of ALL_TESTS) (out[t.module] ??= []).push(t);
  return out;
}

export function testsForType(type: WebsiteType): TestDefinition[] {
  return ALL_TESTS.filter((t) => !t.appliesToTypes || t.appliesToTypes.length === 0 || t.appliesToTypes.includes(type));
}
