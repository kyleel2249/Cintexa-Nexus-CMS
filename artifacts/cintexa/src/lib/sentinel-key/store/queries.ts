import { useCallback, useEffect, useRef, useState } from "react";
import { sk, SkClientError, type Query } from "./api";

let version = 0;
const listeners = new Set<() => void>();
/** Make every mounted query reload (call after any write). */
export function invalidateSk() { version += 1; listeners.forEach((l) => l()); }

export function useSk<T = any>(path: string | null, query?: Query) {
  const [state, setState] = useState<{ data: T | undefined; error: SkClientError | null; loading: boolean }>({ data: undefined, error: null, loading: path !== null });
  const [tick, setTick] = useState(version);
  const key = path === null ? "" : `${path}?${JSON.stringify(query ?? {})}`;
  const latest = useRef(key);
  latest.current = key;
  useEffect(() => { const l = () => setTick(version); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    sk<T>("GET", path, { query })
      .then((data) => { if (live && latest.current === key) setState({ data, error: null, loading: false }); })
      .catch((e) => { if (live) setState((s) => ({ ...s, error: e instanceof SkClientError ? e : new SkClientError(String(e?.message ?? e), 0, "network"), loading: false })); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick(++version), []);
  return { ...state, reload };
}
