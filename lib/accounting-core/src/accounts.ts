import type { IsoDate } from "./decimal";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "cost_of_sales" | "expense";
export type NormalBalance = "debit" | "credit";

export interface AccountSeed {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  normalBalance: NormalBalance;
  parentCode?: string;
  /** Header accounts group other accounts and can never be posted to. */
  postable: boolean;
  /**
   * Stable role key. Posting rules look accounts up by role, never by hard-coded code, so renumbering the chart never
   * breaks an accounting event.
   */
  systemRole?: string;
}

export const ACCOUNT_CODE = /^[0-9]{4,10}$/;

export function defaultNormalBalance(type: AccountType): NormalBalance {
  return type === "asset" || type === "expense" || type === "cost_of_sales" ? "debit" : "credit";
}

function header(code: string, name: string, type: AccountType, subtype: string, parentCode?: string): AccountSeed {
  return { code, name, type, subtype, normalBalance: defaultNormalBalance(type), parentCode, postable: false };
}

function acct(code: string, name: string, type: AccountType, subtype: string, parentCode: string, systemRole?: string, normal?: NormalBalance): AccountSeed {
  return { code, name, type, subtype, normalBalance: normal ?? defaultNormalBalance(type), parentCode, postable: true, systemRole };
}

/**
 * The one authoritative chart of accounts. Contra accounts (accumulated depreciation, allowances, drawings, returns) carry
 * the opposite normal balance to their type. Seeded once; afterwards the chart is managed through the ledger service.
 */
