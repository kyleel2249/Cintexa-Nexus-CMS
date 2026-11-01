/** Organisation roles and the permission matrix. Enforced server-side on every request. */
export const PERMISSIONS = [
  "finance:read", "finance:create", "finance:update", "finance:approve", "finance:post", "finance:reverse", "finance:export", "finance:admin",
  "ledger:read", "ledger:post", "invoices:manage", "expenses:approve", "payments:approve", "payroll:manage", "payroll:approve",
  "tax:manage", "reports:export", "audit:read", "period:override",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const FINANCE_ROLES = [
  "organisation_owner", "finance_director", "financial_controller", "chief_accountant", "accountant", "ar_officer", "ap_officer",
  "payroll_manager", "hr_officer", "cashier", "procurement_officer", "department_manager", "internal_auditor", "external_auditor", "readonly_executive",
] as const;
export type FinanceRole = (typeof FINANCE_ROLES)[number];

const ALL = [...PERMISSIONS] as Permission[];
const READ: Permission[] = ["finance:read", "ledger:read"];

export const ROLE_PERMISSIONS: Record<FinanceRole, Permission[]> = {
  organisation_owner: ALL,
  finance_director: ALL,
  financial_controller: ALL.filter((p) => p !== "finance:admin"),
  chief_accountant: [...READ, "finance:create", "finance:update", "finance:approve", "finance:post", "finance:reverse", "finance:export", "ledger:post", "reports:export", "audit:read", "invoices:manage", "tax:manage", "payments:approve", "period:override"],
  accountant: [...READ, "finance:create", "finance:update", "finance:export", "ledger:post", "reports:export", "invoices:manage"],
  ar_officer: [...READ, "finance:create", "finance:update", "invoices:manage"],
  ap_officer: [...READ, "finance:create", "finance:update"],
  payroll_manager: [...READ, "payroll:manage", "finance:create"],
  hr_officer: ["finance:read", "payroll:manage"],
  cashier: [...READ, "finance:create"],
  procurement_officer: ["finance:read", "finance:create"],
  department_manager: ["finance:read", "expenses:approve"],
  internal_auditor: [...READ, "finance:export", "reports:export", "audit:read"],
  external_auditor: [...READ, "reports:export", "audit:read"],
  readonly_executive: [...READ, "reports:export"],
};

export const hasPermission = (role: string, p: Permission): boolean => (ROLE_PERMISSIONS as Record<string, Permission[]>)[role]?.includes(p) ?? false;
