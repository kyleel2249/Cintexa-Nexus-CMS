import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/context/AuthContext";
import NotFound from "@/pages/not-found";

function lazyWithRecovery<T extends ComponentType<unknown>>(loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try { return await loader(); } catch (error) {
      const recoveryKey = "cintexa-module-recovery";
      if (typeof window !== "undefined" && !sessionStorage.getItem(recoveryKey)) {
        sessionStorage.setItem(recoveryKey, "1"); window.location.reload(); await new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}

const Dashboard = lazyWithRecovery(() => import("@/pages/dashboard"));
const Sites = lazyWithRecovery(() => import("@/pages/sites"));
const Pages = lazyWithRecovery(() => import("@/pages/pages"));
const PageEditor = lazyWithRecovery(() => import("@/pages/pages/editor"));
const Posts = lazyWithRecovery(() => import("@/pages/posts"));
const PostEditor = lazyWithRecovery(() => import("@/pages/posts/editor"));
const Media = lazyWithRecovery(() => import("@/pages/media"));
const Users = lazyWithRecovery(() => import("@/pages/users"));
const Categories = lazyWithRecovery(() => import("@/pages/categories"));
const Menus = lazyWithRecovery(() => import("@/pages/menus"));
const Forms = lazyWithRecovery(() => import("@/pages/forms"));
const Seo = lazyWithRecovery(() => import("@/pages/seo"));
const AiStudio = lazyWithRecovery(() => import("@/pages/ai"));
const Settings = lazyWithRecovery(() => import("@/pages/settings"));
const ContentCalendar = lazyWithRecovery(() => import("@/pages/calendar"));
const ContentPipeline = lazyWithRecovery(() => import("@/pages/pipeline"));
const Plugins = lazyWithRecovery(() => import("@/pages/plugins"));
const Subscribers = lazyWithRecovery(() => import("@/pages/subscribers"));
const BusinessDiagnostic = lazyWithRecovery(() => import("@/pages/business-diagnostic-engine"));

const queryClient = new QueryClient();
function PageLoader() { return <div className="flex-1 flex items-center justify-center min-h-[400px]"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>; }
class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("CINTEXA route error", error, info); }
  render() { if (!this.state.error) return this.props.children; return <div className="flex-1 flex items-center justify-center p-8 min-h-[400px]"><div className="max-w-lg w-full rounded-xl border bg-card p-6 text-center shadow-sm"><h2 className="text-xl font-semibold">This page could not be loaded</h2><p className="text-sm text-muted-foreground mt-2">The application recovered from the page error, but the current module needs to be reloaded.</p><button className="mt-5 rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm font-medium" onClick={() => window.location.reload()}>Reload CINTEXA Nexus</button></div></div>; }
}
function AppRoutes() { return <AppLayout><RouteErrorBoundary><Suspense fallback={<PageLoader />}><Switch>
  <Route path="/" component={Dashboard} /><Route path="/diagnostics" component={BusinessDiagnostic} />
  <Route path="/sites" component={Sites} /><Route path="/pages" component={Pages} /><Route path="/pages/new" component={PageEditor} /><Route path="/pages/:id/edit" component={PageEditor} />
  <Route path="/posts" component={Posts} /><Route path="/posts/new" component={PostEditor} /><Route path="/posts/:id/edit" component={PostEditor} /><Route path="/media" component={Media} /><Route path="/users" component={Users} /><Route path="/categories" component={Categories} /><Route path="/menus" component={Menus} /><Route path="/forms" component={Forms} /><Route path="/calendar" component={ContentCalendar} /><Route path="/pipeline" component={ContentPipeline} /><Route path="/seo" component={Seo} /><Route path="/ai" component={AiStudio} /><Route path="/settings" component={Settings} /><Route path="/plugins" component={Plugins} /><Route path="/subscribers" component={Subscribers} /><Route component={NotFound} />
</Switch></Suspense></RouteErrorBoundary></AppLayout>; }
function App() { return <QueryClientProvider client={queryClient}><ThemeProvider defaultTheme="dark" defaultAccent="indigo" storageKey="cintexa-theme" accentStorageKey="cintexa-accent"><TooltipProvider><AuthProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><AppRoutes /></WouterRouter><Toaster /></AuthProvider></TooltipProvider></ThemeProvider></QueryClientProvider>; }
export default App;
