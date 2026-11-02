/**
 * CCDI foundation — API client, organisation context and small shared UI pieces.
 * All calls go to /api/ccdi/v1. No secret value is ever held in client state after submission.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { ApiError, apiJson } from "@/lib/api";

const ORG_KEY = "ccdi.organizationId";

export function readStoredOrg(): string | null {
  try {
    return window.localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

function storeOrg(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ORG_KEY, id);
    else window.localStorage.removeItem(ORG_KEY);
  } catch {
    /* storage unavailable: selection lasts for this page view only */
  }
}

export function v1<T = any>(path: string, init: RequestInit & { orgId?: string | null } = {}): Promise<T> {
  const { orgId, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (orgId) headers.set("x-ccdi-organization", orgId);
  return apiJson<T>(`/ccdi/v1${path}`, { ...rest, headers });
}

export function post<T = any>(path: string, body: unknown, method = "POST"): Promise<T> {
  return v1<T>(path, { method, body: JSON.stringify(body) });
}

export type Org = { id: string; name: string; slug: string; status: string };

type OrgState = {
  orgs: Org[];
  orgId: string | null;
  org: Org | null;
  setOrgId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
  accessMode: "open" | "enforced" | null;
};

const OrgCtx = createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgIdState] = useState<string | null>(() => readStoredOrg());
  const health = useQuery({ queryKey: ["ccdi", "v1", "health"], queryFn: () => v1<{ accessMode: "open" | "enforced" }>("/health"), staleTime: 30_000 });
  const list = useQuery({ queryKey: ["ccdi", "v1", "orgs"], queryFn: () => v1<{ organizations: Org[] }>("/organizations?limit=100") });

  const orgs = list.data?.organizations ?? [];
  useEffect(() => {
    if (!list.data) return;
    if (orgId && !orgs.some((o) => o.id === orgId)) {
      // A stored id that the server no longer lists (deleted, or no membership) must not be reused.
      setOrgIdState(orgs[0]?.id ?? null);
      storeOrg(orgs[0]?.id ?? null);
    } else if (!orgId && orgs.length) {
      setOrgIdState(orgs[0].id);
      storeOrg(orgs[0].id);
    }
  }, [list.data, orgId, orgs]);

  const setOrgId = useCallback((id: string | null) => {
    setOrgIdState(id);
    storeOrg(id);
  }, []);

  const value = useMemo<OrgState>(
    () => ({
      orgs,
      orgId,
      org: orgs.find((o) => o.id === orgId) ?? null,
      setOrgId,
      loading: list.isLoading,
      error: list.error ? (list.error as Error).message : null,
      reload: () => void list.refetch(),
      accessMode: health.data?.accessMode ?? null,
    }),
    [orgs, orgId, setOrgId, list.isLoading, list.error, list.refetch, health.data],
  );
  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>;
}

export function useOrg(): OrgState {
  const v = useContext(OrgCtx);
  if (!v) throw new Error("useOrg must be used inside OrgProvider");
  return v;
}

export function errMessage(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.";
}

export function isDenied(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isDenied(error)) return <AccessDenied detail={errMessage(error)} />;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex-1">
        <p>{errMessage(error)}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function AccessDenied({ detail }: { detail?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-6 py-12 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">Access denied</h2>
      <p className="max-w-md text-sm text-muted-foreground">{detail || "You do not have permission to view this area."}</p>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function NeedsOrg() {
  const { loading, error, orgs } = useOrg();
  if (loading) return <Loading label="Loading organisations…" />;
  if (error) return <ErrorState error={new Error(error)} />;
  return (
    <Empty
      title={orgs.length ? "Select an organisation" : "No organisation yet"}
      hint={orgs.length ? "Choose one from the selector in the header." : "Create the first organisation from Users and Access."}
    />
  );
}

export function Panel({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  const tone =
    kind === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : kind === "error"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
        : "border-cyan-500/30 bg-cyan-500/10 text-cyan-100";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-1 border-b border-border/60">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
            value === t.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
