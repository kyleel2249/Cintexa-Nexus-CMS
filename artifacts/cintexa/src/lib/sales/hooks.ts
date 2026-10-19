import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sales, qs, SalesApiError, type Query } from "./api";
import { useToast } from "@/hooks/use-toast";

interface Entry {
  data: unknown;
  at: number;
}
const cache = new Map<string, Entry>();
type Listener = (prefix: string) => void;
const listeners = new Set<Listener>();
const FRESH_MS = 20_000;

/** Drop cached responses whose request path starts with `prefix` and make mounted queries reload. */
export function invalidateSales(prefix = ""): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix) || prefix === "") cache.delete(k);
  for (const l of [...listeners]) l(prefix);
}

export interface QueryState<T> {
  data: T | undefined;
  error: SalesApiError | null;
  /** true until the first response (or error) arrives */
  loading: boolean;
  /** true while a background reload is running */
  refreshing: boolean;
  refetch: () => Promise<void>;
}

interface QueryOptions {
  enabled?: boolean;
  /** keep showing the previous data while parameters change (tables, pagination) */
  keepPrevious?: boolean;
}

export function useSalesQuery<T = any>(path: string | null, query?: Query, opts: QueryOptions = {}): QueryState<T> {
  const enabled = opts.enabled !== false && path !== null;
  const key = path === null ? "" : `${path}${qs(query)}`;
  const [state, setState] = useState<{ key: string; data: T | undefined; error: SalesApiError | null; loading: boolean; refreshing: boolean }>(() => {
    const hit = enabled ? cache.get(key) : undefined;
    return { key, data: hit?.data as T | undefined, error: null, loading: enabled && !hit, refreshing: false };
  });
  const seq = useRef(0);
  const queryRef = useRef<Query | undefined>(query);
  queryRef.current = query;

  const load = useCallback(
    async (force: boolean) => {
      if (!enabled || path === null) return;
      const mine = ++seq.current;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < FRESH_MS) {
        setState({ key, data: hit.data as T, error: null, loading: false, refreshing: false });
        return;
      }
      setState((s) => {
        const shown = (hit?.data as T | undefined) ?? (opts.keepPrevious ? s.data : undefined);
        return { key, data: shown, error: null, loading: shown === undefined, refreshing: shown !== undefined };
      });
      try {
        const data = await sales.get<T>(path, queryRef.current);
        if (mine !== seq.current) return;
        cache.set(key, { data, at: Date.now() });
        setState({ key, data, error: null, loading: false, refreshing: false });
      } catch (e) {
        if (mine !== seq.current) return;
        if ((e as { name?: string })?.name === "AbortError") return;
        const err = e instanceof SalesApiError ? e : new SalesApiError(e instanceof Error ? e.message : "Request failed", 0, "error");
        setState((s) => ({ key, data: opts.keepPrevious ? s.data : undefined, error: err, loading: false, refreshing: false }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, enabled],
  );

  useEffect(() => {
    void load(false);
    return () => {
      seq.current++;
    };
  }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const l: Listener = (prefix) => {
      if (path !== null && (prefix === "" || key.startsWith(prefix))) void load(true);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [enabled, key, path, load]);

  return {
    data: state.key === key ? state.data : opts.keepPrevious ? state.data : undefined,
    error: state.key === key ? state.error : null,
    loading: enabled ? (state.key === key ? state.loading : !(opts.keepPrevious && state.data !== undefined)) : false,
    refreshing: state.refreshing,
    refetch: () => load(true),
  };
}

export interface MutationOptions<R> {
  /** request-path prefixes whose cached data is refreshed after success, e.g. ["/leads", "/dashboard"] */
  invalidate?: string[];
  success?: string | ((res: R) => string | undefined);
  onSuccess?: (res: R) => void | Promise<void>;
  onError?: (err: SalesApiError) => void;
  /** don't show an error toast (the caller shows field errors itself) */
  silentError?: boolean;
}

export interface Mutation<A, R> {
  run: (args: A) => Promise<R | undefined>;
  pending: boolean;
  error: SalesApiError | null;
  reset: () => void;
}

export function useSalesMutation<A = void, R = any>(fn: (args: A) => Promise<R>, opts: MutationOptions<R> = {}): Mutation<A, R> {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SalesApiError | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    async (args: A): Promise<R | undefined> => {
      setPending(true);
      setError(null);
      try {
        const res = await fnRef.current(args);
        const o = optsRef.current;
        for (const p of o.invalidate ?? []) invalidateSales(p);
        const msg = typeof o.success === "function" ? o.success(res) : o.success;
        if (msg) toast({ title: msg });
        if (o.onSuccess) await o.onSuccess(res);
        return res;
      } catch (e) {
        const err = e instanceof SalesApiError ? e : new SalesApiError(e instanceof Error ? e.message : "Something went wrong", 0, "error");
        if (alive.current) setError(err);
        const o = optsRef.current;
        if (!o.silentError) toast({ title: err.message, description: err.issues.length > 1 ? err.issues.map((i) => i.message).join(" · ") : undefined, variant: "destructive" });
        o.onError?.(err);
        return undefined;
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [toast],
  );
  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ───── URL-backed list state (shareable filters, back button works) ─────
const URL_EVENT = "sales:urlchange";

function readParams(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

/** Read/write the page's query string. Changing it replaces the history entry (no new back-button stop per keystroke). */
export function useUrlParams(): [URLSearchParams, (patch: Record<string, string | number | null | undefined>, opts?: { push?: boolean }) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    // wouter announces its own navigations through patched history events; listen so ?filters from sidebar/KPI links apply
    const evs = ["popstate", URL_EVENT, "pushState", "replaceState"];
    for (const e of evs) window.addEventListener(e, h);
    return () => {
      for (const e of evs) window.removeEventListener(e, h);
    };
  }, []);
  const set = useCallback((patch: Record<string, string | number | null | undefined>, o: { push?: boolean } = {}) => {
    const p = readParams();
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === "") p.delete(k);
      else p.set(k, String(v));
    }
    const s = p.toString();
    const url = `${window.location.pathname}${s ? `?${s}` : ""}${window.location.hash}`;
    if (o.push) window.history.pushState(window.history.state, "", url);
    else window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(URL_EVENT));
  }, []);
  return [readParams(), set];
}

/** Convenience: a string filter bound to the URL. */
export function useUrlFilter(name: string, fallback = ""): [string, (v: string | number | null | undefined) => void] {
  const [p, set] = useUrlParams();
  const val = p.get(name) ?? fallback;
  const setter = useCallback((v: string | number | null | undefined) => set({ [name]: v, page: name === "page" ? v : null }), [name, set]);
  return [val, setter];
}

export function useMemoQuery<T extends Query>(q: T): T {
  const s = JSON.stringify(q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => q, [s]);
}
