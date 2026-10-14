/** Typed client + React Query hooks for /api/v1/website-audits. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuditBundle, AuditComparison, AuditConfig, AuditStatus, AuditSummary, CategoryId, FindingStatus, FindingView, Horizon, Recommendation, RemediationTask, ReportType, Roadmap, TaskStatus,
} from "@workspace/wi-core";
import { apiJson } from "@/lib/api";

const BASE = "/v1/website-audits";

export interface WiMeta {
  scoringVersion: string;
  categories: { id: CategoryId; label: string; weight: number; defaultWeight: number; tests: number }[];
  websiteTypes: { id: string; label: string }[];
  profiles: Record<string, { label: string; description: string; maxPages: number; maxDepth: number; externalLinkCheck: boolean; devices: string[] }>;
  stages: { id: string; label: string }[];
  findingStatuses: FindingStatus[];
  taskStatuses: TaskStatus[];
  reportTypes: ReportType[];
  limits: Record<string, number>;
  totalTests: number;
  scoreFormula: string;
  priorityFormula: string;
  allowAuthenticatedScope: boolean;
  allowPublicShare: boolean;
  queue: { queued?: number; running?: number } & Record<string, unknown>;
  modules: string[];
}

export interface WiStats {
  total: number; running: number; completed: number; failed: number; averageScore: number | null;
  sites: { hostname: string; audits: number; latest: { id: string; overall: number | null; provisional: boolean | null; completedAt: string | null; readiness: string | null }; previousOverall: number | null }[];
  recent: AuditSummary[];
}

export interface WiEvent { id: number; at: string; level: "info" | "warn" | "error"; stage: string | null; message: string }
export interface WiEvents { status: AuditStatus; stage: string | null; stages: AuditSummary["stages"]; progress: AuditSummary["progress"]; events: WiEvent[] }
export interface WiIntegration { id: string; name: string; status: "available" | "not_configured" | "unreachable" | "error"; detail: string; enables?: string[] }
export interface WiMonitor { id: string; ownerId: string; hostname: string; name: string | null; frequency: "daily" | "weekly" | "monthly"; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; lastAuditId: string | null; notify: { email: string[]; webhook: boolean; scoreDropThreshold: number }; config: AuditConfig; workspace: string | null }
export interface WiReportRecord { id: string; type: ReportType; filename: string; bytes: number; pages: number; sha256: string | null; createdBy: string | null; createdAt: string }
export interface WiSettings { weights: Record<CategoryId, number>; limits: Record<string, number>; allowedHosts: string[]; blockedHosts: string[]; aiExplanations: boolean; allowAuthenticatedScope: boolean; allowPublicShare: boolean }
export interface WiCatalogTest { id: string; category: CategoryId; subcategory: string; title: string; measures: string; severity: string; scope: string; method: string; requires: string | null; wcag: string[]; gate: boolean; appliesToTypes: string[] | null; refs: { title: string; url: string }[]; module: string }
export interface WiBenchmarks { own: BenchRow | null; competitors: BenchRow[]; note: string }
export interface BenchRow { id: string; hostname: string; status: AuditStatus; overall: number | null; provisional: boolean | null; coverage: number | null; categories: Record<string, number | null>; pagesSampled: number }
export interface WiExplanation { text: string; source: "ai" | "deterministic"; model?: string | null; disclaimer: string }

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
export const isActive = (s?: AuditStatus | null) => s === "queued" || s === "running";

export const keys = {
  meta: ["wi", "meta"] as const,
  stats: ["wi", "stats"] as const,
  list: (q: string) => ["wi", "list", q] as const,
  audit: (id: string) => ["wi", "audit", id] as const,
  events: (id: string) => ["wi", "events", id] as const,
  bundle: (id: string) => ["wi", "bundle", id] as const,
};

export function useMeta() { return useQuery({ queryKey: keys.meta, queryFn: () => apiJson<WiMeta>(`${BASE}/meta`), staleTime: 5 * 60_000 }); }
export function useStats() { return useQuery({ queryKey: keys.stats, queryFn: () => apiJson<WiStats>(`${BASE}/stats`), refetchInterval: (q) => ((q.state.data?.running ?? 0) > 0 ? 4000 : false) }); }
export function useIntegrations() { return useQuery({ queryKey: ["wi", "integrations"], queryFn: () => apiJson<{ integrations: WiIntegration[] }>(`${BASE}/integrations`).then((r) => r.integrations) }); }
export function useCatalog(category?: string) { return useQuery({ queryKey: ["wi", "catalog", category ?? "all"], queryFn: () => apiJson<{ total: number; tests: WiCatalogTest[] }>(`${BASE}/catalog${category ? `?category=${category}` : ""}`), staleTime: 10 * 60_000 }); }

export function useAudits(params: { search?: string; status?: string; hostname?: string; kind?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return useQuery({ queryKey: keys.list(qs), queryFn: () => apiJson<{ items: AuditSummary[]; total: number }>(`${BASE}?${qs}`), refetchInterval: (q) => (q.state.data?.items.some((a) => isActive(a.status)) ? 4000 : false) });
}

export function useAudit(id: string | undefined) {
  return useQuery({ queryKey: keys.audit(id ?? ""), enabled: Boolean(id), queryFn: () => apiJson<AuditSummary>(`${BASE}/${id}`), refetchInterval: (q) => (isActive(q.state.data?.status) ? 2500 : false) });
}

/** Incremental event feed. Real job state only: no timers, no simulated progress. */
export function useEvents(id: string | undefined, active: boolean) {
  return useQuery({ queryKey: keys.events(id ?? ""), enabled: Boolean(id), queryFn: () => apiJson<WiEvents>(`${BASE}/${id}/events?limit=2000`), refetchInterval: active ? 2000 : false });
}

