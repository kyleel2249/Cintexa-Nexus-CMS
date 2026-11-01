import { useCallback, useEffect, useRef, useState } from "react";
import { fin, FinanceApiError, getFinanceOrg } from "./api";
import { qs, type Query } from "@/lib/sales/api";
import type { QueryState } from "@/lib/sales/hooks";
import { useToast } from "@/hooks/use-toast";

type Listener = (prefix: string) => void;
const listeners = new Set<Listener>();
/** Make every mounted query whose path starts with `prefix` reload. */
export function invalidateFinance(prefix = ""): void { for (const l of [...listeners]) l(prefix); }

export function useFinanceQuery<T = any>(path: string | null, query?: Query, opts: { enabled?: boolean } = {}): QueryState<T> {
  const enabled = opts.enabled !== false && path !== null;
  const org = getFinanceOrg();
  const key = path === null ? "" : `${org ?? 0}|${path}${qs(query)}`;
  const [s, setS] = useState<{ key: string; data: T | undefined; error: FinanceApiError | null; loading: boolean; refreshing: boolean }>({ key, data: undefined, error: null, loading: enabled, refreshing: false });
  const seq = useRef(0);
  const load = useCallback(async (background: boolean) => {
    if (!enabled || path === null) return;
    const mine = ++seq.current;
    setS((p) => ({ ...p, key, loading: !background && p.key !== key ? true : p.loading && !background, refreshing: background, data: p.key === key ? p.data : undefined, error: null }));
    try {
      const data = await fin.get<T>(path, query);
      if (mine === seq.current) setS({ key, data, error: null, loading: false, refreshing: false });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError" || mine !== seq.current) return;
      setS((p) => ({ ...p, error: e instanceof FinanceApiError ? e : new FinanceApiError(e instanceof Error ? e.message : "Something went wrong", 0, "error"), loading: false, refreshing: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    if (!enabled || path === null) return undefined;
    const l: Listener = (prefix) => { if (path.startsWith(prefix) || prefix === "") void load(true); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [enabled, path, load]);
  return { data: s.key === key ? s.data : undefined, error: s.error, loading: enabled && s.loading, refreshing: s.refreshing, refetch: () => load(true) };
}

interface MutationOptions<R> { invalidate?: string[]; success?: string | ((r: R) => string); onSuccess?: (r: R) => void | Promise<void>; silentError?: boolean }
export function useFinanceMutation<A = void, R = any>(fn: (a: A) => Promise<R>, opts: MutationOptions<R> = {}) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FinanceApiError | null>(null);
  const o = useRef(opts); o.current = opts;
  const f = useRef(fn); f.current = fn;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async (a: A): Promise<R | undefined> => {
    setPending(true); setError(null);
    try {
      const r = await f.current(a);
      for (const p of o.current.invalidate ?? []) invalidateFinance(p);
      const m = typeof o.current.success === "function" ? o.current.success(r) : o.current.success;
      if (m) toast({ title: m });
      if (o.current.onSuccess) await o.current.onSuccess(r);
      return r;
    } catch (e) {
      const err = e instanceof FinanceApiError ? e : new FinanceApiError(e instanceof Error ? e.message : "Something went wrong", 0, "error");
      if (alive.current) setError(err);
      if (!o.current.silentError) toast({ title: err.message, description: err.issues.length > 1 ? err.issues.map((i) => i.message).join(" · ") : undefined, variant: "destructive" });
      return undefined;
    } finally { if (alive.current) setPending(false); }
  }, [toast]);
  return { run, pending, error };
}
