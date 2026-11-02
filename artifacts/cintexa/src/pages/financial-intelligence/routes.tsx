import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Switch, Route } from "wouter";
import { Spinner, ErrorState, PermissionDenied, Panel, Field, Input, Select } from "@/components/sales/ui";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import { FinanceProvider, useFinance } from "@/context/FinanceContext";
import { fin } from "@/lib/finance/api";
import { useFinanceMutation } from "@/lib/finance/hooks";
import { useState } from "react";
import type { AnalysisKind } from "./analysis-page";

const Overview = lazy(() => import("./overview"));
const AnalysisPage = lazy(() => import("./analysis-page"));

const spinner = <div className="flex min-h-[300px] items-center justify-center"><Spinner className="h-6 w-6" /></div>;

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useFinance();
  return can(perm) ? <>{children}</> : <PermissionDenied message="Your Finance role does not include permission to view financial intelligence. Ask an organisation owner if you need access." />;
}

function AnalysisRoute({ kind }: { kind: AnalysisKind }) {
  return (
    <Guard perm="ledger:read">
      <AnalysisPage kind={kind} />
    </Guard>
  );
}

function CreateOrganisation() {
  const { reload } = useFinance();
  const [v, setV] = useState({ legal_name: "", trading_name: "", tax_id: "", country: "GH", functional_currency: "GHS" });
  const create = useFinanceMutation(
    () => fin.post("/organisations", { ...v, trading_name: v.trading_name || undefined, tax_id: v.tax_id || undefined }),
    { success: "Organisation created", onSuccess: () => reload() },
  );
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="mx-auto max-w-xl py-10">
      <Panel title="Set up CINTEXA FINANCE first" description="Financial Intelligence reads posted ledger data. Create a Finance organisation to continue.">
        <div className="p-4 space-y-3">
          <Field label="Registered business name" required><Input value={v.legal_name} onChange={set("legal_name")} maxLength={200} /></Field>
          <Field label="Trading name"><Input value={v.trading_name} onChange={set("trading_name")} maxLength={200} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country"><Input value={v.country} onChange={set("country")} maxLength={2} /></Field>
            <Field label="Currency">
              <Select value={v.functional_currency} onChange={set("functional_currency")}>
                {["GHS", "USD", "GBP", "EUR", "NGN"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Button disabled={create.pending || v.legal_name.trim().length < 2} onClick={() => void create.run()}>
            {create.pending ? "Creating…" : "Create organisation"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const f = useFinance();
  if (f.status === "loading") return spinner;
  if (f.status === "error" && f.error) return <ErrorState error={f.error} onRetry={() => void f.reload()} />;
  if (f.status === "no_org") return <CreateOrganisation />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span>
          Financial Intelligence · <span className="font-medium text-foreground">{f.org?.trading_name || f.org?.legal_name}</span> · {f.currency}
        </span>
        {f.orgs.length > 1 && (
          <label className="flex items-center gap-2">
            Organisation
            <Select
              aria-label="Switch organisation"
              className="h-8 w-56 py-1 text-xs"
              value={String(f.org?.id ?? "")}
              onChange={(e) => f.switchOrg(Number(e.target.value))}
            >
              {f.orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.trading_name || o.legal_name}</option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {children}
    </>
  );
}

export function FinancialIntelligenceRoutes() {
  return (
    <FinanceProvider>
      <Gate>
        <Suspense fallback={spinner}>
          <Switch>
            <Route path="/financial-intelligence">
              <Guard perm="ledger:read"><Overview /></Guard>
            </Route>
            <Route path="/financial-intelligence/ratios"><AnalysisRoute kind="ratios" /></Route>
            <Route path="/financial-intelligence/profit-loss"><AnalysisRoute kind="pnl" /></Route>
            <Route path="/financial-intelligence/cashflow"><AnalysisRoute kind="cashflow" /></Route>
            <Route path="/financial-intelligence/balance-sheet"><AnalysisRoute kind="balance-sheet" /></Route>
            <Route path="/financial-intelligence/revenue"><AnalysisRoute kind="revenue" /></Route>
            <Route path="/financial-intelligence/customer-acquisition"><AnalysisRoute kind="cac" /></Route>
            <Route path="/financial-intelligence/expenses"><AnalysisRoute kind="expenses" /></Route>
            <Route path="/financial-intelligence/budget"><AnalysisRoute kind="budget" /></Route>
            <Route path="/financial-intelligence/working-capital"><AnalysisRoute kind="working-capital" /></Route>
            <Route path="/financial-intelligence/health"><AnalysisRoute kind="health" /></Route>
            <Route path="/financial-intelligence/investors"><AnalysisRoute kind="investors" /></Route>
            <Route path="/financial-intelligence/shareholders"><AnalysisRoute kind="shareholders" /></Route>
            <Route path="/financial-intelligence/dividends"><AnalysisRoute kind="dividends" /></Route>
            <Route path="/financial-intelligence/valuation"><AnalysisRoute kind="valuation" /></Route>
            <Route path="/financial-intelligence/reports"><AnalysisRoute kind="reports" /></Route>
            <Route path="/financial-intelligence/settings"><AnalysisRoute kind="settings" /></Route>
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Gate>
    </FinanceProvider>
  );
}
