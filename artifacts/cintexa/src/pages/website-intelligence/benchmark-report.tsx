import { useState } from "react";
import type { BenchmarkReport, BenchmarkRow } from "@workspace/wi-core";
import { cn } from "@/lib/utils";
import { Panel } from "./components";

const POSITION: Record<BenchmarkRow["position"], { text: string; cls: string }> = {
  ahead: { text: "Ahead", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  level: { text: "Level", cls: "bg-secondary text-foreground" },
  behind: { text: "Behind", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
  insufficient: { text: "Not enough evidence", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
};
const num = (v: number | null) => (v === null ? "n/a" : String(v));
const signed = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}`);

/** Dimension-by-dimension benchmark with the method, sample size, confidence and the reason behind every number. */
export function BenchmarkReportPanel({ report }: { report: BenchmarkReport }) {
  const [open, setOpen] = useState<string | null>(null);
  const s = report.summary;
  return (
    <Panel title="Benchmark by dimension" description={`Method ${report.methodVersion}. ${report.comparableSites} comparable site${report.comparableSites === 1 ? "" : "s"}. ${s.ahead} ahead, ${s.level} level, ${s.behind} behind, ${s.insufficient} without enough evidence.`}>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Benchmark of this site against comparable sites, by scoring dimension</caption>
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th scope="col" className="p-2">Dimension</th><th scope="col" className="p-2">You</th><th scope="col" className="p-2" title="Median of comparable sites only. Describes this peer set, not an industry.">Peer median</th><th scope="col" className="p-2">Difference</th><th scope="col" className="p-2">Position</th><th scope="col" className="p-2">Sample</th><th scope="col" className="p-2">Confidence</th></tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((r) => (
              <>
                <tr key={r.key} className={cn(r.key === "overall" && "bg-primary/5 font-medium")}>
                  <th scope="row" className="p-2 text-left font-medium"><button type="button" className="text-left underline-offset-2 hover:underline" aria-expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>{r.label}</button></th>
                  <td className="p-2 tabular-nums">{num(r.own)}{r.vsTarget === "below" && <span className="ml-1 text-xs text-muted-foreground" title={r.target.label}>(below {r.target.value} target)</span>}</td>
                  <td className="p-2 tabular-nums">{num(r.peerMedian)}</td>
                  <td className="p-2 tabular-nums">{signed(r.difference)}</td>
                  <td className="p-2"><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", POSITION[r.position].cls)}>{POSITION[r.position].text}</span></td>
                  <td className="p-2 tabular-nums">{r.comparableCount}</td>
                  <td className="p-2 capitalize">{r.confidence}</td>
                </tr>
                {open === r.key && (
                  <tr key={`${r.key}-detail`}><td colSpan={7} className="space-y-1 bg-muted/20 p-3 text-xs">
                    <p><span className="font-medium">Definition: </span>{r.definition}</p>
                    <p><span className="font-medium">Method: </span>{r.method}</p>
                    <p><span className="font-medium">Interpretation: </span>{r.interpretation}</p>
                    <p><span className="font-medium">Recommended response: </span>{r.recommendedResponse}</p>
                    {r.caveats.map((c) => <p key={c} className="text-amber-700 dark:text-amber-400">{c}</p>)}
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">{r.comparators.map((c) => <li key={c.id} title={c.reason ?? undefined} className={cn(!c.comparable && "text-muted-foreground line-through")}>{c.hostname}: {num(c.value)}</li>)}</ul>
                  </td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
      {report.excluded.length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Excluded from the comparison</p><ul className="list-disc pl-5">{report.excluded.map((e) => <li key={e.hostname}>{e.hostname}: {e.reason}</li>)}</ul></div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{report.note}</p>
    </Panel>
  );
}
