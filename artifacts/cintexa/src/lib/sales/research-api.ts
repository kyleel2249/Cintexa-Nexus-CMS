import { apiJson } from "@/lib/api";

export type JobStatus = "queued" | "researching" | "extracting" | "validating" | "awaiting_review" | "applying" | "completed" | "partial" | "failed" | "cancelled";
export const TERMINAL: JobStatus[] = ["awaiting_review", "completed", "partial", "failed", "cancelled"];
export interface Evidence { id: number; field: string; value: string; kind: "fact" | "estimate" | "hypothesis"; source_url: string | null; source_title: string | null; source_domain: string | null; excerpt: string | null; retrieved_at: string; confidence: number | string; confidence_basis: Record<string, unknown>; verification: "verified" | "corroborated" | "single_source" | "unverified" | "conflicting"; conflict: { values: string[] } | null }
export interface SeoFinding { id: string; area: "seo" | "aeo"; severity: "info" | "low" | "medium" | "high"; observed: string; why: string; url: string | null }
export interface JobView {
  job: { id: number; status: JobStatus; progress: number; stageDetail: string | null; error: string | null; errorCode: string | null; ageMinutes: number | null; pagesFetched: number; input: { companyName?: string; website?: string } };
  result: null | { seoAeo: null | { observed: SeoFinding[]; metrics: Record<string, unknown>; aeoQuestions: { question: string; basis: string }[]; note: string }; hypotheses: { service: string; hypothesis: string; because: string[] }[]; sources: { url: string; title: string | null; fetchedAt: string }[]; skipped: { url: string; reason: string }[]; warnings: string[]; websiteDiscovery: null | { provider: string | null; url: string }; method: string };
  evidence: Evidence[];
  decisions: { field: string; action: string }[];
}
export interface ResearchStatus { enabled: boolean; searchProviders: { id: string; label: string }[]; canSearchByName: boolean; setup: string | null; limits: { perMemberPerHour: number; cacheHours: number; maxPages: number } }

export interface JobRow { id: number; status: JobStatus; progress: number; stage_detail: string | null; error: string | null; error_code: string | null; input: { companyName?: string; website?: string }; pages_fetched: number; created_by: string | null; created_at: string; finished_at: string | null }
const base = "/sales/research";
export const researchApi = {
  status: () => apiJson<ResearchStatus>(`${base}/status`),
  start: (b: { company_name?: string; website?: string; country?: string; industry?: string; entity_type?: string; entity_id?: number; refresh?: boolean }) => apiJson<{ jobId: number; cached: boolean }>(`${base}/company`, { method: "POST", body: JSON.stringify(b) }),
  list: () => apiJson<{ items: JobRow[] }>(`${base}/jobs`),
  get: (id: number) => apiJson<JobView>(`${base}/jobs/${id}`),
  cancel: (id: number) => apiJson(`${base}/jobs/${id}/cancel`, { method: "POST" }),
  decide: (id: number, decisions: { field: string; action: "applied" | "rejected" | "cleared"; previous?: string }[]) => apiJson(`${base}/jobs/${id}/decisions`, { method: "POST", body: JSON.stringify({ decisions }) }),
};
