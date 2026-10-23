/** Contextual assistant: answers a question about one selected record using that record's permitted facts, open agent findings,
 *  competitor evidence and historical stage outcomes. Works without AI (returns the evidence-backed findings). */
import { v, parse } from "../core/validate";
import type { Route } from "../core/router";
import { badRequest, notFound, tooManyRequests } from "../core/errors";
import { audit } from "../core/audit";
import { can, assertOwnerAccess } from "../core/rbac";
import { d10 } from "../core/http";
import { gatherFacts } from "../modules/assist";
import { loadOwned } from "../modules/common";
import type { Actor, Queryable } from "../core/types";
import { AGENT_SYSTEM_PROMPT, callModelChain, sanitizeNarrative, tierModel } from "./llm";

const TYPES = ["account", "contact", "opportunity", "lead", "quotation"] as const;
const HOURLY = 30;

async function facts(q: Queryable, actor: Actor, type: (typeof TYPES)[number], id: number, settings: any, now: Date) {
  if (type === "account" || type === "opportunity" || type === "lead") return gatherFacts(q, actor, type, id, settings, now);
  if (type === "quotation") {
    const x = await loadOwned<any>(q, actor, "sales_quotations", id, "Quotation");
    const a = (await q.query<any>("SELECT name FROM sales_accounts WHERE id = $1", [x.account_id])).rows[0];
    return { title: x.number, facts: { number: x.number, status: x.status, total: x.total, currency: x.currency, validUntil: d10(x.validity_date), account: a?.name ?? null, opportunityId: x.opportunity_id ?? null, sentAt: x.sent_at ?? null } };
  }
  const c = (await q.query<any>("SELECT c.*, a.owner_id AS acct_owner, a.name AS account_name FROM sales_contacts c JOIN sales_accounts a ON a.id = c.account_id WHERE c.id = $1 AND c.archived_at IS NULL", [id])).rows[0];
  if (!c) throw notFound("Contact");
  assertOwnerAccess(actor, c.acct_owner, "Contact");
  return { title: `${c.first_name} ${c.last_name ?? ""}`.trim(), facts: { name: `${c.first_name} ${c.last_name ?? ""}`.trim(), account: c.account_name, role: c.job_title ?? null, hasEmail: Boolean(c.email), hasPhone: Boolean(c.phone), emailConsent: c.consent_email, unsubscribed: Boolean(c.unsubscribed_at) } };
}

