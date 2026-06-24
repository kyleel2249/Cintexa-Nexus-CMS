import { useState } from "react";
import { format, isPast, isFuture } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface ScheduledCopy {
  id: number;
  title: string;
  slug: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
}

interface ScheduleHistoryPanelProps {
  entityId: number;
  type: "post" | "page";
}

function useScheduleHistory(entityId: number, type: "post" | "page") {
  return useQuery<ScheduledCopy[]>({
    queryKey: [`/api/${type}s/${entityId}/schedule-history`],
    queryFn: async () => {
      const res = await fetch(`/api/${type}s/${entityId}/schedule-history`);
      if (!res.ok) throw new Error("Failed to load schedule history");
      return res.json();
    },
    enabled: !!entityId,
    refetchInterval: 30_000,
  });
}

export function ScheduleHistoryPanel({ entityId, type }: ScheduleHistoryPanelProps) {
  const { data: copies = [], isLoading, refetch, isFetching } = useScheduleHistory(entityId, type);
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (copies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-7 px-4 text-center">
        <CalendarClock className="h-7 w-7 mb-2 opacity-20" />
        <p className="text-xs text-muted-foreground">
          No scheduled copies yet.
          <br />
          Use <span className="font-medium text-foreground">Duplicate &amp; schedule</span> or{" "}
          <span className="font-medium text-foreground">Recurring schedule</span> from the{" "}
          {type === "post" ? "Posts" : "Pages"} list.
        </p>
      </div>
    );
  }

  const upcoming = copies.filter(
    (c) => c.scheduledAt && isFuture(new Date(c.scheduledAt))
  );
  const past = copies.filter(
    (c) => !c.scheduledAt || isPast(new Date(c.scheduledAt))
  );

  return (
    <div className="space-y-0">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/30 border-b border-border/40">
        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
          {copies.length} cop{copies.length !== 1 ? "ies" : "y"}
          {upcoming.length > 0 && (
            <span className="ml-1 text-violet-400">· {upcoming.length} upcoming</span>
          )}
        </span>
        <button
          onClick={() => refetch()}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <ScrollArea className="max-h-[420px]">
        <div className="divide-y divide-border/30">
          <AnimatePresence initial={false}>
            {copies.map((copy, index) => {
              const scheduled = copy.scheduledAt ? new Date(copy.scheduledAt) : null;
              const isUpcoming = scheduled ? isFuture(scheduled) : false;
              const isPastItem = !isUpcoming;

              return (
                <motion.div
                  key={copy.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="group flex items-start gap-2.5 px-3 py-3 hover:bg-secondary/40 transition-colors"
                >
                  {/* Timeline icon */}
                  <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                    {isUpcoming ? (
                      <CalendarClock className="h-3.5 w-3.5 text-violet-400" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500/70" />
                    )}
                    {index < copies.length - 1 && (
                      <div className="w-px flex-1 bg-border/40 mt-1 min-h-[16px]" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-xs font-medium leading-tight truncate text-foreground">
                      {copy.title}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      {scheduled ? (
                        <span
                          className={`flex items-center gap-1 text-[10px] ${
                            isUpcoming ? "text-violet-400" : "text-muted-foreground"
                          }`}
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {format(scheduled, "MMM d, yyyy · h:mm a")}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">No date set</span>
                      )}

                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          copy.status === "published"
                            ? "bg-green-500/15 text-green-400"
                            : copy.status === "scheduled"
                            ? "bg-violet-500/15 text-violet-400"
                            : "bg-yellow-500/15 text-yellow-400"
                        }`}
                      >
                        {copy.status}
                      </span>
                    </div>

                    <p className="text-[10px] text-muted-foreground/60 font-mono truncate">
                      /{copy.slug}
                    </p>
                  </div>

                  {/* Open link */}
                  <button
                    onClick={() => setLocation(`/${type}s/${copy.id}/edit`)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                    title={`Open ${type} editor`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>

      <div className="px-3 py-2 border-t border-border/40 bg-secondary/20">
        <p className="text-[10px] text-muted-foreground text-center">
          {upcoming.length > 0
            ? `Next: ${format(new Date(upcoming[0].scheduledAt!), "MMM d 'at' h:mm a")}`
            : past.length > 0
            ? `Last published: ${format(
                new Date(past[past.length - 1].scheduledAt || past[past.length - 1].createdAt),
                "MMM d, yyyy"
              )}`
            : ""}
        </p>
      </div>
    </div>
  );
}
