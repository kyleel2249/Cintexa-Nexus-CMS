/** Marketing Management navigation — mirrors Sales Management pattern. Permissions enforced on API. */
export interface MarketingNavItem {
  key: string;
  label: string;
  href: string;
  perm: string;
  anyPerm?: string[];
  icon: "Gauge" | "Target" | "Send" | "CalendarDays" | "PenTool" | "Share2" | "Mail" | "Search" | "Users" | "UserPlus" | "Zap" | "Palette" | "Image" | "Layout" | "BarChart3" | "DollarSign" | "ScrollText" | "Settings" | "Lightbulb" | "FileText" | "Bot";
  section?: string;
}

export const MARKETING_NAV: MarketingNavItem[] = [
  { key: "overview", label: "Marketing Overview", href: "/marketing", perm: "marketing:read", icon: "Gauge", section: "Core" },
  { key: "strategy", label: "Marketing Strategy", href: "/marketing/strategy", perm: "marketing:strategy", icon: "Target", section: "Core" },
  { key: "campaigns", label: "Campaign Manager", href: "/marketing/campaigns", perm: "marketing:campaigns", icon: "Send", section: "Core" },
  { key: "calendar", label: "Marketing Calendar", href: "/marketing/calendar", perm: "marketing:read", icon: "CalendarDays", section: "Core" },
  { key: "content", label: "Content Studio", href: "/marketing/content", perm: "marketing:content", icon: "PenTool", section: "Creation" },
  { key: "social", label: "Social Media Manager", href: "/marketing/social", perm: "marketing:social", icon: "Share2", section: "Creation" },
  { key: "email", label: "Email Marketing", href: "/marketing/email", perm: "marketing:email", icon: "Mail", section: "Creation" },
  { key: "seo", label: "SEO Manager", href: "/marketing/seo", perm: "marketing:seo", icon: "Search", section: "Creation" },
  { key: "audience", label: "Audience & Insights", href: "/marketing/audience", perm: "marketing:audience", icon: "Users", section: "Growth" },
  { key: "leads", label: "Lead Generation", href: "/marketing/leads", perm: "marketing:leads", icon: "UserPlus", section: "Growth" },
  { key: "automation", label: "Marketing Automation", href: "/marketing/automation", perm: "marketing:automation", icon: "Zap", section: "Growth" },
  { key: "brand", label: "Brand Management", href: "/marketing/brand", perm: "marketing:brand", icon: "Palette", section: "Assets" },
  { key: "assets", label: "Asset Library", href: "/marketing/assets", perm: "marketing:assets", icon: "Image", section: "Assets" },
  { key: "landing", label: "Landing Pages & Funnels", href: "/marketing/landing", perm: "marketing:landing", icon: "Layout", section: "Assets" },
  { key: "analytics", label: "Marketing Analytics", href: "/marketing/analytics", perm: "marketing:analytics", icon: "BarChart3", section: "Intelligence" },
  { key: "budget", label: "Budget & ROI", href: "/marketing/budget", perm: "marketing:budget", icon: "DollarSign", section: "Intelligence" },
  { key: "reports", label: "Reports & Intelligence", href: "/marketing/reports", perm: "marketing:reports", icon: "ScrollText", section: "Intelligence" },
  { key: "settings", label: "Marketing Settings", href: "/marketing/settings", perm: "marketing:settings", icon: "Settings", section: "System" },
];

export function navFor(perms: ReadonlySet<string>): MarketingNavItem[] {
  return MARKETING_NAV.filter((i) => (i.anyPerm ?? [i.perm]).some((p) => perms.has(p) || perms.has("admin") || perms.has("marketing:*")));
}

/** Longest-prefix match for active state. */
export function activeMarketingKey(pathname: string): string | null {
  let best: MarketingNavItem | null = null;
  for (const i of MARKETING_NAV) {
    const hit = i.href === "/marketing"
      ? pathname === "/marketing" || pathname === "/marketing/"
      : pathname === i.href || pathname.startsWith(`${i.href}/`);
    if (hit && (!best || i.href.length > best.href.length)) best = i;
  }
  return best?.key ?? null;
}
