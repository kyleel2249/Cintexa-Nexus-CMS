import type { CheckResult, Confidence, Device, Evidence, Provenance, TestStatus } from "@workspace/wi-core";

export interface ResultExtra {
  actual?: string;
  expected?: string;
  evidence?: Evidence[];
  provenance?: Provenance;
  confidence?: Confidence;
  note?: string;
  device?: Device;
}

/** Collects check results for one page or for the site. Keeps result construction uniform and honest. */
export class Collector {
  readonly results: CheckResult[] = [];
  constructor(private readonly url: string | undefined, private readonly pageWeight?: number) {}

  add(testId: string, status: TestStatus, extra: ResultExtra = {}): void {
    const r: CheckResult = {
      testId,
      status,
      provenance: extra.provenance ?? (status === "not_tested" || status === "blocked" || status === "inconclusive" ? "unavailable" : "observed"),
      confidence: extra.confidence ?? "high",
      observedAt: new Date().toISOString(),
    };
    if (this.url) r.url = this.url;
    if (this.pageWeight && this.pageWeight !== 1) r.pageWeight = this.pageWeight;
    if (extra.actual !== undefined) r.actual = extra.actual.slice(0, 600);
    if (extra.expected !== undefined) r.expected = extra.expected.slice(0, 300);
    if (extra.evidence?.length) r.evidence = extra.evidence.slice(0, 8).map((e) => ({ ...e, value: e.value.slice(0, 500) }));
    if (extra.note) r.note = extra.note.slice(0, 500);
    if (extra.device) r.device = extra.device;
    this.results.push(r);
  }

  pass(id: string, extra?: ResultExtra) { this.add(id, "passed", extra); }
  fail(id: string, extra?: ResultExtra) { this.add(id, "failed", extra); }
  warn(id: string, extra?: ResultExtra) { this.add(id, "warning", extra); }
  info(id: string, extra?: ResultExtra) { this.add(id, "informational", extra); }
  na(id: string, note?: string) { this.add(id, "not_applicable", { note, provenance: "observed" }); }
  blocked(id: string, note: string) { this.add(id, "blocked", { note }); }
  inconclusive(id: string, note: string, extra?: ResultExtra) { this.add(id, "inconclusive", { ...extra, note }); }
  notTested(id: string, note: string) { this.add(id, "not_tested", { note }); }

  /** Pass / fail helper. */
  check(id: string, ok: boolean, extra: ResultExtra = {}): void { this.add(id, ok ? "passed" : "failed", extra); }
  /** Three-way helper: pass, warn or fail. */
  grade(id: string, level: "pass" | "warn" | "fail", extra: ResultExtra = {}): void { this.add(id, level === "pass" ? "passed" : level === "warn" ? "warning" : "failed", extra); }
}

export const ev = (kind: Evidence["kind"], label: string, value: string): Evidence => ({ kind, label, value });
export const inferred: ResultExtra = { provenance: "inferred", confidence: "medium" };
export const measured: ResultExtra = { provenance: "measured", confidence: "high" };
export const trunc = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
