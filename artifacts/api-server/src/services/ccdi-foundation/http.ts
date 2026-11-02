/**
 * CCDI foundation — small HTTP helpers: typed errors, validators, pagination,
 * and an in-memory sliding-window rate limiter.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "../../lib/logger";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function uuidParam(v: unknown, label = "id"): string {
  if (!isUuid(v)) throw new HttpError(400, `${label} must be a valid UUID`);
  return v.toLowerCase();
}

export function str(
  v: unknown,
  label: string,
  opts: { min?: number; max?: number; re?: RegExp; optional?: boolean } = {},
): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    throw new HttpError(400, `${label} is required`);
  }
  if (typeof v !== "string") throw new HttpError(400, `${label} must be a string`);
  const s = v.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 500;
  if (s.length < min || s.length > max) throw new HttpError(400, `${label} must be ${min}-${max} characters`);
  if (opts.re && !opts.re.test(s)) throw new HttpError(400, `${label} has an invalid format`);
  return s;
}

export function reqStr(v: unknown, label: string, opts: Parameters<typeof str>[2] = {}): string {
  return str(v, label, { ...opts, optional: false }) as string;
}

export function oneOf<T extends string>(v: unknown, label: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new HttpError(400, `${label} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

export function obj(v: unknown, label: string, maxBytes = 16_384): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, `${label} must be an object`);
  if (JSON.stringify(v).length > maxBytes) throw new HttpError(413, `${label} is too large`);
  return v as Record<string, unknown>;
}

export function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function page(req: Request): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
  return { limit, offset };
}

/** Map low-level database errors to safe client responses. Never leaks SQL text. */
function mapError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const code = (err as { code?: string } | null)?.code;
  if (code === "23505") return new HttpError(409, "A record with those values already exists");
  if (code === "23503") return new HttpError(409, "The record references something that does not exist or is still in use");
  if (code === "23514" || code === "22P02" || code === "22023") return new HttpError(400, "One or more values are invalid");
  if (code === "42P01") return new HttpError(503, "CCDI foundation tables are not available yet");
  return new HttpError(500, "Internal error");
}

export function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      const mapped = mapError(err);
      const correlationId = req.ccdi?.correlationId;
      if (mapped.status >= 500) logger.error({ err, correlationId, path: req.path }, "ccdi.v1 request failed");
      if (res.headersSent) return next(err);
      res.status(mapped.status).json({ error: mapped.message, ...(mapped.code ? { code: mapped.code } : {}), correlationId });
    });
  };
}

/** Sliding-window limiter keyed by caller IP + bucket. Per process; documented limitation. */
const hits = new Map<string, number[]>();
let lastSweep = Date.now();

export function rateLimit(bucket: string, max: number, windowMs = 60_000): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > 5 * 60_000) {
      lastSweep = now;
      for (const [k, v] of hits) if (!v.some((t) => now - t < 10 * 60_000)) hits.delete(k);
    }
    const key = `${bucket}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

export function limitBody(maxBytes: number): RequestHandler {
  return (req, res, next) => {
    const len = Number(req.headers["content-length"] ?? 0);
    if (len > maxBytes) {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    next();
  };
}
