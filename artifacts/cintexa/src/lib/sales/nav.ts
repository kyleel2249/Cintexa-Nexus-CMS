/** The 22 Sales Management sections. `perm` is the permission needed to see the section (enforced again by the API). */
export interface SalesNavItem {
  key: string;
  label: string;
  href: string;
  perm: string;
  /** any one of these permissions is enough (used instead of perm when set) */
  anyPerm?: string[];
  icon: "Gauge" | "Inbox" | "Users" | "User" | "Kanban" | "CalendarCheck2" | "Goal" | "Tag" | "FileText" | "ListChecks" | "TrendingUp" | "BarChart3" | "Network" | "Star" | "Repeat" | "Send" | "Radar" | "ScrollText" | "Zap" | "Lightbulb" | "File" | "Settings" | "Bot";
}

export const SALES_NAV: SalesNavItem[] = [
  { key: "overview", label: "Sales Overview", href: "/sales", perm: "dashboard:read", icon: "Gauge" },
  { key: "leads", label: "Leads", href: "/sales/leads", perm: "leads:read", icon: "Inbox" },
  { key: "accounts", label: "Accounts & Customers", href: "/sales/accounts", perm: "accounts:read", icon: "Users" },
  { key: "contacts", label: "Contacts", href: "/sales/contacts", perm: "contacts:read", icon: "User" },
  { key: "pipeline", label: "Opportunities & Pipeline", href: "/sales/pipeline", perm: "opportunities:read", icon: "Kanban" },
  { key: "activities", label: "Activities & Follow-ups", href: "/sales/activities", perm: "activities:read", icon: "CalendarCheck2" },
  { key: "targets", label: "Sales Targets & Quotas", href: "/sales/targets", perm: "targets:read", icon: "Goal" },
  { key: "products", label: "Products & Price Books", href: "/sales/products", perm: "products:read", icon: "Tag" },
  { key: "quotations", label: "Quotations & Proposals", href: "/sales/quotations", perm: "quotations:read", icon: "FileText" },
  { key: "orders", label: "Sales Orders", href: "/sales/orders", perm: "orders:read", icon: "ListChecks" },
  { key: "forecasting", label: "Sales Forecasting", href: "/sales/forecasting", perm: "forecast:read", icon: "TrendingUp" },
  { key: "performance", label: "Sales Performance", href: "/sales/performance", perm: "performance:read", anyPerm: ["performance:read", "leaderboard:read"], icon: "BarChart3" },
  { key: "teams", label: "Sales Territories & Teams", href: "/sales/teams", perm: "teams:read", icon: "Network" },
  { key: "commissions", label: "Commissions & Incentives", href: "/sales/commissions", perm: "commissions:read", icon: "Star" },
  { key: "retention", label: "Customer Retention", href: "/sales/retention", perm: "retention:read", icon: "Repeat" },
  { key: "campaigns", label: "Sales Campaigns", href: "/sales/campaigns", perm: "campaigns:read", icon: "Send" },
  { key: "competitors", label: "Competitor Intelligence", href: "/sales/competitors", perm: "competitors:read", icon: "Radar" },
  { key: "reports", label: "Sales Reports & Analytics", href: "/sales/reports", perm: "reports:read", icon: "ScrollText" },
  { key: "automation", label: "Sales Automation", href: "/sales/automation", perm: "automation:read", icon: "Zap" },
  { key: "playbook", label: "Sales Playbook & Training", href: "/sales/playbook", perm: "playbook:read", icon: "Lightbulb" },
  { key: "documents", label: "Sales Documents", href: "/sales/documents", perm: "documents:read", icon: "File" },
  { key: "settings", label: "Sales Settings", href: "/sales/settings", perm: "settings:read", icon: "Settings" },
];

/** The AI agent network lives inside Sales Overview but gets its own pinned sidebar entry so it is always discoverable. It is not one of the 22 sections. */
export const SALES_AI_NAV: SalesNavItem = { key: "command-centre", label: "Sales AI Command Centre", href: "/sales/command-centre", perm: "agents:read", icon: "Bot" };

export const SALES_GLOSSARY_NAV = { key: "glossary", label: "Glossary & Help", href: "/sales/glossary" } as const;

export function showAiNav(perms: ReadonlySet<string>): boolean {
  return perms.has(SALES_AI_NAV.perm);
}

export function navFor(perms: ReadonlySet<string>): SalesNavItem[] {
  return SALES_NAV.filter((i) => (i.anyPerm ?? [i.perm]).some((p) => perms.has(p)));
}

/** Longest-prefix match so /sales/leads/12 highlights "Leads" and /sales highlights only the overview. */
export function activeNavKey(pathname: string): string | null {
  if (pathname.startsWith("/sales/glossary")) return "glossary";
  if (pathname.startsWith("/sales/command-centre") || pathname.startsWith("/sales/approvals")) return SALES_AI_NAV.key;
  let best: SalesNavItem | null = null;
  for (const i of SALES_NAV) {
    const hit = i.href === "/sales" ? pathname === "/sales" || pathname === "/sales/" : pathname === i.href || pathname.startsWith(`${i.href}/`);
    if (hit && (!best || i.href.length > best.href.length)) best = i;
  }
  return best?.key ?? null;
}