export function useBundle(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: keys.bundle(id ?? ""), enabled: Boolean(id) && enabled, queryFn: () => apiJson<AuditBundle>(`${BASE}/${id}/bundle`), staleTime: 15_000 });
}

export function usePublicBundle(token: string) {
  return useQuery({ queryKey: ["wi", "public", token], queryFn: () => apiJson<AuditBundle>(`${BASE}/public/${token}`), retry: false });
}

export function useRecommendations(id: string | undefined) {
  return useQuery({ queryKey: ["wi", "recs", id], enabled: Boolean(id), queryFn: () => apiJson<{ recommendations: Recommendation[]; roadmap: Roadmap; formula: string }>(`${BASE}/${id}/recommendations`) });
}
export function useTasks(id: string | undefined) { return useQuery({ queryKey: ["wi", "tasks", id], enabled: Boolean(id), queryFn: () => apiJson<{ tasks: RemediationTask[] }>(`${BASE}/${id}/tasks`).then((r) => r.tasks) }); }
export function useReports(id: string | undefined) { return useQuery({ queryKey: ["wi", "reports", id], enabled: Boolean(id), queryFn: () => apiJson<{ reports: WiReportRecord[]; suggestedFileName: string }>(`${BASE}/${id}/report`) }); }
export function useComparison(id: string | undefined, against?: string) {
  return useQuery({ queryKey: ["wi", "cmp", id, against ?? ""], enabled: Boolean(id), queryFn: () => apiJson<{ comparison: AuditComparison | null; reason?: string; current?: { id: string; completedAt: string | null }; previous?: { id: string; completedAt: string | null } }>(`${BASE}/${id}/comparison${against ? `?against=${against}` : ""}`) });
}
export function useTrend(hostname: string | undefined) {
  return useQuery({ queryKey: ["wi", "trend", hostname], enabled: Boolean(hostname), queryFn: () => apiJson<{ hostname: string; points: { id: string; at: string | null; overall: number | null; provisional: boolean | null; scoringVersion: string; categories: Record<string, number | null> }[] }>(`${BASE}/trend?hostname=${encodeURIComponent(hostname ?? "")}`) });
}
export function useBenchmarks(id: string | undefined) { return useQuery({ queryKey: ["wi", "bench", id], enabled: Boolean(id), queryFn: () => apiJson<WiBenchmarks>(`${BASE}/${id}/benchmarks`), refetchInterval: (q) => (q.state.data?.competitors.some((c) => isActive(c.status)) ? 4000 : false) }); }
export function useMonitors() { return useQuery({ queryKey: ["wi", "monitors"], queryFn: () => apiJson<{ monitors: WiMonitor[] }>(`${BASE}/monitors`).then((r) => r.monitors) }); }
export function useWiSettings(enabled: boolean) { return useQuery({ queryKey: ["wi", "settings"], enabled, queryFn: () => apiJson<WiSettings>(`${BASE}/settings`), retry: false }); }
export function useShare(id: string | undefined) { return useQuery({ queryKey: ["wi", "share", id], enabled: Boolean(id), queryFn: () => apiJson<{ shared: boolean; token: string | null }>(`${BASE}/${id}/share`), retry: false }); }

function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) => { for (const p of prefixes) void qc.invalidateQueries({ queryKey: ["wi", p] }); };
}

