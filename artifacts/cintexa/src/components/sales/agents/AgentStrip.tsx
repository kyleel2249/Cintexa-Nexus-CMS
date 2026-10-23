import { Link } from "wouter";
import { Bot, ArrowRight, ShieldCheck } from "lucide-react";
import { useSales } from "@/context/SalesContext";
import { useSalesQuery } from "@/lib/sales/hooks";
import { StatusBadge } from "@/components/sales/ui";
import { HEALTH_TONE, type CommandCentre } from "@/lib/sales/agents";

/** Entry point on Sales Overview: live agent network status for managers, a pointer to "My findings" for everyone else. */
export function AgentStrip() {
  const { can } = useSales();
  const full = can("agents:run");
  const q = useSalesQuery<CommandCentre>(full ? "/agents/command-centre" : null);
  if (!full && !can("agents:read")) return null;
  const d = q.data;
  return (
    <Link href="/sales/command-centre">
      <div className="group mb-5 flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border bg-gradient-to-r from-violet-500/15 via-sky-500/10 to-emerald-500/10 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 text-violet-500"><Bot className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Sales AI Command Centre</p>
          {full && d ? (
            <p className="text-xs text-muted-foreground">{d.totals.active} of {d.totals.configured} agents active · {d.findings.open} open findings ({d.findings.highOrCritical} high or critical) · {d.pendingHumanDecisions} awaiting your approval</p>
          ) : (
            <p className="text-xs text-muted-foreground">{full ? "Loading agent status…" : "See AI findings and recommended next steps on your own records."}</p>
          )}
        </div>
        {full && d && <StatusBadge status={d.health} tone={HEALTH_TONE[d.health].tone} label={HEALTH_TONE[d.health].label} />}
        {full && d && d.pendingHumanDecisions > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-500"><ShieldCheck className="h-3 w-3" />{d.pendingHumanDecisions} to decide</span>}
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
