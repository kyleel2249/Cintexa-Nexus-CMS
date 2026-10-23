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

export interface FinanceProvider {
  readonly name: string;
  createInvoice(order: OrderPayload, idempotencyKey: string): Promise<ProviderResult>;
  voidInvoice(invoiceRef: string, reason: string, idempotencyKey: string): Promise<ProviderResult>;
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