export const contextAssistRoutes: Route[] = [
  {
    method: "POST", path: "/ai/context-assist", permission: "ai:use", tx: false,
    async handler({ q, actor, body, settings, deps, now, requestId }) {
      const b = parse(v.object({ entity_type: v.enumOf(TYPES), entity_id: v.id(), question: v.string({ min: 3, max: 400 }) }), body);
      const { title, facts: f } = await facts(q, actor, b.entity_type, b.entity_id, settings, now);
      const recs = can(actor, "agents:read")
        ? (await q.query<any>(`SELECT id, agent_key, stage, severity, title, what_detected, why_it_matters, recommended_action, expected_outcome, due_on, evidence FROM sales_agent_recommendations WHERE status IN ('open','accepted') AND entity_type = $1 AND entity_id = $2 ORDER BY priority_score DESC LIMIT 6`, [b.entity_type, b.entity_id])).rows
        : [];
      const extra: Record<string, unknown> = {};
      if (b.entity_type === "opportunity" && can(actor, "competitors:read")) {
        extra.competitors = (await q.query(`SELECT c.name, oc.outcome, (SELECT i.title FROM sales_competitor_intel i WHERE i.competitor_id = c.id AND i.verified AND i.archived_at IS NULL ORDER BY i.observed_on DESC NULLS LAST LIMIT 1) AS latest_verified_evidence FROM sales_opportunity_competitors oc JOIN sales_competitors c ON c.id = oc.competitor_id WHERE oc.opportunity_id = $1`, [b.entity_id])).rows;
        const h = (await q.query<any>(`SELECT count(*) FILTER (WHERE o.status = 'won')::int won, count(*) FILTER (WHERE o.status = 'lost')::int lost FROM sales_opportunities o WHERE o.status IN ('won','lost') AND o.archived_at IS NULL AND EXISTS (SELECT 1 FROM sales_opportunity_stage_history h WHERE h.opportunity_id = o.id AND h.to_stage_id = (SELECT stage_id FROM sales_opportunities WHERE id = $1))`, [b.entity_id])).rows[0];
        extra.historicalOutcomesForThisStage = { won: h.won, lost: h.lost, note: h.won + h.lost < 10 ? "small sample; treat as indicative only" : "deals that passed through the same stage" };
      }
      const evidenceBacked = recs.map((r: any) => ({ id: r.id, agent: r.agent_key, kind: r.stage, severity: r.severity, title: r.title, detected: r.what_detected, why: r.why_it_matters, action: r.recommended_action, expected: r.expected_outcome, dueOn: r.due_on ? d10(r.due_on) : null, evidence: (r.evidence ?? []).slice(0, 5) }));
      const fallback = { available: false, title, answer: evidenceBacked.length ? evidenceBacked.map((r: any, i: number) => `${i + 1}. ${r.title}${r.action ? ` → ${r.action}` : ""}`).join("\n") : null, recommendations: evidenceBacked, facts: f, extra, note: evidenceBacked.length ? "AI is not available. These are the agents' evidence-backed findings for this record." : "AI is not available and no agent finding exists for this record yet, so only the recorded facts are shown." };
      const provider = deps.integrations.ai;
      const log = (status: string, x: Record<string, unknown> = {}) => q.query("INSERT INTO sales_ai_usage (member_id, feature, provider, model, status, latency_ms, prompt_tokens, completion_tokens, error) VALUES ($1,'context_assist',$2,$3,$4,$5,$6,$7,$8)", [actor.memberId || null, provider?.name ?? "none", (x.model as string) ?? null, status, (x.latency as number) ?? null, (x.pt as number) ?? null, (x.ct as number) ?? null, (x.error as string) ?? null]).catch(() => undefined);
      if (!settings.integrations.ai.enabled || !provider) { await log("unavailable"); return fallback; }
      if (provider.external && !settings.integrations.ai.allowExternalProvider) { await log("refused"); return { ...fallback, note: "An administrator has not allowed sending record data to an external AI provider. Showing the agents' findings and recorded facts only." }; }
      const used = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_ai_usage WHERE member_id = $1 AND status = 'ok' AND at > now() - interval '1 hour'", [actor.memberId || -1])).rows[0]!.n;
      if (used >= HOURLY) throw tooManyRequests(`AI assist limit reached (${HOURLY} per hour)`);
      const started = Date.now();
      try {
        const dm = typeof (provider as any).resolveDefaultModel === "function" ? await (provider as any).resolveDefaultModel().catch(() => null) : null;
        const r = await callModelChain(provider, [tierModel("standard"), tierModel("economy"), dm], { feature: "context_assist", system: `${AGENT_SYSTEM_PROMPT} Answer the salesperson's question about this one record in at most 150 words, as plain text. Base every statement on the given facts or findings; prefer the evidence-backed findings over general sales advice; say what is unknown.`, prompt: `QUESTION: ${b.question}\n\nRECORD (${b.entity_type}) FACTS:\n${JSON.stringify(f)}\n\nAGENT FINDINGS:\n${JSON.stringify(evidenceBacked)}\n\nOTHER EVIDENCE:\n${JSON.stringify(extra)}`, maxTokens: 450 });
        await log("ok", { model: r.modelUsed, latency: Date.now() - started, pt: r.response.promptTokens, ct: r.response.completionTokens });
        await audit(q, actor, { action: "ai.context_assist", entityType: b.entity_type, entityId: b.entity_id, summary: `AI answered a question about ${title} (${provider.external ? "external" : "internal"} provider ${provider.name}); nothing was changed` }, requestId);
        return { available: true, title, answer: sanitizeNarrative(r.response.text, 1500), model: r.modelUsed, recommendations: evidenceBacked, facts: f, extra, disclaimer: "AI-generated. Check against the record and the findings below before acting. Nothing was changed or sent." };
      } catch (err) {
        await log("error", { latency: Date.now() - started, error: err instanceof Error ? err.message.slice(0, 300) : "error" });
        return { ...fallback, note: "The AI provider did not respond. Showing the agents' findings and recorded facts only." };
      }
    },
  },
];
void badRequest;
