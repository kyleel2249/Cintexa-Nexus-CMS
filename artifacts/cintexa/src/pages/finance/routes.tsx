import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";

const Overview = lazy(() => import("./overview"));
const FinancePage = lazy(() => import("./page"));
const FxPage = lazy(() => import("./fx"));
const InventoryPage = lazy(() => import("./inventory"));
const PayrollPage = lazy(() => import("./payroll"));
const RestatementsPage = lazy(() => import("./restatements"));
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
        <Route path="/finance/cash-flow">{() => <FinancePage mode="cf" />}</Route>
        <Route path="/finance/ar-aging">{() => <FinancePage mode="ar-aging" />}</Route>
        <Route path="/finance/depreciation-schedule">{() => <FinancePage mode="dep-sched" />}</Route>
        <Route path="/finance/equity-statement">{() => <FinancePage mode="equity" />}</Route>
        <Route path="/finance/adjustments">{() => <FinancePage mode="adjustments" />}</Route>
        <Route path="/finance/invoices">{() => <FinancePage mode="invoices" />}</Route>
        <Route path="/finance/payments">{() => <FinancePage mode="payments" />}</Route>
        <Route path="/finance/discounts">{() => <FinancePage mode="discounts" />}</Route>
        <Route path="/finance/fx" component={FxPage} />
        <Route path="/finance/inventory" component={InventoryPage} />
        <Route path="/finance/payroll" component={PayrollPage} />
        <Route path="/finance/restatements" component={RestatementsPage} />
        <Route path="/finance/audit">{() => <FinancePage mode="audit" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
