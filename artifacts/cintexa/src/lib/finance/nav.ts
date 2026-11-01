/** Finance navigation. Only modules that are complete (database + API + screens + tests) are listed; the rest stay hidden until they ship. */
export interface FinanceNavItem { key: string; label: string; href: string; section: string }
export const FINANCE_NAV: FinanceNavItem[] = [
  { key: "dashboard", label: "Finance Dashboard", href: "/finance", section: "Overview" },
  { key: "accounts", label: "Chart of Accounts", href: "/finance/accounts", section: "Accounting" },
  { key: "journals", label: "Journal Entries", href: "/finance/journals", section: "Accounting" },
  { key: "ledger", label: "General Ledger", href: "/finance/ledger", section: "Accounting" },
  { key: "trial-balance", label: "Trial Balance", href: "/finance/trial-balance", section: "Accounting" },
  { key: "periods", label: "Accounting Periods", href: "/finance/periods", section: "Accounting" },
  { key: "customers", label: "Customers", href: "/finance/customers", section: "Sales & Receivables" },
  { key: "invoices", label: "Invoices", href: "/finance/invoices", section: "Sales & Receivables" },
  { key: "receivables", label: "Receivables Ageing", href: "/finance/receivables", section: "Sales & Receivables" },
  { key: "suppliers", label: "Suppliers", href: "/finance/suppliers", section: "Purchases & Payables" },
  { key: "bills", label: "Supplier Bills", href: "/finance/bills", section: "Purchases & Payables" },
  { key: "payables", label: "Payables Ageing", href: "/finance/payables", section: "Purchases & Payables" },
  { key: "banking", label: "Bank Accounts", href: "/finance/banking", section: "Cash & Banking" },
  { key: "cashbook", label: "Cashbook", href: "/finance/cashbook", section: "Cash & Banking" },
  { key: "payments", label: "Payments", href: "/finance/payments", section: "Cash & Banking" },
  { key: "expenses", label: "Expenses", href: "/finance/expenses", section: "Expenditure" },
  { key: "tax", label: "Tax Configuration", href: "/finance/tax", section: "Tax Centre" },
  { key: "approvals", label: "Approval Centre", href: "/finance/approvals", section: "Administration" },
  { key: "audit", label: "Audit Trail", href: "/finance/audit", section: "Administration" },
  { key: "settings", label: "Company Settings", href: "/finance/settings", section: "Administration" },
];
export function activeFinanceKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...FINANCE_NAV].sort((a, b) => b.href.length - a.href.length).find((i) => (i.href === "/finance" ? p === "/finance" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
