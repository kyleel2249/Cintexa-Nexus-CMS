/**
 * Integration seams. Cintexa Nexus has no inventory, finance or messaging module of its own, so Sales talks to
 * them through these interfaces. A provider is only used when (a) it is configured in the environment and
 * (b) enabled in Sales settings. Anything else is reported as "unavailable" / "not connected" - Sales never
 * claims stock was reserved, an invoice was issued or a message was sent unless a provider confirmed it.
 */
export interface ProviderResult {
  ok: boolean;
  /** provider-side reference (invoice number, message id, reservation id) */
  ref?: string;
  error?: string;
  /** true = try again later; false = permanent failure */
  retryable?: boolean;
}

export interface OrderPayload {
  orderId: number;
  number: string;
  accountId: number;
  currency: string;
  total: string;
  lines: Array<{ sku: string | null; description: string; quantity: string; unitPrice: string; productId: number | null }>;
  dueOn?: string | null;
}

export interface InventoryProvider {
  readonly name: string;
  reserve(order: OrderPayload, idempotencyKey: string): Promise<ProviderResult>;
  release(order: OrderPayload, idempotencyKey: string): Promise<ProviderResult>;
  /** current availability by SKU: physical, reserved, availableToPromise, incoming */
  availability(skus: string[]): Promise<Record<string, { physical: string; reserved: string; availableToPromise: string; incoming: string } | null>>;
}

export interface PaymentPayload {
  orderId: number;
  orderNumber: string;
  accountId: number;
  paymentId: number;
  amount: string;
  currency: string;
  receivedOn: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface FinanceProvider {
  readonly name: string;
  createInvoice(order: OrderPayload, idempotencyKey: string): Promise<ProviderResult>;
  voidInvoice(invoiceRef: string, reason: string, idempotencyKey: string): Promise<ProviderResult>;
  /** Optional: post a customer receipt for a Sales order payment into Finance (idempotent). */
  recordPayment?(payment: PaymentPayload, idempotencyKey: string): Promise<ProviderResult>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
}
export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage, idempotencyKey: string): Promise<ProviderResult>;
}

export interface WhatsAppMessage {
  to: string;
  template: string;
  language: string;
  variables: string[];
}
export interface WhatsAppProvider {
  readonly name: string;
  sendTemplate(msg: WhatsAppMessage, idempotencyKey: string): Promise<ProviderResult>;
}

export interface AiRequest {
  feature: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** optional per-call model override (agents choose a model per task); providers ignore it if unsupported */
  model?: string;
}
export interface AiResponse {
  text: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** provider-reported cost in USD when available */
  costUsd?: number;
}
export interface AiProvider {
  readonly name: string;
  /** true when data leaves the company boundary (third-party API) */
  readonly external: boolean;
  complete(req: AiRequest): Promise<AiResponse>;
}

export interface Integrations {
  inventory?: InventoryProvider;
  finance?: FinanceProvider;
  email?: EmailProvider;
  whatsapp?: WhatsAppProvider;
  ai?: AiProvider;
}

export const NO_INTEGRATIONS: Integrations = {};

/** No-op when CINTEXA_FINANCE_API_BASE is unset. Sales never claims invoice/receipt success. */
export const nullFinanceProvider: FinanceProvider = {
  name: "none",
  async createInvoice() {
    return { ok: false, error: "CINTEXA Finance is not installed", retryable: false };
  },
  async voidInvoice() {
    return { ok: false, error: "CINTEXA Finance is not installed", retryable: false };
  },
  async recordPayment() {
    return { ok: false, error: "CINTEXA Finance is not installed", retryable: false };
  },
};

/**
 * HTTP adapter → CINTEXA Finance `/api/finance/*`.
 * Enable with CINTEXA_FINANCE_API_BASE (e.g. https://app.example.com/api/finance).
 * Sales totals (major decimals) are converted to integer minor units (×100).
 * Journal descriptions are deterministic order narratives — no external AI.
 */
export function createHttpFinanceProvider(baseUrl: string): FinanceProvider {
  const root = baseUrl.replace(/\/$/, "");
  return {
    name: "cintexa-finance-http",
    async createInvoice(order, idempotencyKey) {
      try {
        const major = Number(order.total);
        if (!Number.isFinite(major) || major <= 0) {
          return { ok: false, error: "Invalid order total", retryable: false };
        }
        const amountMinor = Math.round(major * 100);
        const lineSummary = order.lines
          .slice(0, 3)
          .map((l) => l.description || l.sku || "item")
          .join("; ");
        const description =
          `Sales invoice for order ${order.number} covering ${lineSummary || "goods or services"}. ` +
          `Recognises revenue and the related receivable.`;
        const res = await fetch(`${root}/invoices`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({
            customerName: `Account #${order.accountId}`,
            amountMinor,
            currency: order.currency || "GHS",
            sourceModule: "sales",
            sourceId: String(order.orderId),
            description,
            arMemo: `AR for order ${order.number}`,
            revenueMemo: `Revenue — order ${order.number}`,
            dueDate: order.dueOn || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) {
          return { ok: false, error: data.error || `Finance HTTP ${res.status}`, retryable: res.status >= 500 };
        }
        return { ok: true, ref: data.invoice?.number || data.journal?.number || idempotencyKey };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Finance request failed", retryable: true };
      }
    },
    async voidInvoice(invoiceRef, reason) {
      return {
        ok: false,
        error: `voidInvoice not implemented for HTTP adapter (${invoiceRef}): ${reason}`,
        retryable: false,
      };
    },
    async recordPayment(payment, idempotencyKey) {
      try {
        const major = Number(payment.amount);
        if (!Number.isFinite(major) || major <= 0) {
          return { ok: false, error: "Invalid payment amount", retryable: false };
        }
        const amountMinor = Math.round(major * 100);
        const description =
          `Receipt for order ${payment.orderNumber}${payment.method ? ` via ${payment.method}` : ""}. ` +
          `Increases cash and reduces receivable. No additional revenue recognised.`;
        const res = await fetch(`${root}/payments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({
            amountMinor,
            currency: payment.currency || "GHS",
            customerName: `Account #${payment.accountId}`,
            paymentDate: payment.receivedOn,
            method: payment.method || undefined,
            sourceModule: "sales",
            sourceId: String(payment.paymentId),
            description,
            bankMemo: `Receipt order ${payment.orderNumber}`,
            arMemo: `Settlement order ${payment.orderNumber}`,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) {
          return { ok: false, error: data.error || `Finance HTTP ${res.status}`, retryable: res.status >= 500 };
        }
        return { ok: true, ref: data.payment?.id || data.journal?.number || idempotencyKey };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Finance payment failed", retryable: true };
      }
    },
  };
}

