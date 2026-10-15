import { lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";
import { Activity, FilePlus2, History, LayoutGrid, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Loading, WI } from "./components";

const Overview = lazy(() => import("./overview"));
const NewAudit = lazy(() => import("./new-audit"));
const AuditList = lazy(() => import("./audits"));
const AuditDetail = lazy(() => import("./audit-detail"));
const FindingsPage = lazy(() => import("./findings"));
const RecommendationsPage = lazy(() => import("./recommendations"));
const ReportPage = lazy(() => import("./report"));
const SettingsPage = lazy(() => import("./settings"));

const NAV = [
  { href: WI, label: "Overview", icon: LayoutGrid, exact: true },
  { href: `${WI}/new`, label: "New audit", icon: FilePlus2 },
  { href: `${WI}/audits`, label: "Audits", icon: History },
  { href: `${WI}/settings`, label: "Settings", icon: SettingsIcon },
];

/** Dispatches the eight Website Intelligence routes. Specific routes are matched before generic ones. */
export default function WebsiteIntelligence() {
  const [location] = useLocation();
  const path = location.replace(/\/+$/, "");
  let view: JSX.Element;
  let m: RegExpMatchArray | null;
  if (path === WI) view = <Overview />;
  else if (path === `${WI}/new`) view = <NewAudit />;
  else if (path === `${WI}/audits`) view = <AuditList />;
  else if (path === `${WI}/settings`) view = <SettingsPage />;
  else if ((m = path.match(/^\/website-intelligence\/audits\/([^/]+)\/findings$/))) view = <FindingsPage id={m[1]} />;
  else if ((m = path.match(/^\/website-intelligence\/audits\/([^/]+)\/recommendations$/))) view = <RecommendationsPage id={m[1]} />;
  else if ((m = path.match(/^\/website-intelligence\/audits\/([^/]+)\/report$/))) view = <ReportPage id={m[1]} />;
  else if ((m = path.match(/^\/website-intelligence\/audits\/([^/]+)$/))) view = <AuditDetail id={m[1]} />;
  else view = <div className="p-8 text-sm text-muted-foreground">This Website Intelligence page does not exist. <Link href={WI} className="underline">Back to overview</Link>.</div>;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-8 wi-root">
      <style>{`@media print { aside, nav[aria-label="Website Intelligence"], .wi-no-print { display: none !important; } .wi-root { max-width: none; padding: 0; } body { background: #fff; } }`}</style>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary"><Activity className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">Website Intelligence</h1>
            <p className="text-xs text-muted-foreground">Evidence-based website audits with defensible scores and a professional PDF report.</p>
          </div>
        </div>
        <nav aria-label="Website Intelligence" className="flex gap-1 rounded-lg border bg-card p-1">
          {NAV.map((n) => {
            const active = n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`);
            return (
              <Link key={n.href} href={n.href}>
                <span className={cn("flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}><n.icon className="h-3.5 w-3.5" />{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>
      <Suspense fallback={<Loading />}>{view}</Suspense>
    </div>
  );
}
