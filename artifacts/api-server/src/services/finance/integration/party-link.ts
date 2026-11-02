/**
 * Party linkage: ensure a finance_customers row exists for a sales_accounts row and keep the mapping.
 * Never overwrites an existing finance customer; creates only when missing.
 */
import type { Q } from "../core/types";

export interface LinkedCustomer {
  financeCustomerId: number;
  code: string;
  name: string;
  created: boolean;
}

export async function ensureFinanceCustomerFromSalesAccount(
  q: Q,
  orgId: number,
  salesAccountId: number,
  actor?: string,
): Promise<LinkedCustomer> {
  const existing = (await q.query<any>(
    `SELECT l.finance_customer_id, c.code, c.name
       FROM finance_party_links l
       JOIN finance_customers c ON c.id = l.finance_customer_id AND c.org_id = l.org_id
      WHERE l.org_id = $1 AND l.sales_account_id = $2 AND l.link_type = 'customer'
      LIMIT 1`,
    [orgId, salesAccountId],
  )).rows[0];
  if (existing) {
    return {
      financeCustomerId: Number(existing.finance_customer_id),
      code: existing.code,
      name: existing.name,
      created: false,
    };
  }

  const acc = (await q.query<any>(
    `SELECT id, number, name, email, phone, currency, payment_terms_days, credit_limit, address_line, city, region, country, postal_code, classification, status
       FROM sales_accounts WHERE id = $1 AND archived_at IS NULL`,
    [salesAccountId],
  )).rows[0];
  if (!acc) throw new Error(`Sales account ${salesAccountId} not found or archived`);

  // Prefer match by code (sales account number) then by email.
  let cust = (await q.query<any>(
    `SELECT id, code, name FROM finance_customers WHERE org_id = $1 AND code = $2 LIMIT 1`,
    [orgId, acc.number],
  )).rows[0];
  let matchMethod = "code";
  if (!cust && acc.email) {
    cust = (await q.query<any>(
      `SELECT id, code, name FROM finance_customers WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
      [orgId, acc.email],
    )).rows[0];
    matchMethod = "email";
  }

  let created = false;
  if (!cust) {
    const address = {
      line1: acc.address_line ?? null,
      city: acc.city ?? null,
      region: acc.region ?? null,
      country: acc.country ?? null,
      postal_code: acc.postal_code ?? null,
    };
    cust = (await q.query<any>(
      `INSERT INTO finance_customers (org_id, code, name, classification, email, phone, address, payment_terms_days, credit_limit, currency, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10, TRUE)
       RETURNING id, code, name`,
      [
        orgId,
        acc.number,
        acc.name,
        acc.classification ?? null,
        acc.email ?? null,
        acc.phone ?? null,
        JSON.stringify(address),
        Number(acc.payment_terms_days ?? 30),
        acc.credit_limit ?? null,
        (acc.currency || "GHS").toUpperCase().slice(0, 3),
      ],
    )).rows[0];
    created = true;
    matchMethod = "auto";
  }

  await q.query(
    `INSERT INTO finance_party_links (org_id, sales_account_id, finance_customer_id, link_type, match_method, is_primary, created_by)
     VALUES ($1,$2,$3,'customer',$4,TRUE,$5)
     ON CONFLICT (org_id, sales_account_id, link_type) DO UPDATE SET finance_customer_id = EXCLUDED.finance_customer_id, updated_at = now()`,
    [orgId, salesAccountId, Number(cust.id), matchMethod, actor ?? null],
  );

  return {
    financeCustomerId: Number(cust.id),
    code: cust.code,
    name: cust.name,
    created,
  };
}
