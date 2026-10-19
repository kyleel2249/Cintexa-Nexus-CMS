import { useMemo } from "react";
import { useUrlParams, useSalesQuery, type QueryState } from "./hooks";
import type { Query } from "./api";

export interface ListState {
  page: number;
  pageSize: number;
  q: string;
  /** DataTable-style sort token: "key" ascending, "-key" descending, "" = server default */
  sort: string;
  filters: Record<string, string>;
  setPage: (p: number) => void;
  setQ: (q: string) => void;
  setSort: (s: string) => void;
  setFilter: (name: string, value: string) => void;
  clear: () => void;
  /** the exact query parameters sent to the API */
  query: Query;
  hasFilters: boolean;
}

/** URL-backed paging / search / sort / filters for list pages. Shareable links, working back button. */
export function useListState(filterNames: string[] = [], opts: { pageSize?: number } = {}): ListState {
  const [p, set] = useUrlParams();
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, Number(p.get("page")) || 1);
  const q = p.get("q") ?? "";
  const sortKey = p.get("sort") ?? "";
  const dir = p.get("dir");
  const sort = sortKey ? (dir === "desc" ? `-${sortKey}` : dir === "asc" ? sortKey : sortKey) : "";
  const names = filterNames.join(",");
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    for (const n of names ? names.split(",") : []) {
      const v = p.get(n);
      if (v) f[n] = v;
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, p.toString()]);
  const query: Query = { page, pageSize, q: q || undefined, ...filters, sort: sortKey || undefined, dir: sortKey ? (dir ?? "asc") : undefined };
  return {
    page, pageSize, q, sort, filters, query,
    setPage: (n) => set({ page: n <= 1 ? null : n }),
    setQ: (v) => set({ q: v, page: null }),
    setSort: (s) => set({ sort: s.replace(/^-/, ""), dir: s ? (s.startsWith("-") ? "desc" : "asc") : null, page: null }),
    setFilter: (n, v) => set({ [n]: v, page: null }),
    clear: () => set({ q: null, page: null, sort: null, dir: null, ...Object.fromEntries(names.split(",").filter(Boolean).map((n) => [n, null])) }),
    hasFilters: Boolean(q) || Object.keys(filters).length > 0,
  };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  [extra: string]: unknown;
}

export function useList<T = any, X = unknown>(path: string, state: ListState, extra?: Query): QueryState<Paged<T> & X> {
  return useSalesQuery<Paged<T> & X>(path, { ...state.query, ...extra }, { keepPrevious: true });
}
