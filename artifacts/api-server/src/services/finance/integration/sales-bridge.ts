/**
 * Sales → CINTEXA Finance bridge.
 *
 * Implements the FinanceProvider interface expected by the Sales outbox.
 * Uses the same journal engine, source_module/source_ref uniqueness and audit trail as native Finance documents.
 * Never posts revenue for unpaid orders; only creates invoices when the outbox requests it.
 */
import type { FinanceProvider, OrderPayload, ProviderResult } from "../../sales/integrations/providers";
import type { SalesDb } from "@workspace/db";
import { ensureFinanceCustomerFromSalesAccount } from "./party-link";
import { emitIntegrationEvent, markEventFailed, markEventProcessing, markEventSucceeded, markEventSkipped } from "./events";
import { formatMoney, fromDb } from "../core/money";
import { insertJournal, loadPeriod, assertPostable, postJournal, nextNumber, type Who } from "../modules/journals";
import { controlAccount } from "../modules/docs-common";
import { logger } from "../../../lib/logger";

function parseMoney(s: string): bigint {
  const cleaned = String(s ?? "0").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned) && !/^\d+$/.test(cleaned)) return 0n;
  const [i, f = ""] = cleaned.split(".");
  return BigInt(i + f.padEnd(2, "0").slice(0, 2));
}

