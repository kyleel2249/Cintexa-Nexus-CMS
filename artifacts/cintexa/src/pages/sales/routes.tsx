import { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { SalesRoute } from "@/components/sales/SalesRoute";
import { Spinner } from "@/components/sales/ui";
import NotFound from "@/pages/not-found";

const Overview = lazy(() => import("./overview"));
const Leads = lazy(() => import("./leads"));
const LeadDetail = lazy(() => import("./lead-detail"));
const Accounts = lazy(() => import("./accounts"));
const AccountDetail = lazy(() => import("./account-detail"));
const Contacts = lazy(() => import("./contacts"));
const Pipeline = lazy(() => import("./pipeline"));
const OpportunityDetail = lazy(() => import("./opportunity-detail"));
const Activities = lazy(() => import("./activities"));
const Targets = lazy(() => import("./targets"));
const Products = lazy(() => import("./products"));
const Quotations = lazy(() => import("./quotations"));
const QuotationDetail = lazy(() => import("./quotation-detail"));
const Orders = lazy(() => import("./orders"));
const OrderDetail = lazy(() => import("./order-detail"));
const Forecasting = lazy(() => import("./forecasting"));
const Performance = lazy(() => import("./performance"));
const Teams = lazy(() => import("./teams"));
const Commissions = lazy(() => import("./commissions"));
const Retention = lazy(() => import("./retention"));
const Campaigns = lazy(() => import("./campaigns"));
const Competitors = lazy(() => import("./competitors"));
const Reports = lazy(() => import("./reports"));
const Automation = lazy(() => import("./automation"));
const Playbook = lazy(() => import("./playbook"));
const Documents = lazy(() => import("./documents"));
const SalesSettings = lazy(() => import("./settings"));
const CommandCentre = lazy(() => import("./command-centre"));

const R = (path: string, component: React.ComponentType<any>, perm?: string, anyPerm?: string[]) => (
  <Route path={path} key={path}>{(params: Record<string, string>) => <SalesRoute perm={perm} anyPerm={anyPerm} component={component} params={params} />}</Route>
);

/** Server-generated links (notifications, search) use /sales/playbook/:id; the library opens articles from ?id=. */
function PlaybookArticleRedirect({ id }: { id: string }) {
  return <Redirect to={`/sales/playbook?id=${encodeURIComponent(id)}`} replace />;
}

function ApprovalsRedirect() {
  return <Redirect to="/sales/command-centre?tab=approvals" replace />;
}

/**
 * All authenticated Sales Management routes, mounted at /sales/* inside the normal CMS layout.
 * <SalesProvider> is mounted once above the layout (App.tsx) so the sidebar, search and notifications share it.
 */
export function SalesRoutes() {
  return (
      <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center"><Spinner className="h-6 w-6" /></div>}>
        <Switch>
          {R("/sales", Overview, "dashboard:read")}
          {R("/sales/command-centre", CommandCentre, "agents:read")}
          {R("/sales/approvals", ApprovalsRedirect, "agents:read")}
          {R("/sales/leads", Leads, "leads:read")}
          {R("/sales/leads/:id", LeadDetail, "leads:read")}
          {R("/sales/accounts", Accounts, "accounts:read")}
          {R("/sales/accounts/:id", AccountDetail, "accounts:read")}
          {R("/sales/contacts", Contacts, "contacts:read")}
          {R("/sales/pipeline", Pipeline, "opportunities:read")}
          {R("/sales/opportunities/:id", OpportunityDetail, "opportunities:read")}
          {R("/sales/pipeline/:id", OpportunityDetail, "opportunities:read")}
          {R("/sales/activities", Activities, "activities:read")}
          {R("/sales/targets", Targets, "targets:read")}
          {R("/sales/products", Products, "products:read")}
          {R("/sales/quotations", Quotations, "quotations:read")}
          {R("/sales/quotations/:id", QuotationDetail, "quotations:read")}
          {R("/sales/orders", Orders, "orders:read")}
          {R("/sales/orders/:id", OrderDetail, "orders:read")}
          {R("/sales/forecasting", Forecasting, "forecast:read")}
          {R("/sales/performance", Performance, undefined, ["performance:read", "leaderboard:read"])}
          {R("/sales/teams", Teams, "teams:read")}
          {R("/sales/commissions", Commissions, "commissions:read")}
          {R("/sales/retention", Retention, "retention:read")}
          {R("/sales/campaigns", Campaigns, "campaigns:read")}
          {R("/sales/competitors", Competitors, "competitors:read")}
          {R("/sales/reports", Reports, "reports:read")}
          {R("/sales/automation", Automation, "automation:read")}
          {R("/sales/playbook", Playbook, "playbook:read")}
          {R("/sales/playbook/:id", PlaybookArticleRedirect, "playbook:read")}
          {R("/sales/documents", Documents, "documents:read")}
          {R("/sales/settings", SalesSettings, "settings:read")}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
  );
}
