import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import NotFound from "@/pages/not-found";

const Overview = lazy(() => import("./overview"));
const BdPage = lazy(() => import("./page"));
const spin = <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">Loading Business Diary…</div>;

export function BusinessDiaryRoutes() {
  return (
    <Suspense fallback={spin}>
      <Switch>
        <Route path="/business-diary" component={Overview} />
        <Route path="/business-diary/entries">{() => <BdPage mode="entries" />}</Route>
        <Route path="/business-diary/pitches">{() => <BdPage mode="pitches" />}</Route>
        <Route path="/business-diary/feedback">{() => <BdPage mode="feedback" />}</Route>
        <Route path="/business-diary/follow-ups">{() => <BdPage mode="followups" />}</Route>
        <Route path="/business-diary/decisions">{() => <BdPage mode="decisions" />}</Route>
        <Route path="/business-diary/case-studies">{() => <BdPage mode="cases" />}</Route>
        <Route path="/business-diary/insights">{() => <BdPage mode="insights" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}
