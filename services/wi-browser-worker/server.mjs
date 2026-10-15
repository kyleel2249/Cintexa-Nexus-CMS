import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { checkUrl } from "./guard.mjs";
import { inspectPage } from "./inspect.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.WI_BROWSER_WORKER_TOKEN ?? "";
const MAX_CONCURRENT = Number(process.env.WI_WORKER_MAX_CONCURRENT ?? 2);
const VERSION = "1.0.0";
const ALLOW_LOOPBACK = process.env.NODE_ENV === "test" && process.env.WI_WORKER_ALLOW_LOOPBACK === "1";

let browser = null;
let active = 0;

async function getBrowser() {
  if (browser?.isConnected()) return browser;
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--host-resolver-rules=MAP localhost ~NOTFOUND"] });
  return browser;
}

function authorised(req) {
  if (!TOKEN) return process.env.NODE_ENV === "test";
  const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

export const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      if (!authorised(req)) return send(res, 401, { error: "unauthorised" });
      await getBrowser();
      return send(res, 200, { ok: true, version: VERSION, active });
    }
    if (req.method === "POST" && req.url === "/v1/inspect") {
      if (!authorised(req)) return send(res, 401, { error: "unauthorised" });
      if (active >= MAX_CONCURRENT) return send(res, 429, { error: "worker busy" });
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) return send(res, 413, { error: "body too large" }); }
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const verdict = await checkUrl(String(body.url ?? ""), { allowLoopbackForTests: ALLOW_LOOPBACK });
      if (!verdict.ok) return send(res, 422, { error: `Target refused: ${verdict.reason}` });
      const devices = Array.isArray(body.devices) ? body.devices.filter((d) => d === "mobile" || d === "desktop") : ["mobile"];
      active++;
      try {
        const b = await getBrowser();
        const results = await Promise.race([inspectPage(b, body.url, devices, { allowLoopbackForTests: ALLOW_LOOPBACK }), new Promise((_, rej) => setTimeout(() => rej(new Error("inspection timed out")), 100_000))]);
        return send(res, 200, { results, version: VERSION });
      } finally { active--; }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e.message ?? e).slice(0, 300) });
  }
});

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  server.listen(PORT, process.env.HOST ?? "0.0.0.0", () => console.log(`wi-browser-worker ${VERSION} listening on ${PORT}`));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { server.close(); await browser?.close().catch(() => undefined); process.exit(0); });
}
