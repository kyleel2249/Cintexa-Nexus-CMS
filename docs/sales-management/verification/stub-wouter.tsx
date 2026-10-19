import React, { useEffect, useState, useSyncExternalStore } from "react";
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); window.addEventListener("popstate", f); return () => { subs.delete(f); window.removeEventListener("popstate", f); }; };
const snap = () => window.location.pathname;
export function navigate(to: string, opts?: { replace?: boolean }) { if (opts?.replace) history.replaceState(null, "", to); else history.pushState(null, "", to); notify(); window.dispatchEvent(new Event("pushState")); }
export function useLocation(): [string, (to: string, o?: any) => void] { const p = useSyncExternalStore(sub, snap); return [p, navigate]; }
function match(pattern: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  let re = pattern.replace(/\/\*\?$/, "(?:/.*)?").replace(/:([A-Za-z]+)/g, (_m, n) => { names.push(n); return "([^/]+)"; });
  const m = new RegExp("^" + re + "/?$").exec(path);
  if (!m) return null;
  const out: Record<string, string> = {}; names.forEach((n, i) => (out[n] = decodeURIComponent(m[i + 1]!)));
  return out;
}
export function useRoute(pattern: string): [boolean, Record<string, string> | null] { const [p] = useLocation(); const m = match(pattern, p); return [!!m, m]; }
export function Route({ path, component: C, children }: any) {
  const [p] = useLocation();
  const params = path ? match(path, p) : {};
  if (!params) return null;
  if (C) return <C {...params} params={params} />;
  return typeof children === "function" ? children(params) : children ?? null;
}
export function Switch({ children }: any) {
  const [p] = useLocation();
  for (const c of React.Children.toArray(children) as any[]) { if (!c.props.path || match(c.props.path, p)) return c; }
  return null;
}
export function Link({ href, children, onClick, ...rest }: any) {
  const child = React.Children.count(children) === 1 && React.isValidElement(children) && (children as any).type !== undefined && typeof (children as any).type !== "string" ? null : null;
  void child;
  return <a href={href} {...rest} onClick={(e) => { onClick?.(e); if (e.defaultPrevented || rest.target === "_blank" || e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(href); }}>{children}</a>;
}
export function Redirect({ to, replace }: any) { useEffect(() => { navigate(to, { replace: true }); }, [to]); return null; }
export function Router({ children }: any) { return children; }
