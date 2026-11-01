/**
 * CINTEXA CCDI — Phase 22 simple fixed-window rate limiter (in-memory).
 * Suitable for single-node / low-cardinality protection. Not a distributed limiter.
 */
import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}, 60_000).unref?.();

export function ccdiRateLimit(opts: {
  windowMs?: number;
  max?: number;
  keyFn?: (req: Request) => string;
}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 60;
  const keyFn =
    opts.keyFn ??
    ((req: Request) => {
      const sub = (req as any).auth?.sub ?? "anon";
      return `${req.method}:${req.path}:${sub}`;
    });

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      });
      return;
    }
    next();
  };
}
