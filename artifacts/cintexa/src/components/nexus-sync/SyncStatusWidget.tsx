import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, ArrowRight } from "lucide-react";
import { syncGet, syncPost } from "@/lib/nexus-sync/api";

export function SyncStatusWidget() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => syncGet<any>("/status"),
    staleTime: 5_000,
    refetchInterval: 10_000, // open sessions pick up new events without a manual refresh
    retry: false,
  });
  const drain = useMutation({
    mutationFn: () => syncPost("/process", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync"] });
      qc.invalidateQueries({ queryKey: ["bd"] });
      qc.invalidateQueries({ queryKey: ["fi"] });
    },
  });

  return (
    <Card className="border-border/80">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-primary" />
            Nexus Sync
          </CardTitle>
          <CardDescription className="mt-1">Cross-module event outbox on Cloudflare D1</CardDescription>
        </div>
        <Link href="/settings">
          <span className="inline-flex items-center gap-1 text-xs text-primary cursor-pointer">
            Details <ArrowRight className="h-3 w-3" />
          </span>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : status.isError ? (
          <p className="text-sm text-muted-foreground">Sync is unavailable. Bind a D1 database (NEXUS_DB or FIN_DB) to the Pages project.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded border p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Processed</p>
              <p className="font-semibold tabular-nums">{status.data.processed}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Pending</p>
              <p className="font-semibold tabular-nums">{status.data.pending}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Failed</p>
              <p className="font-semibold tabular-nums">{status.data.failed}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[10px] uppercase text-muted-foreground">Dead</p>
              <p className="font-semibold tabular-nums">{status.data.dead}</p>
            </div>
          </div>
        )}
        {status.data && !status.data.healthy && (
          <p className="text-xs text-amber-500">Some events failed. They retry automatically with backoff; dead events need a manual retry.</p>
        )}
        <Button size="sm" variant="outline" disabled={drain.isPending || status.isError} onClick={() => drain.mutate()}>
          {drain.isPending ? "Processing…" : "Process pending events"}
        </Button>
      </CardContent>
    </Card>
  );
}
