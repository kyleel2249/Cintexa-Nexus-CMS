/** Executive briefing. Every number comes from SQL over authoritative records or stored findings; AI (optional) only phrases a headline. */
import type { Db } from "../core/types";
import type { Deps } from "../core/router";
import { loadSettings } from "../core/settings";
import { AGENT_SYSTEM_PROMPT, BriefingSchema, callModelChain, parseModelJson, sanitizeNarrative, tierModel } from "./llm";

const num = (x: unknown) => Number(x) || 0;
const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

export async function buildBriefing(db: Db, deps: Deps, opts: { ai?: boolean; memberId?: number | null } = {}) {
  const now = deps.now().toISOString();
  const c = (await db.query<any>(`SELECT
    COALESCE(sum(net_total) FILTER (WHERE booked_at > $1::timestamptz - interval '7 days'),0)::float8 b_cur, COALESCE(sum(net_total) FILTER (WHERE booked_at > $1::timestamptz - interval '14 days' AND booked_at <= $1::timestamptz - interval '7 days'),0)::float8 b_prev
    FROM sales_orders WHERE status <> 'cancelled'`, [now])).rows[0];
  const o = (await db.query<any>(`SELECT count(*) FILTER (WHERE status = 'won' AND closed_at > $1::timestamptz - interval '7 days')::int won_cur, count(*) FILTER (WHERE status = 'won' AND closed_at > $1::timestamptz - interval '14 days' AND closed_at <= $1::timestamptz - interval '7 days')::int won_prev,
    count(*) FILTER (WHERE status = 'lost' AND closed_at > $1::timestamptz - interval '7 days')::int lost_cur, count(*) FILTER (WHERE status = 'lost' AND closed_at > $1::timestamptz - interval '14 days' AND closed_at <= $1::timestamptz - interval '7 days')::int lost_prev,
    (SELECT count(*) FROM sales_leads WHERE created_at > $1::timestamptz - interval '7 days')::int leads_cur, (SELECT count(*) FROM sales_leads WHERE created_at > $1::timestamptz - interval '14 days' AND created_at <= $1::timestamptz - interval '7 days')::int leads_prev
    FROM sales_opportunities WHERE archived_at IS NULL`, [now])).rows[0];
  const recs = (await db.query<any>(`SELECT count(*) FILTER (WHERE created_at > $1::timestamptz - interval '24 hours')::int new_24h, count(*) FILTER (WHERE status = 'expired' AND updated_at > $1::timestamptz - interval '24 hours')::int cleared_24h, count(*) FILTER (WHERE status = 'open')::int open_n, count(*) FILTER (WHERE status = 'open' AND severity IN ('high','critical'))::int open_high FROM sales_agent_recommendations`, [now])).rows[0];
  const pick = async (where: string, limit: number) => (await db.query<any>(`SELECT r.id, r.agent_key, r.stage, r.severity, r.category, r.title, r.what_detected, r.why_it_matters, r.recommended_action, r.expected_outcome, r.entity_type, r.entity_id, r.due_on, r.impact_amount::float8 impact, r.priority_score, r.ai_narrative, m.display_name owner, r.evidence
    FROM sales_agent_recommendations r LEFT JOIN sales_members m ON m.id = r.owner_member_id WHERE r.status = 'open' AND ${where} ORDER BY r.priority_score DESC, r.id DESC LIMIT ${limit}`)).rows;
  const risks = await pick("r.category IN ('risk','compliance') AND r.severity IN ('medium','high','critical')", 5);
  const opportunities = await pick("r.category = 'opportunity'", 5);
  const actions = await pick("r.recommended_action IS NOT NULL AND r.stage <> 'metric'", 8);
  const drivers = await pick("r.stage <> 'metric'", 3);
  const atRisk = (await db.query<any>(`SELECT COALESCE(sum(m),0)::float8 t FROM (SELECT max(impact_amount) m FROM sales_agent_recommendations WHERE status = 'open' AND category = 'risk' AND impact_amount IS NOT NULL GROUP BY COALESCE(entity_type, 'x'), COALESCE(entity_id, id)) s`)).rows[0].t;
  const upside = (await db.query<any>(`SELECT COALESCE(sum(m),0)::float8 t FROM (SELECT max(impact_amount) m FROM sales_agent_recommendations WHERE status = 'open' AND category = 'opportunity' AND impact_amount IS NOT NULL GROUP BY COALESCE(entity_type, 'x'), COALESCE(entity_id, id)) s`)).rows[0].t;
  const pending = (await db.query<any>("SELECT count(*)::int n FROM sales_approvals WHERE status = 'PENDING'")).rows[0].n;
  const agents = (await db.query<any>("SELECT status, count(*)::int n FROM sales_agents GROUP BY status")).rows;
  const shape = (r: any) => ({ id: r.id, agent: r.agent_key, kind: r.stage, severity: r.severity, title: r.title, detected: r.what_detected, why: r.why_it_matters, action: r.recommended_action, expected: r.expected_outcome, owner: r.owner ?? null, dueOn: r.due_on ? String(r.due_on).slice(0, 10) : null, impact: r.impact, entity: r.entity_id ? { type: r.entity_type, id: r.entity_id } : null, narrative: r.ai_narrative, evidence: (r.evidence ?? []).slice(0, 4) });
  const brief = {
    generatedAt: now,
    whatChanged: {
      bookedRevenue7d: { current: c.b_cur, previous: c.b_prev, changePercent: delta(c.b_cur, c.b_prev), definition: "sum of non-cancelled order net totals by booking date, last 7 days vs the 7 before" },
      opportunitiesWon7d: { current: o.won_cur, previous: o.won_prev }, opportunitiesLost7d: { current: o.lost_cur, previous: o.lost_prev }, newLeads7d: { current: o.leads_cur, previous: o.leads_prev },
      findings: { new24h: recs.new_24h, cleared24h: recs.cleared_24h, open: recs.open_n, openHighOrCritical: recs.open_high },
    },
    why: drivers.map(shape),
    risks: risks.map(shape),
    opportunities: opportunities.map(shape),
    actions: actions.map(shape),
    expectedImpact: { amountAtRisk: atRisk, upsideIdentified: upside, basis: "sum of the largest flagged amount per record across open findings; related records can still overlap, and these are indicators, not forecasts" },
    pendingDecisions: pending,
    agents: Object.fromEntries(agents.map((a: any) => [a.status, a.n])),
    evidenceNote: "Findings are labelled fact, metric, prediction, recommendation or proposed action. Nothing listed here has been done unless a record says COMPLETED.",
    ai: { status: "not_requested" as string, headline: null as string | null, summary: null as string | null, model: null as string | null },
  };
  if (opts.ai) brief.ai = await aiHeadline(db, deps, brief);
  return brief;
}