export const DEFAULT_CHART: AccountSeed[] = [
  // ---- Assets ----
  header("1000", "Current Assets", "asset", "current_assets"),
  acct("1010", "Cash on Hand", "asset", "cash_and_bank", "1000", "cash_on_hand"),
  acct("1020", "Bank - Main Account", "asset", "cash_and_bank", "1000", "bank_main"),
  acct("1100", "Accounts Receivable", "asset", "receivables", "1000", "accounts_receivable"),
  acct("1110", "Allowance for Expected Credit Losses", "asset", "receivables", "1000", "ecl_allowance", "credit"),
  acct("1200", "Inventory", "asset", "inventory", "1000", "inventory"),
  acct("1300", "Prepaid Expenses", "asset", "prepayments", "1000", "prepaid_expenses"),
  acct("1400", "Tax Receivable", "asset", "tax_assets", "1000", "tax_receivable"),
  header("1500", "Non-current Assets", "asset", "non_current_assets"),
  acct("1510", "Computer Equipment - Cost", "asset", "property_plant_equipment", "1500", "fixed_asset_computer_equipment"),
  acct("1511", "Accumulated Depreciation - Computer Equipment", "asset", "property_plant_equipment", "1500", "accum_dep_computer_equipment", "credit"),
  acct("1520", "Furniture and Fittings - Cost", "asset", "property_plant_equipment", "1500", "fixed_asset_furniture"),
  acct("1521", "Accumulated Depreciation - Furniture and Fittings", "asset", "property_plant_equipment", "1500", "accum_dep_furniture", "credit"),
  acct("1530", "Motor Vehicles - Cost", "asset", "property_plant_equipment", "1500", "fixed_asset_vehicles"),
  acct("1531", "Accumulated Depreciation - Motor Vehicles", "asset", "property_plant_equipment", "1500", "accum_dep_vehicles", "credit"),
  acct("1540", "Office and Other Equipment - Cost", "asset", "property_plant_equipment", "1500", "fixed_asset_other_equipment"),
  acct("1541", "Accumulated Depreciation - Office and Other Equipment", "asset", "property_plant_equipment", "1500", "accum_dep_other_equipment", "credit"),
  acct("1600", "Loans to Owners", "asset", "related_party_receivables", "1500", "owner_loan_receivable"),

  // ---- Liabilities ----
  header("2000", "Current Liabilities", "liability", "current_liabilities"),
  acct("2010", "Accounts Payable", "liability", "payables", "2000", "accounts_payable"),
  acct("2020", "Accrued Expenses", "liability", "accruals", "2000", "accrued_expenses"),
  acct("2030", "Deferred Revenue (Contract Liabilities)", "liability", "contract_liabilities", "2000", "deferred_revenue"),
  acct("2040", "Customer Advances", "liability", "contract_liabilities", "2000", "customer_advances"),
  header("2100", "Payroll Liabilities", "liability", "payroll_liabilities", "2000"),
  acct("2110", "Net Salaries Payable", "liability", "payroll_liabilities", "2100", "net_salaries_payable"),
  acct("2120", "PAYE Payable", "liability", "payroll_liabilities", "2100", "paye_payable"),
  acct("2130", "Pension Contributions Payable", "liability", "payroll_liabilities", "2100", "pension_payable"),
  acct("2140", "Other Payroll Liabilities", "liability", "payroll_liabilities", "2100", "other_payroll_liabilities"),
  header("2200", "Tax Liabilities", "liability", "tax_liabilities", "2000"),
  acct("2210", "Income Tax Payable", "liability", "tax_liabilities", "2200", "income_tax_payable"),
  acct("2220", "VAT and Levies Payable", "liability", "tax_liabilities", "2200", "vat_payable"),
  acct("2300", "Short-term Loans", "liability", "borrowings", "2000", "short_term_loans"),
  header("2400", "Non-current Liabilities", "liability", "non_current_liabilities"),
  acct("2410", "Long-term Loans", "liability", "borrowings", "2400", "long_term_loans"),
  acct("2420", "Loans from Owners", "liability", "related_party_payables", "2400", "owner_loan_payable"),

  // ---- Equity ----
  header("3000", "Equity", "equity", "equity"),
  acct("3010", "Owner's Capital", "equity", "contributed_capital", "3000", "owner_capital"),
  acct("3020", "Investor Capital", "equity", "contributed_capital", "3000", "investor_capital"),
  acct("3100", "Retained Earnings", "equity", "retained_earnings", "3000", "retained_earnings"),
  acct("3200", "Owner Drawings", "equity", "distributions", "3000", "owner_drawings", "debit"),
  acct("3210", "Dividends Declared", "equity", "distributions", "3000", "dividends", "debit"),
  acct("3900", "Income Summary", "equity", "closing", "3000", "income_summary"),

  // ---- Revenue ----
  header("4000", "Revenue", "revenue", "revenue"),
  acct("4010", "Product Sales", "revenue", "revenue", "4000", "sales_revenue_products"),
  acct("4020", "Service Revenue", "revenue", "revenue", "4000", "sales_revenue_services"),
  acct("4030", "Contract Revenue", "revenue", "revenue", "4000", "sales_revenue_contracts"),
  acct("4090", "Sales Returns and Allowances", "revenue", "revenue", "4000", "sales_returns", "debit"),
  acct("4095", "Sales Discounts", "revenue", "revenue", "4000", "sales_discounts", "debit"),
  acct("4100", "Other Income", "revenue", "other_income", "4000", "other_income"),
  acct("4110", "Interest Income", "revenue", "other_income", "4000", "interest_income"),
  acct("4200", "Realised FX Gain", "revenue", "fx", "4000", "fx_gain_realised"),
  acct("4210", "Unrealised FX Gain", "revenue", "fx", "4000", "fx_gain_unrealised"),

  // ---- Cost of sales ----
  header("5000", "Cost of Sales", "cost_of_sales", "cost_of_sales"),
  acct("5010", "Cost of Goods Sold", "cost_of_sales", "cost_of_sales", "5000", "cogs"),
  acct("5020", "Inventory Write-downs and Losses", "cost_of_sales", "cost_of_sales", "5000", "inventory_writedown"),
  acct("5030", "Project and Service Delivery Costs", "cost_of_sales", "cost_of_sales", "5000", "delivery_costs"),
  acct("5040", "Direct Labour", "cost_of_sales", "cost_of_sales", "5000", "direct_labour"),

  // ---- Expenses ----
  header("6000", "Operating Expenses", "expense", "operating_expenses"),
  acct("6010", "Salaries and Wages", "expense", "employee_costs", "6000", "salaries_expense"),
  acct("6020", "Employer Pension Expense", "expense", "employee_costs", "6000", "employer_pension_expense"),
  acct("6030", "Other Employee Benefits", "expense", "employee_costs", "6000", "employee_benefits_expense"),
  acct("6040", "Sales Commissions", "expense", "selling_expenses", "6000", "commissions_expense"),
  acct("6100", "Rent", "expense", "occupancy", "6000", "rent_expense"),
  acct("6110", "Utilities", "expense", "occupancy", "6000", "utilities_expense"),
  acct("6120", "Repairs and Maintenance", "expense", "occupancy", "6000", "repairs_expense"),
  acct("6200", "Marketing and Advertising", "expense", "selling_expenses", "6000", "marketing_expense"),
  acct("6300", "Administrative Expenses", "expense", "administrative_expenses", "6000", "admin_expense"),
  acct("6400", "Depreciation Expense - Computer Equipment", "expense", "depreciation", "6000", "depreciation_expense_computer_equipment"),
  acct("6410", "Depreciation Expense - Furniture and Fittings", "expense", "depreciation", "6000", "depreciation_expense_furniture"),
  acct("6420", "Depreciation Expense - Motor Vehicles", "expense", "depreciation", "6000", "depreciation_expense_vehicles"),
  acct("6430", "Depreciation Expense - Office and Other Equipment", "expense", "depreciation", "6000", "depreciation_expense_other_equipment"),
  acct("6500", "Expected Credit Loss Expense", "expense", "impairment", "6000", "ecl_expense"),
  header("6700", "Finance Costs", "expense", "finance_costs", "6000"),
  acct("6710", "Interest Expense", "expense", "finance_costs", "6700", "interest_expense"),
  acct("6720", "Realised FX Loss", "expense", "fx", "6700", "fx_loss_realised"),
  acct("6730", "Unrealised FX Loss", "expense", "fx", "6700", "fx_loss_unrealised"),
  acct("6800", "Income Tax Expense", "expense", "income_tax", "6000", "income_tax_expense"),
];

