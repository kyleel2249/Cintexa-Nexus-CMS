import { useState, useEffect } from "react";
import { useGetPages } from "@workspace/api-client-react";
import { RecurringScheduleDialog } from "@/components/recurring-schedule-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, FileText, MoreHorizontal, MonitorPlay,
  Clock, CalendarClock, Check, Loader2, X, CalendarRange, Copy, ExternalLink, RefreshCw,
} from "lucide-react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatePresence, motion } from "framer-motion";
import { SitePreview } from "@/components/site-preview";
import { useToast } from "@/hooks/use-toast";

async function reschedulePage(id: number, newDate: Date): Promise<void> {
  const res = await fetch(`/api/pages/${id}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt: newDate.toISOString() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to reschedule");
  }
}

export default function Pages() {
  const { data: pages, isLoading, refetch } = useGetPages();
  const { toast } = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPageId, setPreviewPageId] = useState<number | undefined>(undefined);

  // ── Single-row reschedule ──────────────────────────────────────────────────
  const [openRescheduleId, setOpenRescheduleId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>(undefined);
  const [rescheduleTime, setRescheduleTime] = useState("12:00");
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);

  function openPicker(id: number, currentDate?: string | null) {
    const base = currentDate ? parseISO(currentDate) : new Date();
    setRescheduleDate(base);
    setRescheduleTime(format(base, "HH:mm"));
    setOpenRescheduleId(id);
  }

  async function confirmReschedule(pageId: number, title: string) {
    if (!rescheduleDate) return;
    const [hours, minutes] = rescheduleTime.split(":").map(Number);
    const newDate = new Date(rescheduleDate);
    newDate.setHours(hours, minutes, 0, 0);
    setOpenRescheduleId(null);
    setReschedulingId(pageId);
    try {
      await reschedulePage(pageId, newDate);
      toast({ title: "Rescheduled", description: `"${title}" scheduled for ${format(newDate, "MMM d, yyyy 'at' h:mm a")}` });
      refetch();
    } catch (err: any) {
      toast({ title: err.message || "Reschedule failed", variant: "destructive" });
    } finally {
      setReschedulingId(null);
    }
  }

  // ── Recurring schedule dialog ──────────────────────────────────────────────
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recurringSource, setRecurringSource] = useState<{ id: number; title: string } | null>(null);

  // ── Duplicate & schedule ───────────────────────────────────────────────────
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [pendingRescheduleId, setPendingRescheduleId] = useState<number | null>(null);

  useEffect(() => {
    if (!pendingRescheduleId || !pages) return;
    const page = pages.find((p) => p.id === pendingRescheduleId);
    if (page) {
      openPicker(page.id, page.updatedAt);
      setPendingRescheduleId(null);
    }
  }, [pendingRescheduleId, pages]);

  async function duplicateAndSchedule(sourceId: number) {
    setDuplicatingId(sourceId);
    try {
      const res = await fetch(`/api/pages/${sourceId}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to duplicate");
      }
      const copy = await res.json();
      toast({ title: "Page duplicated", description: `"${copy.title}" created as draft` });
      setPendingRescheduleId(copy.id);
      refetch();
    } catch (err: any) {
      toast({ title: err.message || "Duplication failed", variant: "destructive" });
    } finally {
      setDuplicatingId(null);
    }
  }

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDate, setBulkDate] = useState<Date | undefined>(undefined);
  const [bulkTime, setBulkTime] = useState("12:00");
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [isBulkRescheduling, setIsBulkRescheduling] = useState(false);

  const allIds = pages?.map((p) => p.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = allIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkDate(undefined);
    setBulkPickerOpen(false);
  }

  async function confirmBulkReschedule() {
    if (!bulkDate || selectedIds.size === 0) return;
    const [hours, minutes] = bulkTime.split(":").map(Number);
    const newDate = new Date(bulkDate);
    newDate.setHours(hours, minutes, 0, 0);
    setBulkPickerOpen(false);
    setIsBulkRescheduling(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => reschedulePage(id, newDate)));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    setIsBulkRescheduling(false);
    clearSelection();
    refetch();
    if (failed === 0) {
      toast({ title: `${succeeded} page${succeeded !== 1 ? "s" : ""} rescheduled`, description: `All moved to ${format(newDate, "MMM d, yyyy 'at' h:mm a")}` });
    } else {
      toast({ title: `${succeeded} succeeded, ${failed} failed`, description: "Some pages could not be rescheduled.", variant: "destructive" });
    }
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Pages</h2>
          <p className="text-muted-foreground mt-1">Create and manage static pages.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setPreviewPageId(undefined); setPreviewOpen(true); }}>
            <MonitorPlay className="mr-2 h-4 w-4" />
            Preview Site
          </Button>
          <Link href="/pages/new" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2">
            <Plus className="mr-2 h-4 w-4" />
            New Page
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-4 py-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search pages..." className="pl-9 bg-card" />
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px] pr-0">
                <Checkbox
                  checked={allSelected}
                  data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                  className="translate-y-[1px]"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Last Edited</TableHead>
              <TableHead className="w-[110px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[250px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-[80px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : pages?.length ? (
              pages.map((page) => {
                const isSelected = selectedIds.has(page.id);
                const isBusy = reschedulingId === page.id || duplicatingId === page.id;
                return (
                  <TableRow
                    key={page.id}
                    className={`group cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(page.id)}
                        aria-label={`Select ${page.title}`}
                        className="translate-y-[1px]"
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/pages/${page.id}/edit`} className="flex items-center gap-2 hover:text-primary transition-colors">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {page.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">
                      {page.slug?.startsWith("/") ? page.slug : `/${page.slug}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={page.status === "published" ? "default" : "secondary"}>
                        {page.status ?? "draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{page.template || "Default"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {page.updatedAt ? format(new Date(page.updatedAt), "MMM d, yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-1" />
                        ) : (
                          <>
                            {/* Single reschedule picker */}
                            <Popover
                              open={openRescheduleId === page.id}
                              onOpenChange={(open) => {
                                if (open) openPicker(page.id, page.updatedAt);
                                else setOpenRescheduleId(null);
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Reschedule" onClick={(e) => e.stopPropagation()}>
                                  <CalendarClock className="h-3.5 w-3.5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="end" onClick={(e) => e.stopPropagation()}>
                                <div className="p-3 border-b border-border">
                                  <p className="text-xs font-semibold text-foreground">Reschedule Page</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[200px]">{page.title}</p>
                                </div>
                                <Calendar mode="single" selected={rescheduleDate} onSelect={setRescheduleDate} initialFocus />
                                <div className="p-3 border-t border-border space-y-3">
                                  <div className="flex items-center gap-2">
                                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    <Input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} className="h-7 text-xs" />
                                  </div>
                                  <Button size="sm" className="w-full h-7 text-xs gap-1.5" disabled={!rescheduleDate} onClick={() => confirmReschedule(page.id, page.title)}>
                                    <Check className="h-3.5 w-3.5" /> Confirm Reschedule
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>

                            {/* Preview button */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Preview page" onClick={() => { setPreviewPageId(page.id); setPreviewOpen(true); }}>
                              <MonitorPlay className="h-3.5 w-3.5" />
                            </Button>

                            {/* Actions dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem asChild>
                                  <Link href={`/pages/${page.id}/edit`} className="flex items-center gap-2 cursor-pointer">
                                    <ExternalLink className="h-3.5 w-3.5" /> Edit page
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    duplicateAndSchedule(page.id);
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5 text-violet-400" />
                                  <span>Duplicate &amp; schedule</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRecurringSource({ id: page.id, title: page.title });
                                    setRecurringOpen(true);
                                  }}
                                >
                                  <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
                                  <span>Recurring schedule…</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No pages found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Recurring schedule dialog ────────────────────────────────────────── */}
      {recurringSource && (
        <RecurringScheduleDialog
          open={recurringOpen}
          onOpenChange={setRecurringOpen}
          sourceId={recurringSource.id}
          sourceTitle={recurringSource.title}
          type="page"
          onSuccess={() => refetch()}
        />
      )}

      {/* ── Bulk action bar ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 bg-card border border-border/70 rounded-xl shadow-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium pr-3 border-r border-border">
                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground">
                  {selectedCount}
                </div>
                page{selectedCount !== 1 ? "s" : ""} selected
              </div>
              <Popover open={bulkPickerOpen} onOpenChange={setBulkPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2 text-xs">
                    <CalendarRange className="h-3.5 w-3.5" />
                    {bulkDate ? format(bulkDate, "MMM d, yyyy") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center" side="top">
                  <div className="p-3 border-b border-border">
                    <p className="text-xs font-semibold">Bulk Reschedule</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{selectedCount} page{selectedCount !== 1 ? "s" : ""} will be moved to this date</p>
                  </div>
                  <Calendar mode="single" selected={bulkDate} onSelect={setBulkDate} initialFocus />
                  <div className="p-3 border-t border-border space-y-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Input type="time" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} className="h-7 text-xs" />
                    </div>
                    <Button size="sm" className="w-full h-7 text-xs gap-1.5" disabled={!bulkDate} onClick={confirmBulkReschedule}>
                      <Check className="h-3.5 w-3.5" /> Reschedule {selectedCount} page{selectedCount !== 1 ? "s" : ""}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button size="sm" className="h-8 gap-2 text-xs" disabled={!bulkDate || isBulkRescheduling} onClick={confirmBulkReschedule}>
                {isBulkRescheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                {isBulkRescheduling ? "Rescheduling…" : "Reschedule"}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={clearSelection} title="Clear selection">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewOpen && (
          <SitePreview onClose={() => setPreviewOpen(false)} initialPageId={previewPageId} />
        )}
      </AnimatePresence>
    </div>
  );
}
