import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useSalesQuery, invalidateSales } from "@/lib/sales/hooks";
import { configureFormat } from "@/lib/sales/format";
import { navFor, type SalesNavItem } from "@/lib/sales/nav";
import type { SalesApiError } from "@/lib/sales/api";

export interface SalesMe {
  member: { id: number; email: string; name: string; role: string; roleLabel: string; teamId: number | null };
  scope: "own" | "team" | "all";
  permissions: string[];
  canSeeCost: boolean;
  unreadNotifications: number;
  business: { currency: string; timezone: string; locale: string; weekStartsOn: number };
  features: { aiEnabled: boolean; emailEnabled: boolean; automationEnabled: boolean };
}

export type SalesAccess = "loading" | "ready" | "not_member" | "unauthenticated" | "error";

interface SalesContextValue {
  access: SalesAccess;
  me: SalesMe | null;
  error: SalesApiError | null;
  perms: ReadonlySet<string>;
  can: (permission: string) => boolean;
  nav: SalesNavItem[];
  reload: () => void;
}

const Ctx = createContext<SalesContextValue | null>(null);

export function SalesProvider({ children }: { children: ReactNode }) {
  const q = useSalesQuery<SalesMe>("/me");
  const me = q.data ?? null;
  const perms = useMemo(() => new Set(me?.permissions ?? []), [me]);

  useEffect(() => {
    if (me) configureFormat(me.business);
  }, [me]);

  const access: SalesAccess = q.loading ? "loading" : me ? "ready" : q.error?.isNotMember ? "not_member" : q.error?.status === 401 ? "unauthenticated" : "error";
  const value = useMemo<SalesContextValue>(
    () => ({ access, me, error: q.error, perms, can: (p) => perms.has(p), nav: navFor(perms), reload: () => invalidateSales("/me") }),
    [access, me, q.error, perms],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSales(): SalesContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSales must be used inside <SalesProvider>");
  return v;
}

/** Like useSales but returns null outside a provider (used by shared layout pieces that render before sales is available). */
export function useSalesOptional(): SalesContextValue | null {
  return useContext(Ctx);
}
