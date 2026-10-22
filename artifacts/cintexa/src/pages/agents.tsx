import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { WI_AGENTS, type WiAgentInfo, type WiAgentStatus } from "@workspace/wi-core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { intel, IntelError } from "@/lib/intelligence-local";

interface CommandAgent { role: string; title: string; description: string; domain: string; tools: string[]; autonomyCeiling: number }
const STATUS: Record<WiAgentStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  partial: { label: "Partly built", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  gated: { label: "Approval gate only", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
};
const GROUPS: { id: WiAgentInfo["group"]; title: string; text: string }[] = [
  { id: "audit", title: "Audit agents", text: "Discover, measure and explain a website." },
  { id: "competitive", title: "Competitive agents", text: "Find competitors and compare measured results." },
  { id: "action", title: "Action agents", text: "Recommend, apply with approval, monitor and verify." },
];

export default function AgentsPage() {
  const [cmd, setCmd] = useState<{ loading: boolean; agents: CommandAgent[]; error?: string }>({ loading: true, agents: [] });
  useEffect(() => {
    let live = true;
    intel<{ agents: CommandAgent[] }>("GET", "/agents")
      .then((r) => live && setCmd({ loading: false, agents: r.agents }))
      .catch((e) => live && setCmd({ loading: false, agents: [], error: e instanceof IntelError || e instanceof Error ? e.message : "Request failed" }));
    return () => { live = false; };
  }, []);
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Bot className="h-6 w-6" aria-hidden />AI Agents</h1>
        <p className="text-sm text-muted-foreground">Every agent in the platform, what it does, and what it is not allowed to do. Agents can propose and report; people approve and decide.</p>
      </div>

      <section aria-labelledby="wi-agents" className="space-y-4">
        <h2 id="wi-agents" className="text-lg font-semibold">Website Intelligence agents ({WI_AGENTS.length})</h2>
        {GROUPS.map((g) => (
          <div key={g.id} className="space-y-2">
            <div><h3 className="font-medium">{g.title}</h3><p className="text-xs text-muted-foreground">{g.text}</p></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {WI_AGENTS.filter((a) => a.group === g.id).map((a) => (
                <Card key={a.id}><CardContent className="space-y-2 p-4 text-sm">
                  <div className="flex items-center gap-2"><Bot className="h-4 w-4 shrink-0" aria-hidden /><span className="font-medium">{a.name}</span><span className={cn("ml-auto rounded px-2 py-0.5 text-[11px] font-semibold", STATUS[a.status].cls)}>{STATUS[a.status].label}</span></div>
                  <p>{a.purpose}</p>
                  <p className="text-xs text-muted-foreground"><b>Limits:</b> {a.limits}</p>
                  {a.governance && <p className="flex gap-1 text-xs"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>{a.governance}</span></p>}
                  <Link href={a.where.href} className="inline-block text-xs text-primary underline">{a.where.label}</Link>
                </CardContent></Card>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="cc-agents" className="space-y-3">
        <div className="flex items-center gap-2"><h2 id="cc-agents" className="text-lg font-semibold">Command Centre agents{cmd.loading ? "" : ` (${cmd.agents.length})`}</h2><Link href="/intelligence" className="text-xs text-primary underline">Open Command Centre</Link></div>
        {cmd.loading && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading agents</p>}
        {cmd.error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">The Command Centre agents could not be loaded: {cmd.error}</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cmd.agents.map((a) => (
            <Card key={a.role}><CardContent className="space-y-1 p-4 text-sm">
              <div className="flex items-center gap-2"><Bot className="h-4 w-4 shrink-0" aria-hidden /><span className="font-medium">{a.title}</span><Badge variant="outline" className="ml-auto">max level {a.autonomyCeiling}</Badge></div>
              <p>{a.description}</p>
              <p className="text-xs text-muted-foreground">Domain: {a.domain}. Tools: {a.tools.length ? a.tools.join(", ") : "none (coordinates other agents)"}</p>
            </CardContent></Card>
          ))}
        </div>
      </section>
    </div>
  );
}
