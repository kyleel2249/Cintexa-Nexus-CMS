import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind Cloudflare / a reverse proxy: needed for correct client IPs (allow-list, rate limits).
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Media is uploaded as base64 data URLs, so the default 100kb JSON limit made uploads fail with 413.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

// Keep API failures machine-readable. Without this handler, an async route
// failure can produce an empty/HTML response that causes the browser client
// to fail with "Unexpected end of JSON input".
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled API error");

  if (res.headersSent) return;

  // Body-parser and similar middleware attach a safe 4xx status. Everything else is an internal
  // fault whose message (SQL text, paths, stack hints) must not reach the client in production.
  const status = Number((err as { status?: number; statusCode?: number } | null)?.status ?? (err as { statusCode?: number } | null)?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ error: err instanceof Error ? err.message : "Bad request" });
    return;
  }
  const message = process.env.NODE_ENV === "production" ? "Internal server error" : err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

export default app;
