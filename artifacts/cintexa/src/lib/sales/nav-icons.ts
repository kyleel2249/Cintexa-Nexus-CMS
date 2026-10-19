import { BarChart3, CalendarCheck2, File, FileText, Gauge, Goal, Inbox, Kanban, Lightbulb, ListChecks, Network, Radar, Repeat, ScrollText, Send, Settings, Star, Tag, TrendingUp, User, Users, Zap, type LucideIcon } from "lucide-react";
import type { SalesNavItem } from "./nav";

export const NAV_ICONS: Record<SalesNavItem["icon"], LucideIcon> = {
  Gauge, Inbox, Users, User, Kanban, CalendarCheck2, Goal, Tag, FileText, ListChecks, TrendingUp, BarChart3, Network, Star, Repeat, Send, Radar, ScrollText, Zap, Lightbulb, File, Settings,
};
