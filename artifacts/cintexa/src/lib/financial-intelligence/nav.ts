export interface FiNavItem {
  key: string;
  label: string;
  href: string;
  section: string;
}

export const FI_NAV: FiNavItem[] = [
  { key: "overview", label: "Executive Dashboard", href: "/financial-intelligence", section: "Overview" },
  { key: "health", label: "Financial Health", href: "/financial-intelligence/health", section: "Overview" },
  { key: "pnl", label: "Profit & Loss", href: "/financial-intelligence/profit-loss", section: "Statements" },
  { key: "balance-sheet", label: "Balance Sheet", href: "/financial-intelligence/balance-sheet", section: "Statements" },
  { key: "ratios", label: "Financial Ratios", href: "/financial-intelligence/ratios", section: "Analysis" },
  { key: "forecast", label: "Forecasting", href: "/financial-intelligence/forecasting", section: "Intelligence" },
  { key: "scenarios", label: "Scenario Simulator", href: "/financial-intelligence/scenarios", section: "Intelligence" },
  { key: "entries", label: "Journal Entries", href: "/financial-intelligence/entries", section: "Operations" },
  { key: "fx", label: "Exchange Rates", href: "/financial-intelligence/exchange-rates", section: "Operations" },
  { key: "settings", label: "Settings", href: "/financial-intelligence/settings", section: "Administration" },
];

export const FI_SECTIONS = ["Overview", "Statements", "Analysis", "Intelligence", "Operations", "Administration"] as const;

export function activeFiKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...FI_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => (i.href === "/financial-intelligence" ? p === "/financial-intelligence" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
