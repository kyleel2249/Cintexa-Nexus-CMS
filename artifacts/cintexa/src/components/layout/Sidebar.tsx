import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Globe, 
  FileText, 
  PenTool, 
  Image as ImageIcon, 
  Users, 
  Tags, 
  MenuSquare, 
  FormInput, 
  Search, 
  Wand2, 
  Settings,
  MonitorPlay,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import { SitePreview } from "@/components/site-preview";

const navGroups = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard }
    ]
  },
  {
    title: "Content",
    items: [
      { name: "Sites", href: "/sites", icon: Globe },
      { name: "Pages", href: "/pages", icon: FileText },
      { name: "Posts", href: "/posts", icon: PenTool }
    ]
  },
  {
    title: "Media",
    items: [
      { name: "Library", href: "/media", icon: ImageIcon }
    ]
  },
  {
    title: "Team",
    items: [
      { name: "Users", href: "/users", icon: Users }
    ]
  },
  {
    title: "Taxonomy",
    items: [
      { name: "Categories", href: "/categories", icon: Tags },
      { name: "Menus", href: "/menus", icon: MenuSquare },
      { name: "Forms", href: "/forms", icon: FormInput }
    ]
  },
  {
    title: "System",
    items: [
      { name: "SEO", href: "/seo", icon: Search },
      { name: "AI Studio", href: "/ai", icon: Wand2 },
      { name: "Settings", href: "/settings", icon: Settings }
    ]
  }
];

export function Sidebar() {
  const [location] = useLocation();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <aside className="w-64 h-screen border-r bg-card flex flex-col fixed left-0 top-0 z-40">
      <div className="h-16 flex items-center px-6 border-b">
        <div className="flex items-center gap-2 text-primary">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
            C
          </div>
          <span className="font-bold text-lg tracking-tight text-foreground">CINTEXA</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
              {group.title}
            </h4>
            <nav className="space-y-1">
              {group.items.map((item) => {
                const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                return (
                  <Link key={item.name} href={item.href}>
                    <div className={cn(
                      "flex items-center gap-3 px-2 py-2 rounded-md transition-colors cursor-pointer group",
                      isActive 
                        ? "bg-primary text-primary-foreground font-medium shadow-sm" 
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}>
                      <item.icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                      <span className="text-sm">{item.name}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      {/* Preview Site button at the bottom */}
      <div className="px-4 py-4 border-t border-border/50">
        <button
          onClick={() => setPreviewOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors group"
        >
          <MonitorPlay className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
          <span className="text-sm">Preview Site</span>
          <span className="ml-auto text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-semibold">LIVE</span>
        </button>
      </div>

      <AnimatePresence>
        {previewOpen && (
          <SitePreview onClose={() => setPreviewOpen(false)} />
        )}
      </AnimatePresence>
    </aside>
  );
}