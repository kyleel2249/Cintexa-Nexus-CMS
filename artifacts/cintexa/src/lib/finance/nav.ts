/** Finance navigation. Only modules that are complete (database + API + screens + tests) are listed; the rest stay hidden until they ship. */
export interface FinanceNavItem { key: string; label: string; href: string; section: string }
export const FINANCE_NAV: FinanceNavItem[] = [
  { key: "dashboard", label: "Finance Dashboard", href: "/finance", section: "Overview" },
  { key: "accounts", label: "Chart of Accounts", href: "/finance/accounts", section: "Accounting" },
  { key: "journals", label: "Journal Entries", href: "/finance/journals", section: "Accounting" },
  { key: "ledger", label: "General Ledger", href: "/finance/ledger", section: "Accounting" },
  { key: "trial-balance", label: "Trial Balance", href: "/finance/trial-balance", section: "Accounting" },
  { key: "periods", label: "Accounting Periods", href: "/finance/periods", section: "Accounting" },
  { key: "approvals", label: "Approval Centre", href: "/finance/approvals", section: "Administration" },
  { key: "audit", label: "Audit Trail", href: "/finance/audit", section: "Administration" },
  { key: "settings", label: "Company Settings", href: "/finance/settings", section: "Administration" },
];
export function activeFinanceKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...FINANCE_NAV].sort((a, b) => b.href.length - a.href.length).find((i) => (i.href === "/finance" ? p === "/finance" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
