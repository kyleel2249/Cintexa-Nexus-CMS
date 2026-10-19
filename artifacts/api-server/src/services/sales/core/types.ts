export type SalesRole = "sales_admin" | "sales_director" | "sales_manager" | "sales_rep" | "sales_analyst" | "finance" | "support_agent" | "readonly_exec";
export const SALES_ROLES: readonly SalesRole[] = ["sales_admin", "sales_director", "sales_manager", "sales_rep", "sales_analyst", "finance", "support_agent", "readonly_exec"];

export type RecordScope = "own" | "team" | "all";

/** Identity resolved by the host application's auth layer (Firebase token, legacy JWT or API key). */
export interface AuthIdentity {
  sub: string;
  email: string;
  /** platform role: admin | editor | api */
  platformRole: string;
  isApiKey?: boolean;
  apiKeyScopes?: string[];
  displayName?: string;
}

export interface Actor {
  memberId: number;
  userSub: string;
  email: string;
  name: string;
  role: SalesRole;
  teamId: number | null;
  /** member ids visible under team scope (self + team members + subordinate teams) */
  teamMemberIds: number[];
  /** used for audit trails: "Name <email>" */
  label: string;
  isApiKey: boolean;
}

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

export interface SalesRequest {
  method: string;
  /** path relative to /api/sales, e.g. /leads/12 */
  path: string;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  auth: AuthIdentity | undefined;
  ip?: string;
}

export interface SalesResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** raw payload (csv / html) - when set, body is ignored */
  raw?: { contentType: string; data: string; filename?: string };
}
