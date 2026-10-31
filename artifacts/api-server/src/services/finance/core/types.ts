import type { Queryable } from "../../sales/core/types";
export type { Db, Queryable } from "../../sales/core/types";

export interface FinanceIdentity { sub: string; email: string; platformRole: string; isApiKey?: boolean; displayName?: string }
export interface FinanceRequest {
  method: string; path: string; query: Record<string, string | string[] | undefined>; body: unknown;
  headers: Record<string, string | string[] | undefined>; auth: FinanceIdentity | undefined; ip?: string;
}
export interface FinanceResponse { status: number; body?: unknown; headers?: Record<string, string>; raw?: { contentType: string; data: string; filename?: string } }

export interface Actor { sub: string; email: string; label: string; platformRole: string }
export interface OrgContext extends Actor { orgId: number; role: string; memberId: number; functionalCurrency: string; settings: Record<string, any> }
export type Q = Queryable;
