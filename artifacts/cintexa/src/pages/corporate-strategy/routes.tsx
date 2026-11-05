import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";

const Overview = lazy(() => import("./overview"));
const CsiPage = lazy(() => import("./page"));

const spin = (
  <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
    Loading Corporate Strategy &amp; Intelligence…
  </div>
);

export function CorporateStrategyRoutes() {
  return (
    <Suspense fallback={spin}>
      <Switch>
        <Route path="/corporate-strategy" component={Overview} />
        <Route path="/corporate-strategy/profile">{() => <CsiPage mode="profile" />}</Route>
        <Route path="/corporate-strategy/objectives">{() => <CsiPage mode="objectives" />}</Route>
        <Route path="/corporate-strategy/departments">{() => <CsiPage mode="departments" />}</Route>
        <Route path="/corporate-strategy/products">{() => <CsiPage mode="products" />}</Route>
        <Route path="/corporate-strategy/pricing">{() => <CsiPage mode="pricing" />}</Route>
        <Route path="/corporate-strategy/budgets">{() => <CsiPage mode="budgets" />}</Route>
        <Route path="/corporate-strategy/allocation">{() => <CsiPage mode="allocation" />}</Route>
        <Route path="/corporate-strategy/forecast">{() => <CsiPage mode="forecast" />}</Route>
        <Route path="/corporate-strategy/risks">{() => <CsiPage mode="risks" />}</Route>
        <Route path="/corporate-strategy/roadmap">{() => <CsiPage mode="roadmap" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