export function useCreateAudit() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (cfg: Record<string, unknown>) => apiJson<AuditSummary>(BASE, { method: "POST", ...json(cfg), headers: { "idempotency-key": crypto.randomUUID() } }),
    onSuccess: () => inv("list", "stats"),
  });
}
export function useAuditAction(id: string) {
  const inv = useInvalidate();
  const done = () => inv("audit", "events", "list", "stats", "bundle");
  return {
    cancel: useMutation({ mutationFn: () => apiJson<AuditSummary>(`${BASE}/${id}/cancel`, { method: "POST" }), onSuccess: done }),
    retry: useMutation({ mutationFn: () => apiJson<AuditSummary>(`${BASE}/${id}/retry`, { method: "POST" }), onSuccess: done }),
    remove: useMutation({ mutationFn: (permanent: boolean) => apiJson<null>(`${BASE}/${id}?permanent=${permanent}`, { method: "DELETE" }), onSuccess: done }),
  };
}
export function useRetest(id: string) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (fingerprints: string[]) => apiJson<AuditSummary>(`${BASE}/${id}/retest`, { method: "POST", ...json({ fingerprints }) }), onSuccess: () => inv("bundle", "list", "stats") });
}
export function usePatchFinding(id: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ fp, patch }: { fp: string; patch: Record<string, unknown> }) => apiJson<unknown>(`${BASE}/${id}/findings/${fp}`, { method: "PATCH", ...json(patch) }),
    onSuccess: () => inv("bundle", "findings"),
  });
}
export function useExplain(id: string) { return useMutation({ mutationFn: (fp: string) => apiJson<WiExplanation>(`${BASE}/${id}/findings/${fp}/explain`, { method: "POST" }) }); }
export function useTaskMutations(id: string) {
  const inv = useInvalidate();
  return {
    create: useMutation({ mutationFn: (t: Record<string, unknown>) => apiJson<RemediationTask>(`${BASE}/${id}/tasks`, { method: "POST", ...json(t) }), onSuccess: () => inv("tasks", "bundle") }),
    patch: useMutation({ mutationFn: ({ taskId, patch }: { taskId: string; patch: Record<string, unknown> }) => apiJson<RemediationTask>(`${BASE}/${id}/tasks/${taskId}`, { method: "PATCH", ...json(patch) }), onSuccess: () => inv("tasks", "bundle") }),
    remove: useMutation({ mutationFn: (taskId: string) => apiJson<null>(`${BASE}/${id}/tasks/${taskId}`, { method: "DELETE" }), onSuccess: () => inv("tasks", "bundle") }),
  };
}
export function useRecordReport(id: string) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (b: { type: ReportType; filename: string; bytes: number; pages: number; sha256: string; sections: string[] }) => apiJson<WiReportRecord>(`${BASE}/${id}/report`, { method: "POST", ...json(b) }), onSuccess: () => inv("reports") });
}
export function useShareMutations(id: string) {
  const inv = useInvalidate();
  return {
    create: useMutation({ mutationFn: () => apiJson<{ token: string; path: string; note: string }>(`${BASE}/${id}/share`, { method: "POST" }), onSuccess: () => inv("share") }),
    revoke: useMutation({ mutationFn: () => apiJson<null>(`${BASE}/${id}/share`, { method: "DELETE" }), onSuccess: () => inv("share") }),
  };
}
export function useBenchmarkStart(id: string) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (b: { url: string; name?: string }) => apiJson<AuditSummary>(`${BASE}/${id}/benchmark`, { method: "POST", ...json({ ...b, authorization: { confirmed: true } }) }), onSuccess: () => inv("bench", "list") });
}
export function useMonitorMutations() {
  const inv = useInvalidate();
  return {
    create: useMutation({ mutationFn: (b: Record<string, unknown>) => apiJson<WiMonitor>(`${BASE}/monitors`, { method: "POST", ...json(b) }), onSuccess: () => inv("monitors") }),
    patch: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => apiJson<WiMonitor>(`${BASE}/monitors/${id}`, { method: "PATCH", ...json(patch) }), onSuccess: () => inv("monitors") }),
    remove: useMutation({ mutationFn: (id: string) => apiJson<null>(`${BASE}/monitors/${id}`, { method: "DELETE" }), onSuccess: () => inv("monitors") }),
    run: useMutation({ mutationFn: (id: string) => apiJson<AuditSummary>(`${BASE}/monitors/${id}/run`, { method: "POST" }), onSuccess: () => inv("monitors", "list", "stats") }),
  };
}
export function useSaveSettings() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (s: Partial<WiSettings>) => apiJson<WiSettings>(`${BASE}/settings`, { method: "PUT", ...json(s) }), onSuccess: () => inv("settings", "meta") });
}

export type { FindingView, Horizon };
