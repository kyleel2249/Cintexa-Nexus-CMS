export const FINANCE_NAV = [
  { key: "overview", label: "Finance Dashboard", href: "/finance", section: "Overview" },
  { key: "accounts", label: "Chart of Accounts", href: "/finance/accounts", section: "Accounting" },
  { key: "journals", label: "Journal Entries", href: "/finance/journals", section: "Accounting" },
  { key: "ledger", label: "General Ledger", href: "/finance/ledger", section: "Accounting" },
  { key: "tb", label: "Trial Balance", href: "/finance/trial-balance", section: "Reports" },
  { key: "pnl", label: "Profit & Loss", href: "/finance/profit-loss", section: "Reports" },
  { key: "bs", label: "Balance Sheet", href: "/finance/balance-sheet", section: "Reports" },
  { key: "invoices", label: "Invoices / AR", href: "/finance/invoices", section: "Receivables" },
  { key: "payments", label: "Payments", href: "/finance/payments", section: "Receivables" },
  { key: "audit", label: "Audit Trail", href: "/finance/audit", section: "System" },
] as const;

export function activeFinanceKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...FINANCE_NAV].sort((a, b) => b.href.length - a.href.length)
    .find((i) => (i.href === "/finance" ? p === "/finance" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
