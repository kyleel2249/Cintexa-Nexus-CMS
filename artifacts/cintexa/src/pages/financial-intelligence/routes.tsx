import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";

const Overview = lazy(() => import("./overview"));
const FiPage = lazy(() => import("./page"));

const spin = <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">Loading Financial Intelligence…</div>;

export function FinancialIntelligenceRoutes() {
  return (
    <Suspense fallback={spin}>
      <Switch>
        <Route path="/financial-intelligence" component={Overview} />
        <Route path="/financial-intelligence/health">{() => <FiPage mode="health" />}</Route>
        <Route path="/financial-intelligence/profit-loss">{() => <FiPage mode="pnl" />}</Route>
        <Route path="/financial-intelligence/balance-sheet">{() => <FiPage mode="balance-sheet" />}</Route>
        <Route path="/financial-intelligence/ratios">{() => <FiPage mode="ratios" />}</Route>
        <Route path="/financial-intelligence/forecasting">{() => <FiPage mode="forecast" />}</Route>
        <Route path="/financial-intelligence/scenarios">{() => <FiPage mode="scenarios" />}</Route>
        <Route path="/financial-intelligence/entries">{() => <FiPage mode="entries" />}</Route>
        <Route path="/financial-intelligence/exchange-rates">{() => <FiPage mode="fx" />}</Route>
        <Route path="/financial-intelligence/settings">{() => <FiPage mode="settings" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
