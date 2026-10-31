import type { Permission } from "./rbac";
import type { Actor, OrgContext, Q } from "./types";

export interface Ctx {
  q: Q;
  actor: Actor;
  org: OrgContext;
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  now: Date;
  reqId: string;
}
export interface Out { status: number; body?: unknown; raw?: { contentType: string; data: string; filename?: string } }

export interface Route {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  regex: RegExp;
  perm?: Permission;
  /** false for routes usable before an organisation is selected (list/create organisations, permissions) */
  needsOrg: boolean;
  /** platform administrator only (organisation creation) */
  platformAdmin?: boolean;
  handler: (c: Ctx) => Promise<Out>;
}

export function route(method: Route["method"], path: string, o: { perm?: Permission; needsOrg?: boolean; platformAdmin?: boolean }, handler: Route["handler"]): Route {
  const regex = new RegExp("^" + path.replace(/:([a-z_]+)/g, "(?<$1>[^/]+)") + "/?$");
  return { method, path, regex, perm: o.perm, needsOrg: o.needsOrg ?? true, platformAdmin: o.platformAdmin, handler };
}
export const ok = (body: unknown, status = 200): Out => ({ status, body });
