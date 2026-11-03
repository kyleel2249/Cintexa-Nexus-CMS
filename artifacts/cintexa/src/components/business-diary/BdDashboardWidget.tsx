import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, ArrowRight } from "lucide-react";
import { bdGet } from "@/lib/business-diary/api";

export function BdDashboardWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["bd", "widget"],
    queryFn: () => bdGet<any>("/dashboard"),
    staleTime: 60_000,
    retry: false,
  });

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            Business Diary
          </CardTitle>
          <CardDescription className="mt-1.5">Institutional memory · no API keys</CardDescription>
        </div>
        <Link href="/business-diary">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 cursor-pointer hover:opacity-90">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">
            Diary API not reachable. Deploy <code className="text-xs">/api/diary</code>.{" "}
            <Link href="/business-diary"><span className="text-primary underline cursor-pointer">Open module</span></Link>
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Entries", data.totals?.entries ?? 0],
              ["Today", data.totals?.today ?? 0],
              ["Follow-ups", data.totals?.pendingFollowUps ?? 0],
              ["Pitches", data.totals?.pitches ?? 0],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border p-3">
                <p className="text-[11px] uppercase text-muted-foreground">{l}</p>
                <p className="text-sm font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
