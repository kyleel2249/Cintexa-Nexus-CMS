/**
 * CINTEXA Nexus - central synchronization engine (/api/sync/*)
 *
 * Persistent transactional outbox on Cloudflare D1 (NEXUS_DB, else FIN_DB). Zero third-party API keys.
 *
 *  - Idempotent enqueue: one row per idempotency key; a repeat returns the original event and never re-applies its effects.
 *  - Stale-version conflict detection: an event older than one already recorded for the same entity+type is rejected (409).
 *  - Lease-based claiming: an event is processed by one worker at a time; a crashed worker's lease expires and it is retried.
 *  - Effects are applied in ONE atomic D1 batch together with the status update, so an event is never half-applied.
 *  - Deterministic target ids (diary entries) make even a double application harmless.
 *  - Retry with exponential backoff, then dead-letter (status "dead") with manual /retry recovery. Every attempt is logged.
 *  - GET /changes?after=<seq> is a cheap cursor feed so open sessions can refresh without a manual reload.
 *
 * Without a D1 binding the write routes answer 503 (nothing is silently kept in memory).
 */

import { ensureNexusSchema, resolveDb, type NexusEnv } from "../../_lib/nexus-db.ts";
import {
  ROUTING, MODULES, enqueue, processEvent, drain, toEvent, loadEvent, loadLinks, str, parseJson,
  type EventRow,
} from "../../_lib/nexus-sync.ts";
import { recommendAll } from "../../_lib/nexus-recommend.ts";

// Re-exported so tests and other Functions can use the engine directly.
export { ROUTING, MODULES, enqueue, processEvent, drain };

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), { status, headers: HEADERS });
}