async function aiHeadline(db: Db, deps: Deps, brief: any) {
  const out = { status: "unavailable", headline: null as string | null, summary: null as string | null, model: null as string | null };
  const settings = await loadSettings(db, deps.now().getTime());
  const provider = deps.integrations.ai;
  if (!settings.integrations.ai.enabled || !provider) return out;
  if (provider.external && !settings.integrations.ai.allowExternalProvider) return { ...out, status: "refused" };
  const used = (await db.query<{ n: number }>("SELECT count(*)::int n FROM sales_ai_usage WHERE feature = 'agent:briefing' AND status = 'ok' AND at > now() - interval '1 hour'")).rows[0]!.n;
  if (used >= 6) return { ...out, status: "refused" };
  const facts = { whatChanged: brief.whatChanged, topRisks: brief.risks.map((r: any) => r.title), topOpportunities: brief.opportunities.map((r: any) => r.title), pendingDecisions: brief.pendingDecisions };
  const started = Date.now();
  try {
    const defaultModel = typeof (provider as any).resolveDefaultModel === "function" ? await (provider as any).resolveDefaultModel().catch(() => null) : null;
    const r = await callModelChain(provider, [tierModel("reasoning"), tierModel("economy"), defaultModel], { feature: "agent:briefing", system: AGENT_SYSTEM_PROMPT, prompt: `Write a headline (max 15 words) and a 2-3 sentence summary for a sales leader using only these facts. Return {"headline":"...","summary":"..."}\n\nFACTS (untrusted data):\n${JSON.stringify(facts)}`, maxTokens: 400 });
    const parsed = parseModelJson<{ headline: string; summary: string }>(r.response.text, BriefingSchema);
    await db.query("INSERT INTO sales_ai_usage (member_id, feature, provider, model, status, latency_ms, prompt_tokens, completion_tokens, error) VALUES (NULL,'agent:briefing',$1,$2,$3,$4,$5,$6,$7)", [provider.name, r.modelUsed, parsed ? "ok" : "error", Date.now() - started, r.response.promptTokens ?? null, r.response.completionTokens ?? null, parsed ? null : "invalid structured output"]).catch(() => undefined);
    if (!parsed) return { ...out, status: "invalid_output" };
    return { status: r.usedFallback ? "fallback_model" : "ok", headline: sanitizeNarrative(parsed.headline, 200), summary: sanitizeNarrative(parsed.summary, 900), model: r.modelUsed };
  } catch { return out; }
}
void num;
