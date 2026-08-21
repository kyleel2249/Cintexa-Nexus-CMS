import type { Request, Response, NextFunction } from "express";

type Entry = { expires: number; body: unknown; status: number };
const store = new Map<string, Entry>();
const MAX = 200;

export function memoryCache(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    const key = `${req.organizationId || "global"}:${req.originalUrl}`;
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) {
      res.setHeader("X-Cache", "HIT");
      return res.status(hit.status).json(hit.body);
    }
    const originalJson = res.json.bind(res);
    (res as any).json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (store.size >= MAX) {
          const first = store.keys().next().value;
          if (first) store.delete(first);
        }
        store.set(key, { expires: Date.now() + ttlMs, body, status: res.statusCode || 200 });
      }
      res.setHeader("X-Cache", "MISS");
      return originalJson(body);
    };
    next();
  };
}

export function clearCache(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of [...store.keys()]) {
    if (k.includes(prefix)) store.delete(k);
  }
}
