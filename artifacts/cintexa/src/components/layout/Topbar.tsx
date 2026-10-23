import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Search, Sun, Moon, LogOut, User, ChevronDown, Menu } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { SALES_NAV, SALES_AI_NAV, activeNavKey } from "@/lib/sales/nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const paths = location.split("/").filter(Boolean);
  const salesKey = paths[0] === "sales" ? activeNavKey(location) : null;
  const salesLabel = salesKey ? [...SALES_NAV, SALES_AI_NAV].find((i) => i.key === salesKey)?.label : undefined;
  const breadcrumb = paths.length === 0 ? "Dashboard" : paths[0] === "sales" ? (salesLabel ?? "Sales") : paths[0].charAt(0).toUpperCase() + paths[0].slice(1);

  return (
    <header className="h-16 border-b bg-background flex items-center justify-between gap-2 px-3 sm:px-6 sticky top-0 z-30">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" aria-label="Open navigation" onClick={onMenu}>
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold text-lg truncate">{breadcrumb}</h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-3">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search (Cmd+K)"
          className="hidden sm:flex relative h-9 w-48 lg:w-64 items-center rounded-md bg-secondary/50 pl-9 pr-2 text-left text-sm text-muted-foreground hover:bg-secondary transition-colors"
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4" />
          <span className="truncate">Search... (Cmd+K)</span>
        </button>
        <Button variant="ghost" size="icon" className="h-9 w-9 sm:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
          <Search className="h-4 w-4 text-muted-foreground" />
        </Button>

        <NotificationBell />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>

        <div className="hidden sm:block h-8 w-px bg-border mx-1" />

        <div className="hidden sm:flex items-center gap-2 rounded-lg px-2 py-1.5" title="Everything is stored on this device">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">CX</AvatarFallback>
          </Avatar>
          <div className="text-left">
            <p className="text-xs font-medium leading-none">CINTEXA Workspace</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">This device</p>
          </div>
        </div>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
