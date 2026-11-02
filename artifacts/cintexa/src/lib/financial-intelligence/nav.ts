/** Financial Intelligence navigation — only routes that exist in the app. */
export interface FiNavItem {
  key: string;
  label: string;
  href: string;
  section: string;
}

export const FI_NAV: FiNavItem[] = [
  { key: "overview", label: "Financial Overview", href: "/financial-intelligence", section: "Overview" },
  { key: "ratios", label: "Financial Ratios", href: "/financial-intelligence/ratios", section: "Analysis" },
  { key: "pnl", label: "Profit & Loss Analysis", href: "/financial-intelligence/profit-loss", section: "Analysis" },
  { key: "cashflow", label: "Cashflow Analysis", href: "/financial-intelligence/cashflow", section: "Analysis" },
  { key: "balance-sheet", label: "Balance Sheet Analysis", href: "/financial-intelligence/balance-sheet", section: "Analysis" },
  { key: "revenue", label: "Revenue & Sales Analytics", href: "/financial-intelligence/revenue", section: "Analysis" },
  { key: "cac", label: "Customer Acquisition & Retention", href: "/financial-intelligence/customer-acquisition", section: "Analysis" },
  { key: "expenses", label: "Cost & Expense Analysis", href: "/financial-intelligence/expenses", section: "Analysis" },
  { key: "budget", label: "Budget & Forecasting", href: "/financial-intelligence/budget", section: "Planning" },
  { key: "working-capital", label: "Working Capital", href: "/financial-intelligence/working-capital", section: "Planning" },
  { key: "health", label: "Financial Health & Risk", href: "/financial-intelligence/health", section: "Planning" },
  { key: "investors", label: "Investor Management", href: "/financial-intelligence/investors", section: "Capital" },
  { key: "shareholders", label: "Shareholder Management", href: "/financial-intelligence/shareholders", section: "Capital" },
  { key: "dividends", label: "Dividends & Investor Returns", href: "/financial-intelligence/dividends", section: "Capital" },
  { key: "valuation", label: "Business Valuation", href: "/financial-intelligence/valuation", section: "Capital" },
  { key: "reports", label: "Financial Reports", href: "/financial-intelligence/reports", section: "Reports" },
    { key: "payment-bridge", label: "Payment Bridge", href: "/financial-intelligence/payment-bridge", section: "Operations" },
  { key: "fx", label: "Multi-currency FX", href: "/financial-intelligence/fx", section: "Operations" },
  { key: "board-packs", label: "Board Packs", href: "/financial-intelligence/board-packs", section: "Operations" },
  { key: "comparatives", label: "Comparatives", href: "/financial-intelligence/comparatives", section: "Operations" },
  { key: "agents", label: "Intelligence Agents", href: "/financial-intelligence/agents", section: "Operations" },
  { key: "notifications", label: "Notifications", href: "/financial-intelligence/notifications", section: "Operations" },
  { key: "permissions", label: "Permissions Matrix", href: "/financial-intelligence/permissions", section: "Administration" },
  { key: "audit", label: "FI Audit Trail", href: "/financial-intelligence/audit", section: "Administration" },
  { key: "system-health", label: "System Health", href: "/financial-intelligence/system-health", section: "Administration" },
  { key: "integration", label: "Sales ↔ Finance Integration", href: "/financial-intelligence/integration", section: "Administration" },
  { key: "settings", label: "Financial Settings", href: "/financial-intelligence/settings", section: "Administration" },
];

export function activeFiKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...FI_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => (i.href === "/financial-intelligence" ? p === "/financial-intelligence" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
