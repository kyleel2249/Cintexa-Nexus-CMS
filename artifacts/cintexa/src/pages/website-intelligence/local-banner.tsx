import { useEffect, useState } from "react";
import { HardDrive, KeyRound } from "lucide-react";
import { LOCAL_LIMITATIONS } from "@workspace/wi-engine/local";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPageSpeedKey, setPageSpeedKey, useWiMode, wiJson } from "@/lib/website-intelligence/local";

/** Explains local (serverless) mode honestly. Renders nothing when the API server is in use. */
export function LocalModeBanner() {
  const mode = useWiMode();
  const [key, setKey] = useState(getPageSpeedKey() ?? "");
  const [saved, setSaved] = useState(false);
  const running = useQuery({
    queryKey: ["wi", "stats", "banner"], enabled: mode === "local", refetchInterval: 4000,
    queryFn: () => wiJson<{ running: number }>("/v1/website-audits/stats").then((s) => s.running),
  });

  useEffect(() => {
    if (!running.data) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running.data]);

  if (mode !== "local") return null;
  return (
    <section role="note" aria-label="Local mode" className="wi-no-print rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
      <div className="flex items-start gap-3">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">Running in local mode. No API server is needed.</p>
          <p className="text-muted-foreground">Audits run in this browser and your history is saved on this device. Pages are fetched through a stateless relay that is part of this site.{running.data ? " An audit is running: keep this tab open until it finishes." : ""}</p>
          <details>
            <summary className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">What local mode cannot do</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{LOCAL_LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
          <form className="flex flex-wrap items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); setPageSpeedKey(key); setSaved(true); setTimeout(() => setSaved(false), 2500); }}>
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Optional: your PageSpeed Insights API key" aria-label="PageSpeed Insights API key" className="h-8 max-w-xs" />
            <Button type="submit" size="sm" variant="secondary">{saved ? "Saved" : "Save key"}</Button>
            <span className="text-xs text-muted-foreground">Stored only in this browser. Enables lab Core Web Vitals.</span>
          </form>
        </div>
      </div>
    </section>
  );
}
