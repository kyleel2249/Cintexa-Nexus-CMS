import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";

export interface Fixture { server: http.Server; port: number; hits: string[]; close: () => Promise<void> }

/** A tiny local website used by the SSRF and engine tests. Routes are keyed by path. */
export function startSite(routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>, port = 8080): Promise<Fixture> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const path = (req.url ?? "/").split("?")[0];
    (routes[path] ?? routes["*"] ?? ((_q, r) => { r.statusCode = 404; r.setHeader("content-type", "text/html"); r.end("<html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>"); }))(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, hits, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

export const html = (body: string, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${body}</body></html>`;
export const send = (res: http.ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) => { res.writeHead(status, { "content-type": type, ...extra }); res.end(body); };
export const gzipBomb = (bytes: number) => zlib.gzipSync(Buffer.alloc(bytes, 0x61));
