import { useLocation } from "wouter";
import { Search, Sun, Moon, Bell, LogOut, User, ChevronDown } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function Topbar() {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

  const paths = location.split("/").filter(Boolean);
  const breadcrumb = paths.length === 0 ? "Dashboard" : paths[0].charAt(0).toUpperCase() + paths[0].slice(1);

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "??";

  return (
    <header className="h-16 border-b bg-background flex items-center justify-between px-6 sticky top-0 z-30 ml-64">
      <div className="flex items-center gap-4">
        <h1 className="font-semibold text-lg">{breadcrumb}</h1>
      </div>

      <div className="flex items-center gap-3">
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

        <div className="h-8 w-px bg-border mx-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary transition-colors outline-none">
              <Avatar className="h-7 w-7">
                {user?.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-medium leading-none">{user?.name ?? "..."}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{user?.role ?? ""}</p>
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                <Badge
                  variant="outline"
                  className={`w-fit text-[10px] py-0 h-4 mt-1 ${
                    user?.role === "admin"
                      ? "border-purple-500/40 text-purple-400"
                      : "border-blue-500/40 text-blue-400"
                  }`}
                >
                  {user?.role}
                </Badge>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onClick={() => logout()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
