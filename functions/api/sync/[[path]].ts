/**
 * CINTEXA Nexus — central synchronization engine (/api/sync/*)
 * Event outbox + handlers. Zero third-party API keys.
 * Isolate memory by default; schema for D1 in migrations/d1/0003_nexus_sync.sql
 */

type SyncEvent = {
  id: string;
  eventType: string;
  sourceModule: string;
  entityType: string;
  entityId: string;
  orgId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  status: "pending" | "processed" | "failed" | "dead";
  attempts: number;
  lastError?: string;
  createdAt: string;
  processedAt?: string;
  links: { targetModule: string; targetEntityType?: string; targetEntityId?: string }[];
};

type Store = {
  events: SyncEvent[];
  /** Idempotency → event id */
  seen: Record<string, string>;
  /** Derived diary entry ids from sync (prevent duplicates) */
  diaryByEntity: Record<string, string>;
};

let memory: Store = { events: [], seen: {}, diaryByEntity: {} };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function readJson(request: Request): Promise<any> {
  try {
    const t = await request.text();
    return t?.trim() ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

/** Module dependency registry — what each event fans out to */
const ROUTING: Record<string, string[]> = {
  CUSTOMER_CREATED: ["business-diary", "dashboard"],
  CUSTOMER_UPDATED: ["dashboard"],
  LEAD_CREATED: ["business-diary", "dashboard"],
  SALES_ORDER_CREATED: ["business-diary", "financial-intelligence", "dashboard"],
  SALES_ORDER_CONFIRMED: ["business-diary", "financial-intelligence", "dashboard"],
  SALES_ORDER_CANCELLED: ["business-diary", "financial-intelligence", "dashboard"],
  INVOICE_CREATED: ["business-diary", "financial-intelligence", "dashboard"],
  PAYMENT_RECEIVED: ["business-diary", "financial-intelligence", "dashboard"],
  PAYMENT_REVERSED: ["business-diary", "financial-intelligence", "dashboard"],
  EXPENSE_RECORDED: ["business-diary", "financial-intelligence", "dashboard"],
  DIARY_ENTRY_CREATED: ["dashboard"],
  FI_ENTRY_POSTED: ["dashboard"],
  REVENUE_RECORDED: ["financial-intelligence", "dashboard"],
};

const MODULES = [
  { id: "sales", name: "Sales Management", publishes: ["LEAD_CREATED", "SALES_ORDER_CREATED", "SALES_ORDER_CONFIRMED", "PAYMENT_RECEIVED"], consumes: [] },
  { id: "financial-intelligence", name: "Financial Intelligence", publishes: ["FI_ENTRY_POSTED"], consumes: ["SALES_ORDER_CONFIRMED", "PAYMENT_RECEIVED", "EXPENSE_RECORDED", "INVOICE_CREATED"] },
  { id: "business-diary", name: "Business Diary", publishes: ["DIARY_ENTRY_CREATED"], consumes: ["CUSTOMER_CREATED", "LEAD_CREATED", "SALES_ORDER_CREATED", "PAYMENT_RECEIVED", "EXPENSE_RECORDED"] },
  { id: "dashboard", name: "Main Dashboard", publishes: [], consumes: ["*"] },
  { id: "cms", name: "Content / Sites", publishes: [], consumes: [] },
];

function processEvent(ev: SyncEvent, origin: string): void {
  const targets = ROUTING[ev.eventType] || ["dashboard"];
  for (const target of targets) {
    if (target === "business-diary") {
      const key = `${ev.entityType}:${ev.entityId}:${ev.eventType}`;
      if (memory.diaryByEntity[key]) {
        ev.links.push({ targetModule: "business-diary", targetEntityId: memory.diaryByEntity[key], targetEntityType: "diary_entry" });
        continue;
      }
      // Best-effort: call diary API on same origin to create linked entry
      // (processed synchronously via internal memory bridge when same isolate is not shared —
      //  we record intent + link metadata; client can also call diary)
      const diaryId = crypto.randomUUID();
      memory.diaryByEntity[key] = diaryId;
      ev.links.push({
        targetModule: "business-diary",
        targetEntityType: "diary_entry",
        targetEntityId: diaryId,
      });
      // Fire-and-forget diary create if possible
      try {
        const title = String(ev.payload.title || `${ev.eventType} · ${ev.entityType} ${ev.entityId}`);
        const body = {
          title: title.slice(0, 300),
          category: "General Business",
          activityDate: String(ev.payload.activityDate || new Date().toISOString().slice(0, 10)),
          description: `Auto-synced from ${ev.sourceModule}: ${ev.eventType}. Entity ${ev.entityType}/${ev.entityId}.`,
          tags: ["auto-sync", ev.sourceModule, ev.eventType],
          successStatus: ev.payload.successStatus,
        };
        // Store pending diary payload on event for client/relay
        (ev.payload as any)._diaryDraft = body;
        (ev.payload as any)._diaryId = diaryId;
      } catch (e) {
        /* keep processing */
      }
    }
    if (target === "financial-intelligence") {
      ev.links.push({ targetModule: "financial-intelligence", targetEntityType: "sync_notice", targetEntityId: ev.id });
    }
    if (target === "dashboard") {
      ev.links.push({ targetModule: "dashboard", targetEntityType: "invalidate", targetEntityId: "*" });
    }
  }
  ev.status = "processed";
  ev.processedAt = new Date().toISOString();
  ev.attempts += 1;
}

type Env = Record<string, unknown>;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");
  const origin = new URL(request.url).origin;

  if (path === "meta" || path === "") {
    return json({
      name: "CINTEXA Nexus Sync Engine",
      version: "1.0.0",
      eventTypes: Object.keys(ROUTING),
      modules: MODULES,
      engine: "nexus-sync-v1",
    });
  }

  if (path === "registry") return json({ modules: MODULES, routing: ROUTING });

  if (path === "events" && request.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 50)));
    const items = memory.events.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return json({ items, total: memory.events.length });
  }

  if (path === "events" && request.method === "POST") {
    const body = await readJson(request);
    const eventType = String(body.eventType || "");
    const sourceModule = String(body.sourceModule || "unknown");
    const entityType = String(body.entityType || "record");
    const entityId = String(body.entityId || crypto.randomUUID());
    const idempotencyKey = String(body.idempotencyKey || `${eventType}:${entityType}:${entityId}:${body.version || "1"}`);

    if (!eventType) return json({ error: "eventType required" }, 400);

    if (memory.seen[idempotencyKey]) {
      const existing = memory.events.find((e) => e.id === memory.seen[idempotencyKey]);
      return json({ event: existing, duplicate: true }, 200);
    }

    const ev: SyncEvent = {
      id: crypto.randomUUID(),
      eventType,
      sourceModule,
      entityType,
      entityId,
      orgId: String(body.orgId || "default"),
      payload: typeof body.payload === "object" && body.payload ? body.payload : {},
      idempotencyKey,
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      links: [],
    };
    memory.seen[idempotencyKey] = ev.id;
    try {
      processEvent(ev, origin);
    } catch (e: any) {
      ev.status = "failed";
      ev.lastError = String(e?.message || e);
      ev.attempts += 1;
    }
    memory.events.push(ev);

    // If diary draft present, POST to /api/diary/entries (same deployment)
    const draft = (ev.payload as any)._diaryDraft;
    if (draft && ev.status === "processed") {
      try {
        await fetch(`${origin}/api/diary/entries`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
      } catch {
        // Diary may be on separate isolate; client invalidation still applies
      }
    }

    return json({ event: ev, duplicate: false }, 201);
  }

  if (path === "status") {
    const pending = memory.events.filter((e) => e.status === "pending").length;
    const failed = memory.events.filter((e) => e.status === "failed").length;
    const processed = memory.events.filter((e) => e.status === "processed").length;
    return json({
      pending,
      failed,
      processed,
      total: memory.events.length,
      healthy: failed === 0,
    });
  }

  if (path === "retry" && request.method === "POST") {
    const body = await readJson(request);
    const id = String(body.id || "");
    const ev = memory.events.find((e) => e.id === id);
    if (!ev) return json({ error: "Not found" }, 404);
    ev.status = "pending";
    ev.links = [];
    try {
      processEvent(ev, origin);
    } catch (e: any) {
      ev.status = "failed";
      ev.lastError = String(e?.message || e);
    }
    return json({ event: ev });
  }

  if (path === "seed-demo" && request.method === "POST") {
    const samples = [
      { eventType: "LEAD_CREATED", sourceModule: "sales", entityType: "lead", entityId: "demo-lead-1", payload: { title: "Demo lead — Accra logistics" } },
      { eventType: "SALES_ORDER_CONFIRMED", sourceModule: "sales", entityType: "order", entityId: "demo-order-1", payload: { title: "Demo order confirmed", amount: 1200 } },
      { eventType: "PAYMENT_RECEIVED", sourceModule: "sales", entityType: "payment", entityId: "demo-pay-1", payload: { title: "Partial payment received", amount: 500 } },
    ];
    const created = [];
    for (const s of samples) {
      const idempotencyKey = `demo:${s.eventType}:${s.entityId}`;
      if (memory.seen[idempotencyKey]) continue;
      const ev: SyncEvent = {
        id: crypto.randomUUID(),
        ...s,
        orgId: "default",
        payload: s.payload,
        idempotencyKey,
        status: "pending",
        attempts: 0,
        createdAt: new Date().toISOString(),
        links: [],
      };
      memory.seen[idempotencyKey] = ev.id;
      processEvent(ev, origin);
      memory.events.push(ev);
      created.push(ev.id);
    }
    return json({ ok: true, created });
  }

  return json({ error: "Not found", path }, 404);
};