/** Sanity-checks a chart: unique codes and roles, parents defined earlier and non-postable, valid shapes. */
export function validateChart(seeds: readonly AccountSeed[]): string[] {
  const problems: string[] = [];
  const index = new Map<string, number>();
  const roles = new Set<string>();
  seeds.forEach((s, i) => {
    if (!ACCOUNT_CODE.test(s.code)) problems.push(`${s.code}: code must be 4-10 digits`);
    if (index.has(s.code)) problems.push(`${s.code}: duplicate code`);
    index.set(s.code, i);
    if (!s.name.trim()) problems.push(`${s.code}: name is required`);
    if (s.systemRole) {
      if (roles.has(s.systemRole)) problems.push(`${s.code}: duplicate system role ${s.systemRole}`);
      roles.add(s.systemRole);
      if (!s.postable) problems.push(`${s.code}: a header account cannot hold a system role`);
    }
    if (s.parentCode !== undefined) {
      const p = index.get(s.parentCode);
      if (p === undefined) problems.push(`${s.code}: parent ${s.parentCode} must be defined before it`);
      else if (seeds[p]?.postable) problems.push(`${s.code}: parent ${s.parentCode} is postable; parents must be headers`);
    }
  });
  return problems;
}

export const SYSTEM_ROLES: string[] = DEFAULT_CHART.flatMap((s) => (s.systemRole ? [s.systemRole] : []));

export interface AccountRecordLike {
  code: string;
  createdOn?: IsoDate;
}
