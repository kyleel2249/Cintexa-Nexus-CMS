export const FINANCE_NAV = [
  { key: "overview", label: "Finance Dashboard", href: "/finance", section: "Overview" },
  { key: "accounts", label: "Chart of Accounts", href: "/finance/accounts", section: "Accounting" },
  { key: "journals", label: "Journal Entries", href: "/finance/journals", section: "Accounting" },
  { key: "assets", label: "Fixed Assets & Depreciation", href: "/finance/assets", section: "Accounting" },
  { key: "periods", label: "Accounting Periods", href: "/finance/periods", section: "System" },
  { key: "integrity", label: "Accounting Integrity", href: "/finance/integrity", section: "System" },
  { key: "ledger", label: "General Ledger", href: "/finance/ledger", section: "Accounting" },
  { key: "tb", label: "Trial Balance", href: "/finance/trial-balance", section: "Reports" },
  { key: "pnl", label: "Profit & Loss", href: "/finance/profit-loss", section: "Reports" },
  { key: "bs", label: "Balance Sheet", href: "/finance/balance-sheet", section: "Reports" },
  { key: "ratios", label: "Financial Ratios", href: "/finance/ratios", section: "Reports" },
  { key: "cf", label: "Cash Flow", href: "/finance/cash-flow", section: "Reports" },
  { key: "ar-aging", label: "AR Aging", href: "/finance/ar-aging", section: "Reports" },
  { key: "dep-sched", label: "Depreciation Schedule", href: "/finance/depreciation-schedule", section: "Reports" },
  { key: "equity", label: "Equity Statement", href: "/finance/equity-statement", section: "Reports" },
  { key: "adjustments", label: "Period Adjustments", href: "/finance/adjustments", section: "Accounting" },
  { key: "invoices", label: "Invoices / AR", href: "/finance/invoices", section: "Receivables" },
  { key: "discounts", label: "Discounts & Prof. Services", href: "/finance/discounts", section: "Receivables" },
  { key: "payments", label: "Payments", href: "/finance/payments", section: "Receivables" },
  { key: "fx", label: "Foreign Exchange", href: "/finance/fx", section: "Accounting Engine" },
  { key: "inventory", label: "Inventory & COGS", href: "/finance/inventory", section: "Accounting Engine" },
  { key: "payroll", label: "Payroll", href: "/finance/payroll", section: "Accounting Engine" },
  { key: "restatements", label: "Restatements & Year-End", href: "/finance/restatements", section: "Accounting Engine" },
  { key: "audit", label: "Audit Trail", href: "/finance/audit", section: "System" },
] as const;

export function activeFinanceKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...FINANCE_NAV].sort((a, b) => b.href.length - a.href.length)
    .find((i) => (i.href === "/finance" ? p === "/finance" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
