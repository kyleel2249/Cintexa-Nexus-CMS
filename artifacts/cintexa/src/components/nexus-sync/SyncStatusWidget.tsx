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
    staleTime: 30_000,
    retry: false,
  });
  const seed = useMutation({
    mutationFn: () => syncPost("/seed-demo", {}),
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
          <CardDescription className="mt-1">Cross-module event bus · zero API keys</CardDescription>
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
          <p className="text-sm text-muted-foreground">Sync API offline. Deploy functions/api/sync.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
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
          </div>
        )}
        <Button size="sm" variant="outline" disabled={seed.isPending} onClick={() => seed.mutate()}>
          {seed.isPending ? "Publishing…" : "Publish demo sync events"}
        </Button>
      </CardContent>
    </Card>
  );
}
