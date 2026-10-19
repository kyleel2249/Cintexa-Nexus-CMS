import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Route, Switch } from "wouter";
import { SalesProvider } from "@/context/SalesContext";
import { SalesRoutes } from "@/pages/sales/routes";
import PublicQuotation from "@/pages/sales/public-quotation";
import PublicLeadForm from "@/pages/sales/public-lead-form";
import { SalesOverviewWidget } from "@/components/sales/SalesOverviewWidget";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { NotificationBell } from "@/components/layout/NotificationBell";

function Shell() {
  const [open, setOpen] = React.useState(false);
  return (
    <SalesProvider>
      <header><button id="open-search" onClick={() => setOpen(true)}>search</button><NotificationBell /><GlobalSearch open={open} onClose={() => setOpen(false)} /></header>
      <div id="widget"><SalesOverviewWidget compact /></div>
      <main><SalesRoutes /></main>
    </SalesProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <Switch>
    <Route path="/q/:token">{(p: any) => <PublicQuotation token={p.token} />}</Route>
    <Route path="/f/:token">{(p: any) => <PublicLeadForm token={p.token} />}</Route>
    <Route><Shell /></Route>
  </Switch>,
);
