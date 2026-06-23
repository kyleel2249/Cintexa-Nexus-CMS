import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/layout/AppLayout";

// Pages
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
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
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
        <Route path="/seo" component={Seo} />
        <Route path="/ai" component={AiStudio} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="cintexa-theme">
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;