import {
  BarChart3, CalendarDays, DollarSign, FileText, Gauge, Image, Layout, Lightbulb, Mail, Palette,
  PenTool, Search, Send, Settings, Share2, Target, UserPlus, Users, Zap, Bot, ScrollText, type LucideIcon,
} from "lucide-react";
import type { MarketingNavItem } from "./nav";

export const MARKETING_NAV_ICONS: Record<MarketingNavItem["icon"], LucideIcon> = {
  Gauge, Target, Send, CalendarDays, PenTool, Share2, Mail, Search, Users, UserPlus, Zap,
  Palette, Image, Layout, BarChart3, DollarSign, ScrollText, Settings, Lightbulb, FileText, Bot,
};
