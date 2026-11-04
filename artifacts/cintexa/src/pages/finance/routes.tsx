import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";

const Overview = lazy(() => import("./overview"));
const FinancePage = lazy(() => import("./page"));
const spin = <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">Loading Finance…</div>;

export function FinanceRoutes() {
  return (
    <Suspense fallback={spin}>
      <Switch>
        <Route path="/finance" component={Overview} />
        <Route path="/finance/accounts">{() => <FinancePage mode="accounts" />}</Route>
        <Route path="/finance/journals">{() => <FinancePage mode="journals" />}</Route>
        <Route path="/finance/assets">{() => <FinancePage mode="assets" />}</Route>
        <Route path="/finance/periods">{() => <FinancePage mode="periods" />}</Route>
        <Route path="/finance/integrity">{() => <FinancePage mode="integrity" />}</Route>
        <Route path="/finance/ledger">{() => <FinancePage mode="ledger" />}</Route>
        <Route path="/finance/trial-balance">{() => <FinancePage mode="tb" />}</Route>
        <Route path="/finance/profit-loss">{() => <FinancePage mode="pnl" />}</Route>
        <Route path="/finance/balance-sheet">{() => <FinancePage mode="bs" />}</Route>
        <Route path="/finance/invoices">{() => <FinancePage mode="invoices" />}</Route>
        <Route path="/finance/payments">{() => <FinancePage mode="payments" />}</Route>
        <Route path="/finance/discounts">{() => <FinancePage mode="discounts" />}</Route>
        <Route path="/finance/audit">{() => <FinancePage mode="audit" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
