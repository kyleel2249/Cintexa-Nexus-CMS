import { useEffect } from "react";
import { HardDrive } from "lucide-react";
import { LOCAL_LIMITATIONS } from "@workspace/wi-engine/local";
import { useQuery } from "@tanstack/react-query";
import { useWiMode, wiJson } from "@/lib/website-intelligence/local";

/** Explains local (serverless) mode honestly. Renders nothing when the API server is in use. */
export function LocalModeBanner() {
  const mode = useWiMode();
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
        </div>
      </div>
    </section>
  );
}
