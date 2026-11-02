/**
 * Period reconciliation between Sales orders/payments and Finance invoices/receipts.
 * Read-only analysis; never mutates financial records.
 */
import type { Q } from "../core/types";
import { formatMoney, fromDb } from "../core/money";

export interface ReconciliationResult {
  periodStart: string;
  periodEnd: string;
  salesOrderTotal: string;
  salesPaymentTotal: string;
  financeInvoiceTotal: string;
  financeReceiptTotal: string;
  differenceInvoice: string;
  differenceCash: string;
  unlinkedSalesAccounts: number;
  integrationEvents: { succeeded: number; failed: number; pending: number; dead: number };
  notes: string[];
}

export async function runPeriodReconciliation(
  q: Q,
  orgId: number,
  periodStart: string,
  periodEnd: string,
  actor?: string,
): Promise<ReconciliationResult> {
  const notes: string[] = [];

  const salesOrders = (await q.query<any>(
    `SELECT COALESCE(SUM(total),0) AS t FROM sales_orders
      WHERE archived_at IS NULL
        AND status NOT IN ('cancelled','draft')
        AND (order_date::date BETWEEN $1::date AND $2::date
             OR (order_date IS NULL AND created_at::date BETWEEN $1::date AND $2::date))`,
    [periodStart, periodEnd],
  )).rows[0];

  const salesPayments = (await q.query<any>(
    `SELECT COALESCE(SUM(amount),0) AS t FROM sales_order_payments
      WHERE payment_date::date BETWEEN $1::date AND $2::date`,
    [periodStart, periodEnd],
  )).rows[0];

  const finInvoices = (await q.query<any>(
    `SELECT COALESCE(SUM(total),0) AS t FROM finance_invoices
      WHERE org_id = $1 AND status = 'issued'
        AND invoice_date BETWEEN $2::date AND $3::date`,
    [orgId, periodStart, periodEnd],
  )).rows[0];

  const finReceipts = (await q.query<any>(
    `SELECT COALESCE(SUM(amount),0) AS t FROM finance_payments
      WHERE org_id = $1 AND direction = 'inbound'
        AND payment_date BETWEEN $2::date AND $3::date`,
    [orgId, periodStart, periodEnd],
  )).rows[0];

  const salesOrderTotal = fromDb(salesOrders?.t ?? 0);
  const salesPaymentTotal = fromDb(salesPayments?.t ?? 0);
  const financeInvoiceTotal = fromDb(finInvoices?.t ?? 0);
  const financeReceiptTotal = fromDb(finReceipts?.t ?? 0);
  const differenceInvoice = salesOrderTotal - financeInvoiceTotal;
  const differenceCash = salesPaymentTotal - financeReceiptTotal;

  if (differenceInvoice !== 0n) {
    notes.push(`Invoice difference of ${formatMoney(differenceInvoice)} between Sales orders and Finance issued invoices. Review integration events and unlinked accounts.`);
  }
  if (differenceCash !== 0n) {
    notes.push(`Cash difference of ${formatMoney(differenceCash)} between Sales payments and Finance inbound receipts.`);
  }

  const unlinked = Number(
    (await q.query<any>(
      `SELECT count(*)::int AS n FROM sales_accounts a
        WHERE a.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM finance_party_links l
             WHERE l.sales_account_id = a.id AND l.link_type = 'customer'
          )`,
    )).rows[0]?.n ?? 0,
  );
  if (unlinked > 0) notes.push(`${unlinked} active Sales accounts have no Finance customer link.`);

  const ev = (await q.query<any>(
    `SELECT status, count(*)::int AS n FROM finance_integration_events
      WHERE (org_id = $1 OR org_id IS NULL)
        AND created_at::date BETWEEN $2::date AND $3::date
      GROUP BY status`,
    [orgId, periodStart, periodEnd],
  )).rows;
  const byStatus: Record<string, number> = {};
  for (const r of ev) byStatus[r.status] = Number(r.n);

  await q.query(
    `INSERT INTO finance_reconciliation_runs
       (org_id, period_start, period_end, status,
        sales_order_total, sales_payment_total, finance_invoice_total, finance_receipt_total,
        difference_invoice, difference_cash, details, created_by)
     VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      orgId,
      periodStart,
      periodEnd,
      formatMoney(salesOrderTotal),
      formatMoney(salesPaymentTotal),
      formatMoney(financeInvoiceTotal),
      formatMoney(financeReceiptTotal),
      formatMoney(differenceInvoice),
      formatMoney(differenceCash),
      JSON.stringify({ unlinkedSalesAccounts: unlinked, events: byStatus, notes }),
      actor ?? null,
    ],
  );

  return {
    periodStart,
    periodEnd,
    salesOrderTotal: formatMoney(salesOrderTotal),
    salesPaymentTotal: formatMoney(salesPaymentTotal),
    financeInvoiceTotal: formatMoney(financeInvoiceTotal),
    financeReceiptTotal: formatMoney(financeReceiptTotal),
    differenceInvoice: formatMoney(differenceInvoice),
    differenceCash: formatMoney(differenceCash),
    unlinkedSalesAccounts: unlinked,
    integrationEvents: {
      succeeded: byStatus.succeeded ?? 0,
      failed: byStatus.failed ?? 0,
      pending: byStatus.pending ?? 0,
      dead: byStatus.dead ?? 0,
    },
    notes,
  };
}
