import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider, useAuth } from "@/context/AuthContext";

import Dashboard from "@/pages/dashboard";
import Sites from "@/pages/sites";
import Pages from "@/pages/pages";
import PageEditor from "@/pages/pages/editor";
import Posts from "@/pages/posts";
import PostEditor from "@/pages/posts/editor";
import Media from "@/pages/media";
import Users from "@/pages/users";
import Categories from "@/pages/categories";
import Menus from "@/pages/menus";
import Forms from "@/pages/forms";
import Seo from "@/pages/seo";
import AiStudio from "@/pages/ai";
import Settings from "@/pages/settings";
import ContentCalendar from "@/pages/calendar";
import ContentPipeline from "@/pages/pipeline";
import Plugins from "@/pages/plugins";
import Subscribers from "@/pages/subscribers";
import Login from "@/pages/login";
import Register from "@/pages/register";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xl">C</span>
          </div>
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
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
    </AppLayout>
  );
}

function AuthRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (user) return <Redirect to="/" />;

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route><Redirect to="/login" /></Route>
    </Switch>
  );
}

function Router() {
  const [location] = useLocation();
  const isAuthPage = location === "/login" || location === "/register";

  return isAuthPage ? <AuthRoutes /> : <ProtectedRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="cintexa-theme">
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
