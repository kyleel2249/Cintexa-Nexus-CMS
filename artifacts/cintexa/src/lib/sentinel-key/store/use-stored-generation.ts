import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sk } from "./api";
import { getKey, initKeyring, useKeyring } from "./keyring";
import { seal } from "./crypto";
import { invalidateSk } from "./queries";
import { retryGeneration, runGeneration, type GenerationInput, type Outcome, type WorkflowDeps } from "./workflow";
import { recordGenerated, type GenKind } from "../session-store";
import type { CredentialType } from "@sentinel-engine/types";

export const defaultDeps: WorkflowDeps = { call: (m, p, o) => sk(m, p, o), getKey, newId: () => crypto.randomUUID(), seal };
const LAST_ALIAS_KEY = "sentinel-key.last-alias"; // an alias id is not a secret

export interface StoredGeneration {
  type: CredentialType;
  aliasId: string | null;
  setAliasId: (id: string | null) => void;
  keyPhase: ReturnType<typeof useKeyring>["phase"];
  /** null when generation is allowed; otherwise why it is blocked. */
  blocked: string | null;
  busy: boolean;
  outcome: Outcome | null;
  run: (make: GenerationInput["make"], settings: GenerationInput["settings"], itemCount?: number) => Promise<Outcome>;
  retry: () => Promise<void>;
  clear: () => void;
}

export function useStoredGeneration(type: CredentialType): StoredGeneration {
  const { phase } = useKeyring();
  const [aliasId, setAlias] = useState<string | null>(() => { try { return localStorage.getItem(LAST_ALIAS_KEY); } catch { return null; } });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { void initKeyring(); }, []);

  const setAliasId = useCallback((id: string | null) => { setAlias(id); try { if (id) localStorage.setItem(LAST_ALIAS_KEY, id); } catch { /* ignore */ } }, []);
  const blocked = useMemo(() => (phase === "loading" ? "Loading your vault…" : phase === "error" ? "Storage is unavailable. Nothing can be generated until it is back." : phase !== "unlocked" ? "Unlock your vault to generate." : !aliasId ? "Choose or create an alias first." : null), [phase, aliasId]);

  const run = useCallback<StoredGeneration["run"]>(async (make, settings, itemCount) => {
    if (inFlight.current) return outcome ?? { status: "failed", generated: false, error: "A generation is already running." };
    inFlight.current = true; setBusy(true);
    try {
      const o = await runGeneration(defaultDeps, { type, aliasId, settings, itemCount, make });
      setOutcome(o);
      if (o.generated) recordGenerated(type as GenKind, itemCount ?? 1);
      invalidateSk();
      return o;
    } finally { inFlight.current = false; setBusy(false); }
  }, [type, aliasId, outcome]);

  const retry = useCallback(async () => {
    if (!outcome || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { setOutcome(await retryGeneration(defaultDeps, outcome)); invalidateSk(); } finally { inFlight.current = false; setBusy(false); }
  }, [outcome]);

  return { type, aliasId, setAliasId, keyPhase: phase, blocked, busy, outcome, run, retry, clear: () => setOutcome(null) };
}