/** Resolve the single finance organisation for this deployment (single-tenant bootstrap). */
async function resolveOrgId(q: SalesDb): Promise<number | null> {
  const r = await q.query<{ id: number }>(`SELECT id FROM finance_organisations WHERE archived_at IS NULL ORDER BY id LIMIT 1`);
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

async function defaultRevenueAccount(q: SalesDb, orgId: number): Promise<number | null> {
  const r = await q.query<{ id: number }>(
    `SELECT id FROM finance_accounts WHERE org_id = $1 AND subtype = 'sales' AND is_active AND allow_posting ORDER BY code LIMIT 1`,
    [orgId],
  );
  if (r.rows[0]) return Number(r.rows[0].id);
  const r2 = await q.query<{ id: number }>(
    `SELECT id FROM finance_accounts WHERE org_id = $1 AND type = 'revenue' AND is_active AND allow_posting ORDER BY code LIMIT 1`,
    [orgId],
  );
  return r2.rows[0] ? Number(r2.rows[0].id) : null;
}

export function createCintexaFinanceProvider(db: SalesDb): FinanceProvider {
  return {
    name: "cintexa-finance",

    async createInvoice(order: OrderPayload, idempotencyKey: string): Promise<ProviderResult> {
      try {
        return await db.tx(async (q) => {
          const orgId = await resolveOrgId(q as unknown as SalesDb);
          if (!orgId) {
            return { ok: false, error: "No finance organisation configured", retryable: true };
          }

          const { id: eventId, duplicate } = await emitIntegrationEvent(q as any, {
            orgId,
            eventType: "sales.order.invoice_requested",
            sourceModule: "sales",
            sourceEntityType: "order",
            sourceEntityId: order.orderId,
            payload: { orderNumber: order.number, total: order.total, currency: order.currency, idempotencyKey },
            idempotencyKey: `sales.invoice:${idempotencyKey}`,
          });

          if (duplicate) {
            const prior = (await (q as any).query(
              `SELECT status, result_ref FROM finance_integration_events WHERE id = $1`,
              [eventId],
            )).rows[0];
            if (prior?.status === "succeeded" && prior.result_ref) {
              return { ok: true, ref: prior.result_ref };
            }
          }

          await markEventProcessing(q as any, eventId);

          // Already posted via source_ref?
          const existingJ = (await (q as any).query(
            `SELECT id, reference FROM finance_journals
              WHERE org_id = $1 AND source_module = 'sales.order' AND source_ref = $2 AND journal_type <> 'reversal'`,
            [orgId, String(order.orderId)],
          )).rows[0];
          if (existingJ) {
            await markEventSucceeded(q as any, eventId, existingJ.reference, { journalId: existingJ.id });
            return { ok: true, ref: existingJ.reference };
          }

          const linked = await ensureFinanceCustomerFromSalesAccount(q as any, orgId, order.accountId, "sales-bridge");
          const revenueId = await defaultRevenueAccount(q as unknown as SalesDb, orgId);
          if (!revenueId) {
            await markEventFailed(q as any, eventId, "No revenue account configured in chart of accounts", false);
            return { ok: false, error: "No revenue account configured", retryable: true };
          }

          const arId = await controlAccount(q as any, orgId, "accounts_receivable");
          const total = parseMoney(order.total);
          if (total <= 0n) {
            await markEventSkipped(q as any, eventId, "Zero or negative order total");
            return { ok: false, error: "Order total must be greater than zero", retryable: false };
          }

          const invoiceDate = (order.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(order.dueOn))
            ? order.dueOn
            : new Date().toISOString().slice(0, 10);
          // Prefer order date if available from payload extension; otherwise today.
          const entryDate = invoiceDate;

          const period = await loadPeriod(q as any, orgId, entryDate);
          assertPostable(period, true);

          const year = entryDate.slice(0, 4);
          const n = await nextNumber(q as any, orgId, `invoice:${year}`);
          const invNumber = `INV-${year}-${String(n).padStart(6, "0")}`;

          // Create finance invoice (issued) + balanced journal in one transaction.
          const inv = (await (q as any).query(
            `INSERT INTO finance_invoices
               (org_id, number, customer_id, invoice_date, due_date, currency, reference, notes, status,
                subtotal, tax_total, total, amount_paid, created_by, created_by_label, issued_by, issued_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'issued',$9,0,$9,0,'sales-bridge','Sales Bridge','sales-bridge', now())
             RETURNING id, number`,
            [
              orgId,
              invNumber,
              linked.financeCustomerId,
              entryDate,
              order.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(order.dueOn) ? order.dueOn : entryDate,
              (order.currency || "GHS").toUpperCase().slice(0, 3),
              order.number,
              `Auto-created from Sales order ${order.number}`,
              formatMoney(total),
            ],
          )).rows[0];

          // Single revenue line (detailed product lines can be expanded later).
          await (q as any).query(
            `INSERT INTO finance_invoice_lines
               (org_id, invoice_id, line_no, description, quantity, unit_price, net_amount, tax_amount, account_id)
             VALUES ($1,$2,1,$3,1,$4,$4,0,$5)`,
            [orgId, inv.id, `Sales order ${order.number}`, formatMoney(total), revenueId],
          );

          const who: Who = { orgId, sub: "sales-bridge", label: "Sales Bridge" };
          const j = await insertJournal(
            q as any,
            who,
            {
              type: "automated",
              date: entryDate,
              description: `Sales invoice ${invNumber} - ${linked.name} (order ${order.number})`,
              lines: [
                { account_id: arId, debit: total, credit: 0n, description: `AR - ${linked.name}` },
                { account_id: revenueId, debit: 0n, credit: total, description: `Revenue - order ${order.number}` },
              ],
              sourceModule: "sales.order",
              sourceRef: String(order.orderId),
            },
            period,
          );
          const posted = await postJournal(q as any, who, Number(j.id), new Date(), true);

          await (q as any).query(
            `UPDATE finance_invoices SET journal_id = $2 WHERE id = $1 AND org_id = $3`,
            [inv.id, posted.id, orgId],
          );

          await markEventSucceeded(q as any, eventId, invNumber, {
            invoiceId: inv.id,
            journalId: posted.id,
            journalRef: posted.reference,
            financeCustomerId: linked.financeCustomerId,
            customerCreated: linked.created,
          });

          logger.info(
            { orderId: order.orderId, invoice: invNumber, journal: posted.reference },
            "Sales order synced to Finance invoice",
          );

          return { ok: true, ref: invNumber };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 500) : "Finance bridge error";
        logger.error({ err, orderId: order.orderId }, "Sales→Finance invoice failed");
        return { ok: false, error: msg, retryable: true };
      }
    },

    async voidInvoice(invoiceRef: string, reason: string, idempotencyKey: string): Promise<ProviderResult> {
      try {
        return await db.tx(async (q) => {
          const orgId = await resolveOrgId(q as unknown as SalesDb);
          if (!orgId) return { ok: false, error: "No finance organisation configured", retryable: true };

          const { id: eventId } = await emitIntegrationEvent(q as any, {
            orgId,
            eventType: "sales.order.invoice_void_requested",
            sourceModule: "sales",
            sourceEntityType: "invoice_ref",
            sourceEntityId: invoiceRef,
            payload: { reason, idempotencyKey },
            idempotencyKey: `sales.void_invoice:${idempotencyKey}`,
          });
          await markEventProcessing(q as any, eventId);

          const inv = (await (q as any).query(
            `SELECT id, number, status, journal_id, total FROM finance_invoices WHERE org_id = $1 AND number = $2 FOR UPDATE`,
            [orgId, invoiceRef],
          )).rows[0];

          if (!inv) {
            await markEventSkipped(q as any, eventId, "Invoice not found");
            return { ok: false, error: `Invoice ${invoiceRef} not found`, retryable: false };
          }
          if (inv.status === "cancelled") {
            await markEventSucceeded(q as any, eventId, invoiceRef, { alreadyCancelled: true });
            return { ok: true, ref: invoiceRef };
          }
          if (inv.status !== "issued") {
            await markEventFailed(q as any, eventId, `Cannot void invoice in status ${inv.status}`, false);
            return { ok: false, error: `Invoice is ${inv.status}`, retryable: false };
          }

          // Soft-cancel: mark cancelled. Full credit-note / reversal journal can be added when credit notes ship.
          // If a journal exists we post a reversing journal for auditability.
          if (inv.journal_id) {
            const lines = (await (q as any).query(
              `SELECT account_id, debit, credit, description FROM finance_journal_lines WHERE journal_id = $1 AND org_id = $2 ORDER BY line_no`,
              [inv.journal_id, orgId],
            )).rows;
            const jOrig = (await (q as any).query(
              `SELECT entry_date, reference FROM finance_journals WHERE id = $1 AND org_id = $2`,
              [inv.journal_id, orgId],
            )).rows[0];
            if (lines.length && jOrig) {
              const who: Who = { orgId, sub: "sales-bridge", label: "Sales Bridge" };
              const period = await loadPeriod(q as any, orgId, jOrig.entry_date);
              assertPostable(period, true);
              const revLines = lines.map((l: any) => ({
                account_id: Number(l.account_id),
                debit: fromDb(l.credit),
                credit: fromDb(l.debit),
                description: l.description ?? `Reversal of ${jOrig.reference}`,
              }));
              const j = await insertJournal(
                q as any,
                who,
                {
                  type: "reversal",
                  date: jOrig.entry_date,
                  description: `Void ${invoiceRef}: ${reason}`,
                  lines: revLines,
                  sourceModule: "sales.void",
                  sourceRef: invoiceRef,
                  reversalOf: Number(inv.journal_id),
                },
                period,
              );
              await postJournal(q as any, who, Number(j.id), new Date(), true);
              await (q as any).query(
                `UPDATE finance_journals SET reversed_by = $2 WHERE id = $1 AND org_id = $3`,
                [inv.journal_id, j.id, orgId],
              );
            }
          }

          await (q as any).query(
            `UPDATE finance_invoices
                SET status = 'cancelled', cancelled_by = 'sales-bridge', cancelled_at = now(),
                    cancel_reason = $3, updated_at = now()
              WHERE id = $1 AND org_id = $2`,
            [inv.id, orgId, reason.slice(0, 300)],
          );

          await markEventSucceeded(q as any, eventId, invoiceRef, { cancelled: true, reason });
          return { ok: true, ref: invoiceRef };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 500) : "Finance void error";
        logger.error({ err, invoiceRef }, "Sales→Finance void failed");
        return { ok: false, error: msg, retryable: true };
      }
    },
  };
}
