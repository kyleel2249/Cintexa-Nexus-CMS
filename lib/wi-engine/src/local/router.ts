/** Minimal Express-compatible router so the shared route handlers run unchanged inside the browser. */
import type { Handler, ReqLike, ResLike, RouterLike } from "../routes";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Route { method: Method; parts: string[]; handler: Handler }

export interface LocalRequest {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  auth: ReqLike["auth"];
}
export interface LocalResponse { status: number; headers: Record<string, string>; body: string; contentType: string }

export class LocalRouter implements RouterLike {
  private readonly routes: Route[] = [];
  private add(method: Method, path: string, handler: Handler) { this.routes.push({ method, parts: path.split("/").filter(Boolean), handler }); }
  get(path: string, handler: Handler) { this.add("GET", path, handler); }
  post(path: string, handler: Handler) { this.add("POST", path, handler); }
  put(path: string, handler: Handler) { this.add("PUT", path, handler); }
  patch(path: string, handler: Handler) { this.add("PATCH", path, handler); }
  delete(path: string, handler: Handler) { this.add("DELETE", path, handler); }

  async handle(r: LocalRequest): Promise<LocalResponse> {
    const [pathOnly, rawQs = ""] = r.path.split("?");
    const parts = pathOnly!.split("/").filter(Boolean).map(decodeURIComponent);
    const query: Record<string, unknown> = { ...Object.fromEntries(new URLSearchParams(rawQs)), ...(r.query ?? {}) };
    const method = r.method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = route.parts[i]!;
        if (rp.startsWith(":")) params[rp.slice(1)] = parts[i]!;
        else if (rp !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      return this.run(route.handler, { auth: r.auth, params, query, body: r.body ?? {}, headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    }
    return { status: 404, headers: {}, body: JSON.stringify({ error: "Not found." }), contentType: "application/json" };
  }

  private async run(handler: Handler, req: ReqLike): Promise<LocalResponse> {
    return new Promise<LocalResponse>((resolve) => {
      const out: LocalResponse = { status: 200, headers: {}, body: "", contentType: "application/json" };
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(out); } };
      const res: ResLike = {
        status(code) { out.status = code; return res; },
        json(body) { out.contentType = "application/json"; out.body = JSON.stringify(body); finish(); return res; },
        end() { out.body = ""; finish(); return res; },
        setHeader(name, value) { out.headers[name.toLowerCase()] = value; return res; },
        type(t) { out.contentType = t.includes("/") ? t : t === "json" ? "application/json" : t === "csv" ? "text/csv" : `text/${t}`; return res; },
        send(body) { out.body = body; finish(); return res; },
      };
      Promise.resolve()
        .then(() => handler(req, res))
        .then(() => { if (!done) finish(); })
        .catch((err: unknown) => { out.status = 500; out.contentType = "application/json"; out.body = JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error." }); finish(); });
    });
  }
}