async function readJson(request: Request): Promise<any> {
  try {
    const t = await request.text();
    return t?.trim() ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export const onRequest: PagesFunction<NexusEnv> = async (context) => {
  const { request, params, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const raw = params.path;
  const path = (Array.isArray(raw) ? raw : raw ? [raw] : []).join("/");
  const url = new URL(request.url);
  const db = resolveDb(env);

  if (path === "meta" || path === "") {
    return json({
      name: "CINTEXA Nexus Sync Engine",
      version: "2.0.0",
      engine: "nexus-sync-v2",
      persistent: Boolean(db),
      database: env?.NEXUS_DB ? "NEXUS_DB" : env?.FIN_DB ? "FIN_DB" : null,
      eventTypes: Object.keys(ROUTING),
      modules: MODULES,
    });
  }
  if (path === "registry") return json({ modules: MODULES, routing: ROUTING });

  if (!db) {
    return json(
      { error: "No D1 database is bound. Bind NEXUS_DB (or the existing FIN_DB) to this Pages project; the sync engine does not keep events in memory.", persistent: false },
      503,
    );
  }
  try {
    await ensureNexusSchema(db);

    if (path === "status" && request.method === "GET") {
      const { results } = await db.prepare("SELECT status, COUNT(*) AS n FROM nx_sync_events GROUP BY status").all<{ status: string; n: number }>();
      const c: Record<string, number> = { pending: 0, processing: 0, processed: 0, failed: 0, dead: 0 };
      for (const r of results) c[r.status] = r.n;
      const oldest = await db.prepare("SELECT MIN(created_at) AS t FROM nx_sync_events WHERE status IN ('pending','failed','processing')").first<{ t: string | null }>();
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      return json({ ...c, total, oldestUnprocessedAt: oldest?.t ?? null, healthy: c.failed + c.dead === 0, persistent: true });
    }

    // Activity per module per day (last 60 days) and link counts, for the Nexus Synchrony view.
    if (path === "activity" && request.method === "GET") {
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { results: pub } = await db
        .prepare("SELECT source_module AS module, substr(created_at,1,10) AS day, COUNT(*) AS n FROM nx_sync_events WHERE created_at >= ? GROUP BY source_module, substr(created_at,1,10)")
        .bind(since)
        .all<{ module: string; day: string; n: number }>();
      const { results: rec } = await db
        .prepare("SELECT l.target_module AS module, substr(l.created_at,1,10) AS day, COUNT(*) AS n FROM nx_sync_links l WHERE l.created_at >= ? GROUP BY l.target_module, substr(l.created_at,1,10)")
        .bind(since)
        .all<{ module: string; day: string; n: number }>();
      const { results: flows } = await db
        .prepare("SELECT e.source_module AS source, l.target_module AS target, COUNT(*) AS n FROM nx_sync_links l JOIN nx_sync_events e ON e.id = l.event_id GROUP BY e.source_module, l.target_module")
        .all<{ source: string; target: string; n: number }>();
      return json({ since, published: pub, received: rec, flows });
    }

    // Recommendations for recent records: one suggestion set per receiving tool (computed, never stored).
    if (path === "recommendations" && request.method === "GET") {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 15)));
      const target = url.searchParams.get("module");
      const { results } = await db.prepare("SELECT * FROM nx_sync_events ORDER BY created_at DESC LIMIT ?").bind(limit).all<EventRow>();
      const items = results.map((r) => {
        const payload = parseJson<Record<string, any>>(r.payload, {});
        const recs = recommendAll(r, payload).filter((x) => !target || x.target === target);
        return { eventId: r.id, eventType: r.event_type, sourceModule: r.source_module, entityType: r.entity_type, entityId: r.entity_id, title: payload.title || `${r.event_type}`, createdAt: r.created_at, recommendations: recs };
      });
      return json({ items });
    }

    if (path === "events" && request.method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      const where: string[] = [];
      const args: unknown[] = [];
      for (const [param, col] of [["status", "status"], ["entityType", "entity_type"], ["entityId", "entity_id"], ["sourceModule", "source_module"], ["eventType", "event_type"]] as const) {
        const v = url.searchParams.get(param);
        if (v) { where.push(`${col} = ?`); args.push(v); }
      }
      const { results } = await db
        .prepare(`SELECT * FROM nx_sync_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id LIMIT ?`)
        .bind(...args, limit)
        .all<EventRow>();
      const links = await loadLinks(db, results.map((r) => r.id));
      const total = await db.prepare(`SELECT COUNT(*) AS n FROM nx_sync_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).bind(...args).first<{ n: number }>();
      return json({ items: results.map((r) => toEvent(r, links.get(r.id) ?? [])), total: total?.n ?? 0 });
    }

    if (path.startsWith("events/") && request.method === "GET") {
      const ev = await loadEvent(db, path.split("/")[1]!);
      if (!ev) return json({ error: "Not found" }, 404);
      const links = await loadLinks(db, [ev.id]);
      const { results: log } = await db.prepare("SELECT attempt, outcome, detail, created_at FROM nx_sync_log WHERE event_id = ? ORDER BY attempt").bind(ev.id).all();
      return json({ event: toEvent(ev, links.get(ev.id) ?? []), log });
    }

    if (path === "events" && request.method === "POST") {
      const res = await enqueue(db, await readJson(request));
      if (!res.ok) return json({ error: res.error }, res.status);
      const processed = res.duplicate ? res.event : (await processEvent(db, res.event.id)) ?? res.event;
      const links = await loadLinks(db, [processed.id]);
      return json({ event: toEvent(processed, links.get(processed.id) ?? []), duplicate: res.duplicate, recommendations: res.duplicate ? [] : recommendAll(processed, parseJson<Record<string, any>>(processed.payload, {})) }, res.duplicate ? 200 : 201);
    }

    if (path === "process" && request.method === "POST") {
      const done = await drain(db, 50);
      return json({ processed: done.filter((e) => e.status === "processed").length, failed: done.filter((e) => e.status === "failed").length, dead: done.filter((e) => e.status === "dead").length });
    }

    if (path === "retry" && request.method === "POST") {
      const id = str((await readJson(request)).id, 64);
      const ev = await loadEvent(db, id);
      if (!ev) return json({ error: "Not found" }, 404);
      if (ev.status !== "failed" && ev.status !== "dead") return json({ error: `Only failed or dead events can be retried (this one is ${ev.status})` }, 409);
      await db.prepare("UPDATE nx_sync_events SET status='pending', attempts=0, next_attempt_at=NULL WHERE id=?").bind(id).run();
      const after = await processEvent(db, id);
      const links = await loadLinks(db, [id]);
      return json({ event: toEvent(after ?? ev, links.get(id) ?? []) });
    }

    if (path === "changes" && request.method === "GET") {
      const after = Math.max(0, Number(url.searchParams.get("after") || 0));
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const { results } = await db
        .prepare("SELECT rowid AS seq, id, event_type, source_module, entity_type, entity_id, status FROM nx_sync_events WHERE rowid > ? ORDER BY rowid LIMIT ?")
        .bind(after, limit)
        .all<{ seq: number; id: string; event_type: string; source_module: string; entity_type: string; entity_id: string; status: string }>();
      const cursor = results.length ? results[results.length - 1]!.seq : after;
      return json({
        cursor,
        items: results.map((r) => ({ seq: r.seq, id: r.id, eventType: r.event_type, sourceModule: r.source_module, entityType: r.entity_type, entityId: r.entity_id, status: r.status })),
      });
    }
  } catch (e: any) {
    return json({ error: "Sync engine error", detail: str(e?.message || e, 300) }, 500);
  }

  return json({ error: "Not found", path }, 404);
};
