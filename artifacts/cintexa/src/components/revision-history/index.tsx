import { useState } from "react";
import { useGetPageRevisions, useRestorePageRevision, useGetPage, PageRevision } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { htmlToBlocks } from "@/components/page-builder";
import { FullRenderer } from "@/components/site-preview/full-renderer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import {
  History,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronRight,
  Clock,
  User,
  Tag,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RevisionHistoryProps {
  pageId: number;
  onRestored: () => void;
}

export function RevisionHistory({ pageId, onRestored }: RevisionHistoryProps) {
  const { data: revisions = [], isLoading, refetch } = useGetPageRevisions(pageId);
  const restoreMutation = useRestorePageRevision();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [previewRevId, setPreviewRevId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [justRestoredId, setJustRestoredId] = useState<number | null>(null);

  const previewRevision = revisions.find((r) => r.id === previewRevId) ?? null;
  const previewBlocks = previewRevision ? htmlToBlocks(previewRevision.content ?? "") : [];

  async function handleRestore(revision: PageRevision) {
    setRestoringId(revision.id);
    try {
      await restoreMutation.mutateAsync({ id: pageId, revisionId: revision.id });
      // Invalidate page queries so the editor reloads fresh data
      await queryClient.invalidateQueries({ queryKey: [`/api/pages/${pageId}`] });
      await refetch();
      setJustRestoredId(revision.id);
      setTimeout(() => setJustRestoredId(null), 3000);
      toast({
        title: "Revision restored",
        description: `Page restored to version from ${format(new Date(revision.createdAt), "MMM d 'at' h:mm a")}`,
      });
      onRestored();
    } catch {
      toast({ title: "Restore failed", variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading history…
      </div>
    );
  }

  if (revisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-center px-4">
        <History className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-xs">No revisions yet. Every save creates a snapshot automatically.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Preview panel */}
      <AnimatePresence>
        {previewRevision && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-b border-border/50"
          >
            <div className="bg-background">
              <div className="flex items-center justify-between px-3 py-2 bg-secondary/40 text-[10px] text-muted-foreground">
                <span className="font-medium">
                  Preview — {format(new Date(previewRevision.createdAt), "MMM d 'at' h:mm a")}
                </span>
                <button
                  onClick={() => setPreviewRevId(null)}
                  className="hover:text-foreground transition-colors"
                >
                  <EyeOff className="h-3 w-3" />
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto bg-white">
                <div className="transform scale-[0.55] origin-top-left" style={{ width: "182%", pointerEvents: "none" }}>
                  {previewBlocks.length > 0 ? (
                    <FullRenderer blocks={previewBlocks} />
                  ) : (
                    <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                      No visual blocks in this revision
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Revision list */}
      <ScrollArea className="max-h-[480px]">
        <div className="divide-y divide-border/30">
          {revisions.map((rev, index) => {
            const isLatest = index === 0;
            const isRestoring = restoringId === rev.id;
            const isRestored = justRestoredId === rev.id;
            const isPreviewing = previewRevId === rev.id;
            const blocks = htmlToBlocks(rev.content ?? "");

            return (
              <motion.div
                key={rev.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`group relative px-3 py-3 transition-colors hover:bg-secondary/40 ${
                  isPreviewing ? "bg-secondary/60" : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isLatest ? "bg-indigo-500" : isRestored ? "bg-green-500" : "bg-border"
                      }`}
                    />
                    {index < revisions.length - 1 && (
                      <div className="w-px flex-1 bg-border/50 mt-1 min-h-[20px]" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {rev.label && (
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                            rev.label === "Published"
                              ? "bg-green-500/15 text-green-400"
                              : rev.label.startsWith("Restored")
                              ? "bg-blue-500/15 text-blue-400"
                              : rev.label === "Initial version"
                              ? "bg-purple-500/15 text-purple-400"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {rev.label}
                        </span>
                      )}
                      {isLatest && !rev.label && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">
                          Current
                        </span>
                      )}
                      {isRestored && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 flex items-center gap-0.5">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Restored
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-medium text-foreground leading-tight truncate">
                      {rev.title}
                    </p>

                    <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDistanceToNow(new Date(rev.createdAt), { addSuffix: true })}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-2.5 w-2.5" />
                        {rev.savedBy}
                      </span>
                      {blocks.length > 0 && (
                        <span className="text-[9px] text-muted-foreground/70">
                          {blocks.length} block{blocks.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setPreviewRevId(isPreviewing ? null : rev.id)}
                      title="Preview this revision"
                      className={`p-1 rounded transition-colors ${
                        isPreviewing
                          ? "bg-indigo-500/20 text-indigo-400"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                    {!isLatest && (
                      <button
                        onClick={() => handleRestore(rev)}
                        disabled={isRestoring}
                        title="Restore this revision"
                        className="p-1 rounded text-muted-foreground hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
                      >
                        {isRestoring ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="px-3 py-2.5 border-t border-border/50 bg-secondary/20">
        <p className="text-[10px] text-muted-foreground text-center">
          {revisions.length} revision{revisions.length !== 1 ? "s" : ""} saved •{" "}
          Hover any revision to preview or restore
        </p>
      </div>
    </div>
  );
}
