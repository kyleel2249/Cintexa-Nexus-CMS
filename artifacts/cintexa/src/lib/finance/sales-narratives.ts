/**
 * Sales → Finance narrative helpers.
 * Deterministic descriptions for invoices, receipts and order-linked journals.
 * No external AI. Uses the same documentation engine as the General Journal.
 */

import { generateDocumentation, type DocumentationResult } from "./documentation-engine";
import { majorToMinor } from "./money";

export interface SalesOrderLine {
  sku?: string | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
}

export interface SalesInvoiceNarrativeInput {
  orderNumber: string;
  customerName?: string;
  currency?: string;
  /** Major units (e.g. 5000 = GHS 5,000) — converted to minor for engine */
  totalMajor?: number;
  /** Or pass minor directly */
  totalMinor?: number;
  lines?: SalesOrderLine[];
  issueDate?: string;
}

export interface SalesPaymentNarrativeInput {
  orderNumber?: string;
  invoiceNumber?: string;
  customerName?: string;
  currency?: string;
  amountMajor?: number;
  amountMinor?: number;
  method?: string | null;
  receivedOn?: string;
}

function toMinor(major?: number, minor?: number): number {
  if (minor != null && Number.isFinite(minor)) return Math.round(minor);
  if (major != null && Number.isFinite(major)) return majorToMinor(major);
  return 0;
}

/**
 * Narrative for a sales invoice posting (Dr AR / Cr Revenue).
 */
export function narrativeForSalesInvoice(input: SalesInvoiceNarrativeInput): {
  description: string;
  arMemo: string;
  revenueMemo: string;
  documentation: DocumentationResult;
} {
  const currency = input.currency || "GHS";
  const amount = toMinor(input.totalMajor, input.totalMinor);
  const customer = input.customerName || "customer";
  const lineSummary =
    input.lines && input.lines.length
      ? input.lines
          .slice(0, 3)
          .map((l) => l.description || l.sku || "item")
          .join("; ") + (input.lines.length > 3 ? "…" : "")
      : "goods or services";

  const documentation = generateDocumentation({
    journalType: "sales",
    entryDate: input.issueDate,
    currency,
    lines: [
      {
        key: "ar",
        account: { code: "1050", name: "Accounts Receivable", type: "asset", subtype: "ar" },
        debit: amount,
        credit: 0,
      },
      {
        key: "rev",
        account: { code: "4000", name: "Sales Revenue", type: "revenue" },
        debit: 0,
        credit: amount,
      },
    ],
  });

  const description =
    `Sales invoice for order ${input.orderNumber} to ${customer} covering ${lineSummary}. ` +
    `Recognises revenue and the related receivable.`;

  return {
    description,
    arMemo: `AR for order ${input.orderNumber} — ${customer}`,
    revenueMemo: `Revenue recognised on order ${input.orderNumber} (${lineSummary})`,
    documentation: {
      ...documentation,
      transactionDescription: description,
      journalMemo: description,
    },
  };
}

/**
 * Narrative for a customer receipt linked to a sales order / invoice.
 */
export function narrativeForSalesPayment(input: SalesPaymentNarrativeInput): {
  description: string;
  bankMemo: string;
  arMemo: string;
  documentation: DocumentationResult;
} {
  const currency = input.currency || "GHS";
  const amount = toMinor(input.amountMajor, input.amountMinor);
  const customer = input.customerName || "customer";
  const ref = input.invoiceNumber || input.orderNumber || "open item";
  const method = input.method ? ` via ${input.method}` : "";

  const documentation = generateDocumentation({
    journalType: "cash_receipt",
    entryDate: input.receivedOn,
    currency,
    lines: [
      {
        key: "bank",
        account: { code: "1030", name: "Bank Accounts", type: "asset", subtype: "bank" },
        debit: amount,
        credit: 0,
      },
      {
        key: "ar",
        account: { code: "1050", name: "Accounts Receivable", type: "asset", subtype: "ar" },
        debit: 0,
        credit: amount,
      },
    ],
  });

  const description =
    `Receipt from ${customer}${method} applied to ${ref}. ` +
    `Increases cash and reduces the outstanding receivable. No additional revenue is recognised.`;

  return {
    description,
    bankMemo: `Receipt ${ref}${method}`,
    arMemo: `Settlement of ${ref} — ${customer}`,
    documentation: {
      ...documentation,
      transactionDescription: description,
      journalMemo: description,
    },
  };
}

/**
 * Narrative for a stand-alone finance invoice (not necessarily from Sales).
 */
export function narrativeForFinanceInvoice(opts: {
  customerName: string;
  amountMinor: number;
  currency?: string;
  revenueAccountCode?: string;
  revenueAccountName?: string;
  issueDate?: string;
}): { description: string; arMemo: string; revenueMemo: string; documentation: DocumentationResult } {
  const currency = opts.currency || "GHS";
  const revCode = opts.revenueAccountCode || "4020";
  const revName = opts.revenueAccountName || "Website Development Revenue";
  const documentation = generateDocumentation({
    journalType: "sales",
    entryDate: opts.issueDate,
    currency,
    lines: [
      {
        key: "ar",
        account: { code: "1050", name: "Accounts Receivable", type: "asset", subtype: "ar" },
        debit: opts.amountMinor,
        credit: 0,
      },
      {
        key: "rev",
        account: { code: revCode, name: revName, type: "revenue" },
        debit: 0,
        credit: opts.amountMinor,
      },
    ],
  });
  const description = `Invoice to ${opts.customerName} recognising revenue and accounts receivable.`;
  return {
    description,
    arMemo: `AR — ${opts.customerName}`,
    revenueMemo: `${revName} — ${opts.customerName}`,
    documentation: { ...documentation, transactionDescription: description, journalMemo: description },
  };
}

export function narrativeForFinancePayment(opts: {
  customerName: string;
  amountMinor: number;
  currency?: string;
  invoiceNumber?: string;
  paymentDate?: string;
  method?: string;
}): { description: string; bankMemo: string; arMemo: string; documentation: DocumentationResult } {
  return narrativeForSalesPayment({
    customerName: opts.customerName,
    amountMinor: opts.amountMinor,
    currency: opts.currency,
    invoiceNumber: opts.invoiceNumber,
    receivedOn: opts.paymentDate,
    method: opts.method,
  });
}
