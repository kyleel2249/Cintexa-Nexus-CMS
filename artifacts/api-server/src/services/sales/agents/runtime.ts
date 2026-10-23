/**
 * Agent runtime: the only place an agent run happens.
 *
 *  1. load the agent's stored configuration (status, level, model, thresholds) - code owns tools/permissions
 *  2. run the deterministic analyzer (read-only queries) under a timeout
 *  3. optionally ask an AI model to add a plain-language narrative; output is validated and stored as inert text
 *  4. persist findings as recommendations (de-duplicated, auto-resolved when the condition clears)
 *  5. level 2: prepare approval requests; level 3: execute only policy-allowed internal actions
 *  6. record task, execution log, audit event. Failures are recorded, never hidden, and never corrupt business data.
 */
import { randomUUID } from "../core/portable";
import type { Actor, Db } from "../core/types";
import type { Deps } from "../core/router";
import { loadSettings } from "../core/settings";
import { businessDate } from "../core/time";
import { audit } from "../core/audit";
import { conflict, notFound } from "../core/errors";
import { AGENTS, AGENT_BY_KEY } from "./catalog";
import { priorityOf, type AgentDef, type AnalyzerCtx, type Finding, type Level } from "./types";
import { requestAction, executeApproval, getPolicy } from "./approvals";
import { seedPolicies } from "./policy-seed";
import { AGENT_SYSTEM_PROMPT, NarrativeSchema, PROMPT_VERSION, callModelChain, parseModelJson, sanitizeNarrative, tierModel } from "./llm";

export interface AgentRow {
  key: string; name: string; purpose: string; version: string; status: "active" | "paused" | "disabled"; level: Level; max_level: Level; model_tier: "economy" | "standard" | "reasoning";
  model: string | null; fallback_model: string | null; use_ai: boolean; schedule_minutes: number | null; next_run_at: string | null; thresholds: Record<string, number>; tools: string[]; permissions: string[];
  current_task_id: number | null; last_activity_at: string | null; last_success_at: string | null; updated_at: string;
}

export const agentActor = (key: string): Pick<Actor, "userSub" | "label"> => ({ userSub: `agent:${key}`, label: `agent:${key}` });
const ANALYSIS_TIMEOUT_MS = 30_000;
const MAX_FINDINGS = 200;

export async function ensureAgents(db: Pick<Db, "query">): Promise<void> {
  await seedPolicies(db);
  const have = new Map((await db.query<{ key: string; version: string }>("SELECT key, version FROM sales_agents")).rows.map((r) => [r.key, r.version]));
  for (const d of AGENTS) {
    if (have.get(d.key) === d.version) continue;
    await db.query(
      `INSERT INTO sales_agents (key, name, purpose, version, status, level, max_level, model_tier, schedule_minutes, thresholds, tools, permissions)
       VALUES ($1,$2,$3,$4,'paused',$5,$6,$7,$8,$9::text::jsonb,$10::text::jsonb,$11::text::jsonb)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, purpose = EXCLUDED.purpose, version = EXCLUDED.version, max_level = EXCLUDED.max_level,
         tools = EXCLUDED.tools, permissions = EXCLUDED.permissions, level = LEAST(sales_agents.level, EXCLUDED.max_level), updated_at = now()`,
      [d.key, d.name, d.purpose, d.version, d.defaultLevel, d.maxLevel, d.tier, d.scheduleMinutes, JSON.stringify(d.thresholds), JSON.stringify(d.tools), JSON.stringify(d.reads)],
    );
  }
}

export async function loadAgent(db: Pick<Db, "query">, key: string): Promise<AgentRow> {
  await ensureAgents(db);
  const r = (await db.query<AgentRow>("SELECT * FROM sales_agents WHERE key = $1", [key])).rows[0];
  if (!r || !AGENT_BY_KEY.has(key)) throw notFound("Agent");
  return r;
}

