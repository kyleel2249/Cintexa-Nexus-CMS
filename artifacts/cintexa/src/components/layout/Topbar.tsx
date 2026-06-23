import { useLocation } from "wouter";
import { Search, Sun, Moon, Bell } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Topbar() {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  // Basic breadcrumb generation
  const paths = location.split("/").filter(Boolean);
  const breadcrumb = paths.length === 0 ? "Dashboard" : paths[0].charAt(0).toUpperCase() + paths[0].slice(1);

  return (
    <header className="h-16 border-b bg-background flex items-center justify-between px-6 sticky top-0 z-30 ml-64">
      <div className="flex items-center gap-4">
        <h1 className="font-semibold text-lg">{breadcrumb}</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search... (Cmd+K)" 
            className="pl-9 bg-secondary/50 border-none h-9 text-sm focus-visible:ring-1"
          />
        </div>

        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Bell className="h-4 w-4 text-muted-foreground" />
        </Button>

        <Button 
          variant="ghost" 
          size="icon" 
          className="h-9 w-9"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>

        <div className="h-8 w-px bg-border mx-1"></div>

        <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-transparent hover:ring-primary transition-all">
          <AvatarFallback className="bg-primary/10 text-primary text-xs">AD</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}