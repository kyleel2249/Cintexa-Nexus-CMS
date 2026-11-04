import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";

const Overview = lazy(() => import("./overview"));
const Campaigns = lazy(() => import("./campaigns"));
const CampaignDetail = lazy(() => import("./campaign-detail"));
const ContentStudio = lazy(() => import("./content"));
const ContentDetail = lazy(() => import("./content-detail"));
const Social = lazy(() => import("./social"));
const Email = lazy(() => import("./email"));
const Seo = lazy(() => import("./seo"));
const Leads = lazy(() => import("./leads"));
const Automation = lazy(() => import("./automation"));
const Budget = lazy(() => import("./budget"));
const Placeholder = lazy(() => import("./placeholder"));

function Spinner() {
  return (
    <div className="flex min-h-[300px] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function MarketingRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Switch>
        <Route path="/marketing" component={Overview} />
        <Route path="/marketing/campaigns" component={Campaigns} />
        <Route path="/marketing/campaigns/:id" component={CampaignDetail} />
        <Route path="/marketing/content" component={ContentStudio} />
        <Route path="/marketing/content/:id" component={ContentDetail} />
        <Route path="/marketing/social" component={Social} />
        <Route path="/marketing/calendar" component={Social} />
        <Route path="/marketing/email" component={Email} />
        <Route path="/marketing/seo" component={Seo} />
        <Route path="/marketing/audience" component={Leads} />
        <Route path="/marketing/leads" component={Leads} />
        <Route path="/marketing/automation" component={Automation} />
        <Route path="/marketing/budget" component={Budget} />
        <Route path="/marketing/strategy">{() => <Placeholder title="Marketing Strategy" />}</Route>
        <Route path="/marketing/brand">{() => <Placeholder title="Brand Management" />}</Route>
        <Route path="/marketing/assets">{() => <Placeholder title="Asset Library" />}</Route>
        <Route path="/marketing/landing">{() => <Placeholder title="Landing Pages & Funnels" />}</Route>
        <Route path="/marketing/analytics">{() => <Placeholder title="Marketing Analytics" />}</Route>
        <Route path="/marketing/reports">{() => <Placeholder title="Reports & Intelligence" />}</Route>
        <Route path="/marketing/settings">{() => <Placeholder title="Marketing Settings" />}</Route>
      </Switch>
    </Suspense>
  );
}