function sanitize(f: Finding): Finding | null {
  if (!f || typeof f.title !== "string" || typeof f.whatDetected !== "string" || typeof f.dedupeKey !== "string") return null;
  const cut = (s: string | undefined, n: number) => (s === undefined ? undefined : String(s).slice(0, n));
  return {
    ...f, title: cut(f.title, 200)!, whatDetected: cut(f.whatDetected, 1200)!, whyItMatters: cut(f.whyItMatters, 600), action: cut(f.action, 600), expectedOutcome: cut(f.expectedOutcome, 400),
    dedupeKey: f.dedupeKey.slice(0, 200), evidence: (Array.isArray(f.evidence) ? f.evidence : []).slice(0, 14).map((e) => ({ type: String(e.type).slice(0, 40), label: String(e.label).slice(0, 200), value: e.value === null || e.value === undefined ? null : (typeof e.value === "number" ? e.value : String(e.value).slice(0, 300)), ...(e.id !== undefined ? { id: e.id } : {}) })),
  };
}

export interface RunOptions {
  trigger: "manual" | "schedule" | "event" | "orchestrator";
  kind?: "analysis" | "diagnostic" | "test" | "orchestration" | "event";
  by: Pick<Actor, "userSub" | "label">;
  focus?: { entityType: string; entityId: number };
  parentTaskId?: number;
  idempotencyKey?: string;
  dryRun?: boolean;
  limit?: number;
}
export interface RunResult {
  taskId: number | null; executionId: number | null; status: "completed" | "failed" | "skipped"; reason?: string; findings: number; created: number; updated: number; resolved: number;
  proposals: { prepared: number; autoApproved: number; executed: number; failed: number }; ai: { status: string; model?: string; tokens?: number; costUsd?: number }; error?: string; preview?: Array<Finding & { priority: number }>;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms); })]); } finally { if (t) clearTimeout(t); }
}

