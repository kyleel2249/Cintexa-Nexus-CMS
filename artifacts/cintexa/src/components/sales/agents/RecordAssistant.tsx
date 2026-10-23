import { useState } from "react";
import { Sparkles, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation } from "@/lib/sales/hooks";
import { useSales } from "@/context/SalesContext";
import { Panel, Input, StatusBadge, Tag } from "@/components/sales/ui";
import { SEVERITY_TONE, type Severity } from "@/lib/sales/agents";

type RecordType = "opportunity" | "account" | "lead" | "quotation" | "contact";
interface Answer { available: boolean; title?: string; answer: string | null; note?: string; disclaimer?: string; model?: string; recommendations: Array<{ id: number; agent: string; severity: Severity; title: string; detected: string; action: string | null; expected: string | null; dueOn: string | null; evidence: Array<{ label: string; value?: unknown }> }>; facts: unknown; extra?: Record<string, unknown> }

const SUGGEST: Record<RecordType, string[]> = {
  opportunity: ["What should I do next to improve the chance of winning this deal?", "What are the biggest risks on this deal?"],
  account: ["What is the health of this account and what should I do?", "Where could we sell more here?"],
  lead: ["Is this lead worth pursuing and what is the next step?"],
  quotation: ["What should I check before following up on this quotation?"],
  contact: ["How should I approach this contact?"],
};

/** Ask about the record you are looking at. Answers use the record's facts and the agents' evidence-backed findings; AI (if an administrator allows it) only phrases the answer. Nothing is changed or sent. */
export function RecordAssistant({ type, id }: { type: RecordType; id: number }) {
  const { can } = useSales();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const ask = useSalesMutation((text: string) => sales.post<Answer>("/ai/context-assist", { entity_type: type, entity_id: id, question: text }), { onSuccess: (r) => setAnswer(r) });
  if (!can("ai:use")) return null;
  const go = (t: string) => { if (t.trim().length >= 3) void ask.run(t.trim()); };
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" />Ask about this record</span>} description="Uses this record’s facts and the agents’ evidence-backed findings. Nothing is changed or sent.">
      <div className="flex flex-wrap gap-2">
        {SUGGEST[type].map((s) => <button key={s} type="button" onClick={() => { setQuestion(s); go(s); }} className="rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary hover:bg-primary/10">{s}</button>)}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(question); }}>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about this record…" maxLength={400} aria-label="Question" />
        <Button type="submit" disabled={ask.pending || question.trim().length < 3}><SendHorizonal className="mr-1 h-4 w-4" />{ask.pending ? "Thinking…" : "Ask"}</Button>
      </form>
      {answer && (
        <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-bottom-1">
          {answer.answer && (
            <div className="rounded-lg border bg-secondary/40 p-3 text-sm">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">{answer.available ? `${answer.disclaimer ?? ""} ${answer.model ? `Model: ${answer.model}.` : ""}` : answer.note}</p>
            </div>
          )}
          {!answer.answer && <p className="text-sm text-muted-foreground">{answer.note}</p>}
          {answer.recommendations.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Agent findings for this record</p>
              <ul className="space-y-2">{answer.recommendations.map((r) => (
                <li key={r.id} className="rounded-lg border p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.severity} tone={SEVERITY_TONE[r.severity]} /><Tag>{r.agent}</Tag>{r.dueOn && <Tag>Due {r.dueOn}</Tag>}</div>
                  <p className="mt-1 text-sm font-medium">{r.title}</p><p className="text-muted-foreground">{r.detected}</p>
                  {r.action && <p className="mt-1"><span className="font-medium">Next step: </span>{r.action}{r.expected ? ` → ${r.expected}` : ""}</p>}
                  {r.evidence.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Evidence: {r.evidence.map((e) => `${e.label}${e.value ? ` (${String(e.value)})` : ""}`).join(" · ")}</p>}
                </li>))}</ul>
            </div>
          )}
          <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Facts used</summary><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2">{JSON.stringify({ facts: answer.facts, ...(answer.extra ?? {}) }, null, 2)}</pre></details>
        </div>
      )}
    </Panel>
  );
}
