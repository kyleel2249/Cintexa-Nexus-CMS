/** Connects the portable engine (@workspace/wi-engine) to the Node runtime: Postgres, pinned sockets, TLS probe, worker, webhooks. */
import os from "node:os";
import zlib from "node:zlib";
import { configureEngine, isEngineConfigured, type EngineRepo } from "@workspace/wi-engine";
import { browserWorkerConfigured, browserWorkerHealth, inspectWithBrowser } from "./browser-client";
import { runPageSpeed } from "./integrations";
import { notifyAuditFinished } from "./notify";
import { probeTls, resolvePublic, safeFetch } from "./safe-fetch";
import { loadWiSettings } from "./settings";
import * as store from "./store";

if (!isEngineConfigured()) {
  configureEngine({
    net: {
      safeFetch,
      resolvePublic,
      probeTls,
      gunzip: async (bytes, maxOutput) => new Uint8Array(zlib.gunzipSync(bytes, { maxOutputLength: maxOutput })),
    },
    repo: store as unknown as EngineRepo,
    settings: { load: loadWiSettings },
    browser: { health: browserWorkerHealth, inspect: inspectWithBrowser },
    pagespeed: { get configured() { return Boolean(process.env.PAGESPEED_API_KEY); }, run: runPageSpeed },
    notifier: { finished: notifyAuditFinished },
    runtime: {
      version: process.version,
      get location() { return `${os.hostname()} (${process.env.WI_REGION ?? "unspecified region"})`; },
      get browserWorkerConfigured() { return browserWorkerConfigured(); },
    },
  });
}