export async function runAgent(db: Db, deps: Deps, key: string, opts: RunOptions): Promise<RunResult> {
  const def = AGENT_BY_KEY.get(key);
  if (!def) throw notFound("Agent");
  const agent = await loadAgent(db, key);
  const kind = opts.kind ?? (opts.trigger === "event" ? "event" : "analysis");
  const dry = Boolean(opts.dryRun) || kind === "test" || kind === "diagnostic";
  if (agent.status === "disabled") throw conflict("This agent is disabled. Enable it first.", "agent_disabled");
  if (!dry && agent.status === "paused") throw conflict("This agent is paused. Resume it first.", "agent_paused");
  const now = deps.now();
  const empty: RunResult = { taskId: null, executionId: null, status: "skipped", findings: 0, created: 0, updated: 0, resolved: 0, proposals: { prepared: 0, autoApproved: 0, executed: 0, failed: 0 }, ai: { status: "not_used" } };

  const idemKey = opts.idempotencyKey ?? `${key}:${opts.trigger}:${randomUUID()}`;
  let task = (await db.query<{ id: number }>(
    `INSERT INTO sales_agent_tasks (agent_key, kind, trigger, status, priority, entity_type, entity_id, parent_task_id, input, idempotency_key, attempts, started_at, created_by)
     VALUES ($1,$2,$3,'running',$4,$5,$6,$7,$8::text::jsonb,$9,1,now(),$10) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [key, kind, opts.trigger, 50, opts.focus?.entityType ?? null, opts.focus?.entityId ?? null, opts.parentTaskId ?? null, JSON.stringify({ focus: opts.focus ?? null, dryRun: dry }), idemKey, opts.by.label])).rows[0];
  // A task that FAILED may be retried under the same idempotency key (bounded by the event bus); a finished or running one is never repeated.
  if (!task) task = (await db.query<{ id: number }>("UPDATE sales_agent_tasks SET status = 'running', error = NULL, attempts = attempts + 1, started_at = now(), finished_at = NULL WHERE idempotency_key = $1 AND status = 'failed' RETURNING id", [idemKey])).rows[0];
  if (!task) return { ...empty, reason: "duplicate task (idempotency key already processed)" };

  if (!dry) {
    const claim = await db.query("UPDATE sales_agents SET current_task_id = $2, last_activity_at = now() WHERE key = $1 AND (current_task_id IS NULL OR last_activity_at < now() - interval '10 minutes') RETURNING key", [key, task.id]);
    if (!claim.rows[0]) {
      await db.query("UPDATE sales_agent_tasks SET status = 'cancelled', error = 'Agent already running', finished_at = now() WHERE id = $1", [task.id]);
      return { ...empty, taskId: task.id, reason: "agent already running" };
    }
  }
  const level = (dry ? 1 : agent.level) as Level;
  const exec = (await db.query<{ id: number }>("INSERT INTO sales_agent_executions (task_id, agent_key, status, level, prompt_version) VALUES ($1,$2,'running',$3,$4) RETURNING id", [task.id, key, level, PROMPT_VERSION])).rows[0]!;
  const log: Array<{ at: string; step: string; detail?: unknown }> = [];
  const step = (s: string, detail?: unknown) => log.push({ at: new Date().toISOString(), step: s, detail });
  step("start", { trigger: opts.trigger, kind, level, dry, focus: opts.focus ?? null });
  const result: RunResult = { ...empty, taskId: task.id, executionId: exec.id, status: "completed" };
  let aiRow: { status: string; provider?: string; model?: string; pt?: number; ct?: number; cost?: number; latency?: number } = { status: "not_used" };
  const started = Date.now();
  try {
    const settings = await loadSettings(db, now.getTime());
    const ctx: AnalyzerCtx = {
      q: db, now, today: businessDate(now, settings.business.timezone), settings, thresholds: { ...def.thresholds, ...(agent.thresholds ?? {}) }, focus: opts.focus, limit: opts.limit ?? 100,
      integrations: { ai: Boolean(deps.integrations.ai), email: Boolean(deps.integrations.email), whatsapp: Boolean(deps.integrations.whatsapp), inventory: Boolean(deps.integrations.inventory), finance: Boolean(deps.integrations.finance) },
    };
    let findings: Finding[] = [];
    if (def.analyze) findings = await withTimeout(def.analyze(ctx), ANALYSIS_TIMEOUT_MS, "Analysis");
    findings = findings.map(sanitize).filter((f): f is Finding => f !== null).slice(0, MAX_FINDINGS);
    step("analysis", { findings: findings.length });
    result.findings = findings.length;
    // Findings a person recently dismissed (14 days) or that were actioned/verified (7 days) are not re-raised, nor narrated.
    const skip = dry ? new Set<string>() : new Set((await db.query<{ dedupe_key: string }>(`SELECT dedupe_key FROM sales_agent_recommendations WHERE agent_key = $1 AND ((status = 'dismissed' AND decided_at > $2::timestamptz - interval '14 days') OR (status IN ('actioned','verified') AND updated_at > $2::timestamptz - interval '7 days'))`, [key, now.toISOString()])).rows.map((r) => r.dedupe_key));
    const ranked = findings.map((f) => ({ ...f, priority: priorityOf(f) })).filter((f) => !skip.has(f.dedupeKey)).sort((a, b) => b.priority - a.priority);

    // optional AI narrative (never alters findings)
    const narratives = new Map<string, string>();
    if (!dry && agent.use_ai && ranked.length) {
      const out = await narrate(db, deps, agent, def, ranked.slice(0, 8), settings, now);
      aiRow = out.row;
      for (const [k, n] of out.narratives) narratives.set(k, n);
      step("ai", { status: out.row.status, model: out.row.model });
    }
    result.ai = { status: aiRow.status, model: aiRow.model, tokens: (aiRow.pt ?? 0) + (aiRow.ct ?? 0) || undefined, costUsd: aiRow.cost };

    if (dry) {
      result.preview = ranked.slice(0, 50);
    } else {
      const toExecute: number[] = [];
      await db.tx(async (q) => {
        const kept: string[] = [];
        for (const f of ranked) {
          if (skip.has(f.dedupeKey)) continue;
          kept.push(f.dedupeKey);
          const due = f.dueInDays !== undefined ? new Date(now.getTime() + f.dueInDays * 86400000).toISOString().slice(0, 10) : null;
          const r = (await q.query<{ id: number; inserted: boolean }>(
            `INSERT INTO sales_agent_recommendations (agent_key, task_id, stage, severity, category, impact_amount, priority_score, title, what_detected, why_it_matters, recommended_action, expected_outcome, owner_member_id, due_on, entity_type, entity_id, evidence, assumptions, dedupe_key, ai_narrative)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::text::jsonb,$18::text::jsonb,$19,$20)
             ON CONFLICT (dedupe_key) WHERE status IN ('open','accepted') DO UPDATE SET task_id = EXCLUDED.task_id, severity = EXCLUDED.severity, priority_score = EXCLUDED.priority_score, what_detected = EXCLUDED.what_detected, why_it_matters = EXCLUDED.why_it_matters,
               recommended_action = EXCLUDED.recommended_action, evidence = EXCLUDED.evidence, assumptions = EXCLUDED.assumptions, impact_amount = EXCLUDED.impact_amount, owner_member_id = EXCLUDED.owner_member_id,
               ai_narrative = COALESCE(EXCLUDED.ai_narrative, sales_agent_recommendations.ai_narrative), updated_at = now()
             RETURNING id, (xmax = 0) AS inserted`,
            [key, task.id, f.stage, f.severity, f.category, f.impactAmount ?? null, f.priority, f.title, f.whatDetected, f.whyItMatters ?? null, f.action ?? null, f.expectedOutcome ?? null, f.ownerMemberId ?? null, due, f.entityType ?? null, f.entityId ?? null, JSON.stringify(f.evidence), f.assumptions ? JSON.stringify(f.assumptions) : null, f.dedupeKey, narratives.get(f.dedupeKey) ?? null])).rows[0]!;
          if (r.inserted) result.created++; else result.updated++;
          if (f.proposal && level >= 2) {
            const { approval, created, policy } = await requestAction(q, { proposal: f.proposal, agentKey: key, recommendationId: r.id, now });
            if (created && approval.status === "PENDING") result.proposals.prepared++;
            if (created && approval.status === "APPROVED") { result.proposals.autoApproved++; if (level === 3 && policy.auto_executable && policy.has_executor && !policy.always_protected) toExecute.push(approval.id); }
          }
        }
        // conditions that no longer hold are closed, not left open forever
        const scope = opts.focus ? " AND entity_type = $3 AND entity_id = $4" : "";
        const params: unknown[] = [key, kept.length ? kept : ["__none__"], ...(opts.focus ? [opts.focus.entityType, opts.focus.entityId] : [])];
        const closed = await q.query(`UPDATE sales_agent_recommendations SET status = 'expired', outcome = '{"note":"Condition no longer detected on the latest run"}'::jsonb, updated_at = now() WHERE agent_key = $1 AND status = 'open' AND dedupe_key <> ALL($2::text[])${scope} RETURNING id`, params);
        result.resolved = closed.rowCount;
        await audit(q, agentActor(key), { action: "agent.run", entityType: "agent", entityId: key, summary: `${def.name}: ${findings.length} findings (${result.created} new, ${result.updated} updated, ${result.resolved} cleared), ${result.proposals.prepared} approvals requested${aiRow.status === "ok" ? `, AI narrative via ${aiRow.model}` : ""}` });
      });
      for (const id of toExecute) {
        const done = await executeApproval(db, deps, id, agentActor(key), "automatic").catch((err) => { deps.log.warn({ err, id }, "agent auto-execution refused"); return null; });
        if (done?.status === "COMPLETED") result.proposals.executed++; else result.proposals.failed++;
      }
      step("persist", { created: result.created, updated: result.updated, resolved: result.resolved, proposals: result.proposals });
    }
    const latency = Date.now() - started;
    await db.query("UPDATE sales_agent_executions SET status = 'success', ai_status = $2, provider = $3, model = $4, prompt_tokens = $5, completion_tokens = $6, cost_usd = $7, latency_ms = $8, findings_count = $9, actions_prepared = $10, actions_executed = $11, log = $12::text::jsonb, finished_at = now() WHERE id = $1",
      [exec.id, aiRow.status, aiRow.provider ?? null, aiRow.model ?? null, aiRow.pt ?? null, aiRow.ct ?? null, aiRow.cost ?? null, latency, findings.length, result.proposals.prepared + result.proposals.autoApproved, result.proposals.executed, JSON.stringify(log)]);
    await db.query("UPDATE sales_agent_tasks SET status = $2, result = $3::text::jsonb, finished_at = now() WHERE id = $1", [task.id, result.proposals.prepared > 0 && !dry ? "awaiting_approval" : "completed", JSON.stringify({ findings: result.findings, created: result.created, updated: result.updated, resolved: result.resolved, proposals: result.proposals, ai: result.ai })]);
    if (!dry) await db.query("UPDATE sales_agents SET current_task_id = NULL, last_success_at = now(), last_activity_at = now(), next_run_at = CASE WHEN schedule_minutes IS NULL THEN NULL ELSE now() + (schedule_minutes || ' minutes')::interval END WHERE key = $1", [key]);
    return result;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : "Agent run failed").slice(0, 500);
    deps.log.error({ err, agent: key }, "Agent run failed");
    step("error", msg);
    await db.query("UPDATE sales_agent_executions SET status = 'failed', error = $2, latency_ms = $3, log = $4::text::jsonb, finished_at = now() WHERE id = $1", [exec.id, msg, Date.now() - started, JSON.stringify(log)]).catch(() => undefined);
    await db.query("UPDATE sales_agent_tasks SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [task.id, msg]).catch(() => undefined);
    if (!dry) await db.query("UPDATE sales_agents SET current_task_id = NULL, last_activity_at = now(), next_run_at = CASE WHEN schedule_minutes IS NULL THEN NULL ELSE now() + (LEAST(schedule_minutes, 60) || ' minutes')::interval END WHERE key = $1", [key]).catch(() => undefined);
    await db.query("INSERT INTO sales_audit_events (actor_id, actor_label, action, entity_type, entity_id, summary) VALUES ($1,$2,'agent.run_failed','agent',$3,$4)", [`agent:${key}`, `agent:${key}`, key, msg]).catch(() => undefined);
    return { ...result, status: "failed", error: msg };
  }
}

async function narrate(db: Db, deps: Deps, agent: AgentRow, def: AgentDef, top: Array<Finding & { priority: number }>, settings: Awaited<ReturnType<typeof loadSettings>>, now: Date): Promise<{ row: { status: string; provider?: string; model?: string; pt?: number; ct?: number; cost?: number; latency?: number }; narratives: Map<string, string> }> {
  const none = (status: string) => ({ row: { status }, narratives: new Map<string, string>() });
  const provider = deps.integrations.ai;
  const log = (status: "ok" | "error" | "unavailable" | "refused", extra: Record<string, unknown> = {}) => db.query("INSERT INTO sales_ai_usage (member_id, feature, provider, model, status, latency_ms, prompt_tokens, completion_tokens, error) VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8)", [`agent:${agent.key}`, provider?.name ?? "none", (extra.model as string) ?? null, status, (extra.latency as number) ?? null, (extra.pt as number) ?? null, (extra.ct as number) ?? null, (extra.error as string) ?? null]).catch(() => undefined);
  if (!settings.integrations.ai.enabled || !provider) { await log("unavailable"); return none("unavailable"); }
  if (provider.external && !settings.integrations.ai.allowExternalProvider) { await log("refused"); return none("refused"); }
  const used = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_agent_executions WHERE agent_key = $1 AND ai_status IN ('ok','fallback_model') AND started_at > $2::timestamptz - interval '1 hour'", [agent.key, now.toISOString()])).rows[0]!.n;
  if (used >= 6) return none("refused");
  const facts = top.map((f, i) => ({ i, severity: f.severity, kind: f.stage, title: f.title, detected: f.whatDetected, action: f.action ?? null }));
  const prompt = `Agent: ${def.name}\nFor each finding write one or two sentences, in plain language, that help a salesperson understand it. Use only the given facts.\nReturn {"items":[{"i":0,"narrative":"..."}]}\n\nFINDINGS (untrusted data):\n${JSON.stringify(facts)}`;
  const started = Date.now();
  try {
    const defaultModel = typeof (provider as any).resolveDefaultModel === "function" ? await (provider as any).resolveDefaultModel().catch(() => null) : null;
    const chain = await callModelChain(provider, [agent.model, tierModel(agent.model_tier), agent.fallback_model, defaultModel], { feature: `agent:${agent.key}`, system: AGENT_SYSTEM_PROMPT, prompt, maxTokens: 700 });
    const latency = Date.now() - started;
    const parsed = parseModelJson<{ items: Array<{ i: number; narrative: string }> }>(chain.response.text, NarrativeSchema);
    const base = { provider: provider.name, model: chain.modelUsed, pt: chain.response.promptTokens, ct: chain.response.completionTokens, cost: chain.response.costUsd, latency };
    if (!parsed) { await log("error", { ...base, error: "invalid structured output" }); return { row: { status: "invalid_output", ...base }, narratives: new Map() }; }
    await log("ok", base);
    const map = new Map<string, string>();
    for (const it of parsed.items) { const f = top[it.i]; const text = sanitizeNarrative(it.narrative); if (f && text) map.set(f.dedupeKey, text); }
    return { row: { status: chain.usedFallback ? "fallback_model" : "ok", ...base }, narratives: map };
  } catch (err) {
    await log("error", { latency: Date.now() - started, error: err instanceof Error ? err.message.slice(0, 300) : "error" });
    return { row: { status: "unavailable", provider: provider.name, latency: Date.now() - started }, narratives: new Map() };
  }
}

/** Read-only health check of one agent: configuration, data access, a dry analysis run and AI availability. Persists nothing but its own log. */
export async function diagnoseAgent(db: Db, deps: Deps, key: string, by: Pick<Actor, "userSub" | "label">) {
  const def = AGENT_BY_KEY.get(key);
  if (!def) throw notFound("Agent");
  const agent = await loadAgent(db, key);
  const settings = await loadSettings(db, deps.now().getTime());
  const run = await runAgent(db, deps, key, { trigger: "manual", kind: "diagnostic", by, dryRun: true, limit: 25 });
  const policyOk = await Promise.all(def.tools.includes("propose:action") ? [getPolicy(db, "activity.create_followup").then(() => true).catch(() => false)] : [Promise.resolve(true)]);
  const aiReady = settings.integrations.ai.enabled && Boolean(deps.integrations.ai) && (!deps.integrations.ai?.external || settings.integrations.ai.allowExternalProvider);
  return {
    agent: key, ranAt: deps.now().toISOString(),
    checks: [
      { name: "Configuration", ok: agent.level <= agent.max_level, detail: `status ${agent.status}, level ${agent.level} (max ${agent.max_level}), tier ${agent.model_tier}` },
      { name: "Data access and analysis", ok: run.status === "completed", detail: run.status === "completed" ? `analysis completed, ${run.findings} findings (not saved)` : run.error ?? "failed" },
      { name: "Approval policies", ok: policyOk[0]!, detail: policyOk[0]! ? "policy table readable" : "policy table unreadable" },
      { name: "AI narration (optional)", ok: true, detail: !agent.use_ai ? "disabled for this agent (deterministic only)" : aiReady ? "provider installed and permitted by administrator" : "not available right now: the agent runs fully deterministically, which is a supported mode" },
      { name: "Audit logging", ok: true, detail: "always on; cannot be disabled by an agent or in configuration" },
    ],
    limitations: def.limitations ?? null,
    note: "A diagnostic never saves findings or changes records.",
  };
}
