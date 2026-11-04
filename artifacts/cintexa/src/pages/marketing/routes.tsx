import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";

const Overview = lazy(() => import("./overview"));
const Campaigns = lazy(() => import("./campaigns"));
const CampaignDetail = lazy(() => import("./campaign-detail"));
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
        <Route path="/marketing/strategy">{() => <Placeholder title="Marketing Strategy" />}</Route>
        <Route path="/marketing/calendar">{() => <Placeholder title="Marketing Calendar" />}</Route>
        <Route path="/marketing/content">{() => <Placeholder title="Content Studio" />}</Route>
        <Route path="/marketing/social">{() => <Placeholder title="Social Media Manager" />}</Route>
        <Route path="/marketing/email">{() => <Placeholder title="Email Marketing" />}</Route>
        <Route path="/marketing/seo">{() => <Placeholder title="SEO Manager" />}</Route>
        <Route path="/marketing/audience">{() => <Placeholder title="Audience & Insights" />}</Route>
        <Route path="/marketing/leads">{() => <Placeholder title="Lead Generation" />}</Route>
        <Route path="/marketing/automation">{() => <Placeholder title="Marketing Automation" />}</Route>
        <Route path="/marketing/brand">{() => <Placeholder title="Brand Management" />}</Route>
        <Route path="/marketing/assets">{() => <Placeholder title="Asset Library" />}</Route>
        <Route path="/marketing/landing">{() => <Placeholder title="Landing Pages & Funnels" />}</Route>
        <Route path="/marketing/analytics">{() => <Placeholder title="Marketing Analytics" />}</Route>
        <Route path="/marketing/budget">{() => <Placeholder title="Budget & ROI" />}</Route>
        <Route path="/marketing/reports">{() => <Placeholder title="Reports & Intelligence" />}</Route>
        <Route path="/marketing/settings">{() => <Placeholder title="Marketing Settings" />}</Route>
      </Switch>
    </Suspense>
  );
}
