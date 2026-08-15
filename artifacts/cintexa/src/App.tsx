import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/context/AuthContext";

import NotFound from "@/pages/not-found";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Sites = lazy(() => import("@/pages/sites"));
const Pages = lazy(() => import("@/pages/pages"));
const PageEditor = lazy(() => import("@/pages/pages/editor"));
const Posts = lazy(() => import("@/pages/posts"));
const PostEditor = lazy(() => import("@/pages/posts/editor"));
const Media = lazy(() => import("@/pages/media"));
const Users = lazy(() => import("@/pages/users"));
const Categories = lazy(() => import("@/pages/categories"));
const Menus = lazy(() => import("@/pages/menus"));
const Forms = lazy(() => import("@/pages/forms"));
const Seo = lazy(() => import("@/pages/seo"));
const AiStudio = lazy(() => import("@/pages/ai"));
const Settings = lazy(() => import("@/pages/settings"));
const ContentCalendar = lazy(() => import("@/pages/calendar"));
const ContentPipeline = lazy(() => import("@/pages/pipeline"));
const Plugins = lazy(() => import("@/pages/plugins"));
const Subscribers = lazy(() => import("@/pages/subscribers"));
const BusinessDiagnostic = lazy(() => import("@/pages/business-diagnostic"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * CINTEXA Nexus is currently configured as an open local/admin workspace.
 * The Firebase Auth provider remains mounted so Firebase-backed user profiles,
 * password management, and future authorization can continue to use the same
 * context, but the login/register screens and route gate are intentionally
 * removed from the application shell.
 */
function AppRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/diagnostics" component={BusinessDiagnostic} />
          <Route path="/sites" component={Sites} />
          <Route path="/pages" component={Pages} />
          <Route path="/pages/new" component={PageEditor} />
          <Route path="/pages/:id/edit" component={PageEditor} />
          <Route path="/posts" component={Posts} />
          <Route path="/posts/new" component={PostEditor} />
          <Route path="/posts/:id/edit" component={PostEditor} />
          <Route path="/media" component={Media} />
          <Route path="/users" component={Users} />
          <Route path="/categories" component={Categories} />
          <Route path="/menus" component={Menus} />
          <Route path="/forms" component={Forms} />
          <Route path="/calendar" component={ContentCalendar} />
          <Route path="/pipeline" component={ContentPipeline} />
          <Route path="/seo" component={Seo} />
          <Route path="/ai" component={AiStudio} />
          <Route path="/settings" component={Settings} />
          <Route path="/plugins" component={Plugins} />
          <Route path="/subscribers" component={Subscribers} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        defaultTheme="dark"
        defaultAccent="indigo"
        storageKey="cintexa-theme"
        accentStorageKey="cintexa-accent"
      >
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AppRoutes />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
