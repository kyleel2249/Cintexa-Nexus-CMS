import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fin, getFinanceOrg, setFinanceOrg, FinanceApiError } from "@/lib/finance/api";
import { invalidateFinance } from "@/lib/finance/hooks";

export interface FinanceOrgSummary { id: number; legal_name: string; trading_name: string | null; country: string; functional_currency: string; role: string }
interface Ctx {
  status: "loading" | "ready" | "no_org" | "error";
  error: FinanceApiError | null;
  orgs: FinanceOrgSummary[];
  org: FinanceOrgSummary | null;
  role: string | null;
  perms: string[];
  settings: { journal_approval_required: boolean; allow_self_approval: boolean };
  currency: string;
  can: (p: string) => boolean;
  switchOrg: (id: number) => void;
  reload: () => Promise<void>;
}
const FinanceCtx = createContext<Ctx | null>(null);

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: Ctx["status"]; error: FinanceApiError | null; orgs: FinanceOrgSummary[]; orgId: number | null; perms: string[]; role: string | null; settings: Ctx["settings"] }>({
    status: "loading", error: null, orgs: [], orgId: null, perms: [], role: null, settings: { journal_approval_required: true, allow_self_approval: false },
  });
  const load = useCallback(async (preferred?: number) => {
    try {
      const { items } = await fin.get<{ items: FinanceOrgSummary[] }>("/organisations");
      if (!items.length) { setFinanceOrg(null); setState((s) => ({ ...s, status: "no_org", orgs: [], orgId: null, error: null })); return; }
      const want = preferred ?? getFinanceOrg();
      const chosen = items.find((o) => o.id === want) ?? items[0]!;
      setFinanceOrg(chosen.id);
      const [me, org] = await Promise.all([fin.get<{ role: string; permissions: string[] }>("/me"), fin.get<{ organisation: { settings?: Partial<Ctx["settings"]> } }>("/organisation")]);
      setState({ status: "ready", error: null, orgs: items, orgId: chosen.id, role: me.role, perms: me.permissions, settings: { journal_approval_required: org.organisation.settings?.journal_approval_required !== false, allow_self_approval: org.organisation.settings?.allow_self_approval === true } });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof FinanceApiError ? e : new FinanceApiError(e instanceof Error ? e.message : "Something went wrong", 0, "error") }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const value = useMemo<Ctx>(() => {
    const org = state.orgs.find((o) => o.id === state.orgId) ?? null;
    return {
      status: state.status, error: state.error, orgs: state.orgs, org, role: state.role, perms: state.perms, settings: state.settings, currency: org?.functional_currency ?? "GHS",
      can: (p) => state.perms.includes(p),
      switchOrg: (id) => { setFinanceOrg(id); setState((s) => ({ ...s, status: "loading" })); invalidateFinance(""); void load(id); },
      reload: () => load(state.orgId ?? undefined),
    };
  }, [state, load]);
  return <FinanceCtx.Provider value={value}>{children}</FinanceCtx.Provider>;
}

export function useFinance(): Ctx {
  const c = useContext(FinanceCtx);
  if (!c) throw new Error("useFinance must be used inside <FinanceProvider>");
  return c;
}
