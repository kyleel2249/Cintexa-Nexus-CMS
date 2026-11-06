import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { MarketingMemoryBridge } from "@/lib/marketing/useMarketingSubscription";

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
const Strategy = lazy(() => import("./strategy"));
const Brand = lazy(() => import("./brand"));
const Landing = lazy(() => import("./landing"));
const Analytics = lazy(() => import("./analytics"));
const Settings = lazy(() => import("./settings"));
const Assets = lazy(() => import("./assets"));
const OkrEditor = lazy(() => import("./okr-editor"));
const Reports = lazy(() => import("./reports"));
const Calendar = lazy(() => import("./calendar"));
const Activity = lazy(() => import("./activity"));
const ImportPage = lazy(() => import("./import"));
const Templates = lazy(() => import("./templates"));
const Variants = lazy(() => import("./variants"));

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
      <MarketingMemoryBridge />
      <Switch>
        <Route path="/marketing" component={Overview} />
        <Route path="/marketing/strategy" component={Strategy} />
        <Route path="/marketing/okrs" component={OkrEditor} />
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
        <Route path="/marketing/brand" component={Brand} />
        <Route path="/marketing/assets" component={Assets} />
        <Route path="/marketing/landing" component={Landing} />
        <Route path="/marketing/analytics" component={Analytics} />
        <Route path="/marketing/budget" component={Budget} />
        <Route path="/marketing/reports" component={Reports} />
        <Route path="/marketing/calendar" component={Calendar} />
        <Route path="/marketing/activity" component={Activity} />
        <Route path="/marketing/import" component={ImportPage} />
        <Route path="/marketing/templates" component={Templates} />
        <Route path="/marketing/variants" component={Variants} />
        <Route path="/marketing/settings" component={Settings} />
      </Switch>
    </Suspense>
  );
}
