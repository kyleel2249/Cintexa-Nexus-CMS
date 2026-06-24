import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameDay, isSameMonth, isToday, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  FileText,
  PenTool,
  Clock,
  Globe,
  ExternalLink,
  Loader2,
  CalendarClock,
  LayoutGrid,
  AlignJustify,
} from "lucide-react";
import { CalendarItem } from "@workspace/api-client-react";

// We call the API directly to avoid a complex codegen wiring
async function fetchCalendarItems(from: string, to: string): Promise<CalendarItem[]> {
  const res = await fetch(`/api/calendar?from=${from}&to=${to}`);
  if (!res.ok) throw new Error("Failed to fetch calendar");
  return res.json();
}

async function rescheduleItem(type: "page" | "post", id: number, newDate: Date): Promise<void> {
  const endpoint = type === "page" ? `/api/pages/${id}/schedule` : `/api/posts/${id}/schedule`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt: newDate.toISOString() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to reschedule");
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = "month" | "week";

interface DragState {
  item: CalendarItem;
  originDate: string;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function chipColors(item: CalendarItem) {
  const base = item.type === "page"
    ? item.dateType === "scheduled" ? "bg-violet-500/15 border-violet-500/50 text-violet-300" : "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
    : item.dateType === "scheduled" ? "bg-violet-500/15 border-violet-500/50 text-amber-300" : "bg-amber-500/15 border-amber-500/40 text-amber-300";
  return base;
}

function typeIcon(type: "page" | "post") {
  return type === "page"
    ? <FileText className="h-2.5 w-2.5 shrink-0" />
    : <PenTool className="h-2.5 w-2.5 shrink-0" />;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ContentCalendar() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const loadedRangeRef = useRef<string>("");

  // Compute visible date range
  const getRange = useCallback(() => {
    if (viewMode === "month") {
      const ms = startOfMonth(currentDate);
      const me = endOfMonth(currentDate);
      // Expand to full weeks shown in grid
      return {
        from: startOfWeek(ms, { weekStartsOn: 0 }),
        to: endOfWeek(me, { weekStartsOn: 0 }),
      };
    } else {
      return {
        from: startOfWeek(currentDate, { weekStartsOn: 0 }),
        to: endOfWeek(currentDate, { weekStartsOn: 0 }),
      };
    }
  }, [currentDate, viewMode]);

  // Load items for the visible range
  const loadItems = useCallback(async () => {
    const { from, to } = getRange();
    const key = `${format(from, "yyyy-MM-dd")}__${format(to, "yyyy-MM-dd")}`;
    if (loadedRangeRef.current === key) return;
    loadedRangeRef.current = key;
    setIsLoading(true);
    try {
      const data = await fetchCalendarItems(format(from, "yyyy-MM-dd"), format(to, "yyyy-MM-dd"));
      setItems(data);
    } catch {
      toast({ title: "Failed to load calendar", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [getRange, toast]);

  // Load on first render and when range changes
  useState(() => { loadItems(); });
  const prevViewMode = useRef(viewMode);
  const prevDate = useRef(currentDate.toISOString());
  if (prevViewMode.current !== viewMode || prevDate.current !== currentDate.toISOString()) {
    prevViewMode.current = viewMode;
    prevDate.current = currentDate.toISOString();
    loadedRangeRef.current = ""; // force reload
    loadItems();
  }

  // Build the grid of days
  function buildDays(): Date[] {
    const { from, to } = getRange();
    const days: Date[] = [];
    let d = from;
    while (d <= to) {
      days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }

  const days = buildDays();

  // Get items for a given day
  function itemsForDay(day: Date): CalendarItem[] {
    return items.filter(item => isSameDay(parseISO(item.date), day));
  }

  // Navigate
  function prev() {
    setCurrentDate(d => viewMode === "month" ? subMonths(d, 1) : addDays(d, -7));
  }
  function next() {
    setCurrentDate(d => viewMode === "month" ? addMonths(d, 1) : addDays(d, 7));
  }
  function goToday() {
    setCurrentDate(new Date());
  }

  // ── Drag-to-reschedule ────────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, item: CalendarItem) {
    if (item.dateType !== "scheduled") {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    setDragState({ item, originDate: item.date });
    setSelectedItem(null);
  }

  function handleDragOver(e: React.DragEvent, day: Date) {
    if (!dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDate(format(day, "yyyy-MM-dd"));
  }

  function handleDragLeave() {
    setDragOverDate(null);
  }

  async function handleDrop(e: React.DragEvent, day: Date) {
    e.preventDefault();
    setDragOverDate(null);
    if (!dragState) return;

    const { item } = dragState;
    setDragState(null);

    // Don't reschedule to the same day
    if (isSameDay(parseISO(item.date), day)) return;
    // Don't allow past dates
    if (day < new Date(new Date().setHours(0, 0, 0, 0))) {
      toast({ title: "Can't reschedule to the past", variant: "destructive" });
      return;
    }

    // Preserve original time, change the day
    const original = parseISO(item.date);
    const newDate = new Date(day);
    newDate.setHours(original.getHours(), original.getMinutes(), 0, 0);
    // If same day but time is past, bump to next hour
    if (newDate <= new Date()) {
      newDate.setHours(new Date().getHours() + 1, 0, 0, 0);
    }

    setReschedulingId(item.id);
    // Optimistic update
    setItems(prev => prev.map(i =>
      i.id === item.id && i.type === item.type
        ? { ...i, date: newDate.toISOString(), scheduledAt: newDate.toISOString() }
        : i
    ));

    try {
      await rescheduleItem(item.type, item.id, newDate);
      toast({
        title: "Rescheduled",
        description: `"${item.title}" moved to ${format(newDate, "MMM d 'at' h:mm a")}`,
      });
      // Reload to confirm server state
      loadedRangeRef.current = "";
      await loadItems();
    } catch (err: any) {
      toast({ title: err.message || "Reschedule failed", variant: "destructive" });
      // Revert optimistic update
      setItems(prev => prev.map(i =>
        i.id === item.id && i.type === item.type ? item : i
      ));
    } finally {
      setReschedulingId(null);
    }
  }

  function handleDragEnd() {
    setDragState(null);
    setDragOverDate(null);
  }

  // ── Header label ──────────────────────────────────────────────────────────

  const headerLabel = viewMode === "month"
    ? format(currentDate, "MMMM yyyy")
    : (() => {
        const { from, to } = getRange();
        return `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`;
      })();

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="h-full flex flex-col space-y-0 -m-6">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold leading-tight">Content Calendar</h1>
            <p className="text-xs text-muted-foreground">Scheduled & published content across all sites</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Legend */}
          <div className="hidden md:flex items-center gap-3 mr-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> Page</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Post</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" /> Scheduled</span>
          </div>

          {/* View toggle */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => setViewMode("month")}
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${viewMode === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            >
              <LayoutGrid className="h-3 w-3" /> Month
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${viewMode === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
            >
              <AlignJustify className="h-3 w-3" /> Week
            </button>
          </div>

          {/* Nav */}
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={next}>
            <ChevronRight className="h-4 w-4" />
          </Button>

          <span className="font-semibold text-sm min-w-[160px] text-center">{headerLabel}</span>

          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* ── Calendar grid ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Week header */}
        <div className="grid grid-cols-7 mb-1">
          {weekDays.map(d => (
            <div key={d} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className={`grid grid-cols-7 gap-px bg-border/30 rounded-xl overflow-hidden border border-border/30 ${viewMode === "week" ? "h-[calc(100vh-220px)]" : ""}`}>
          {days.map(day => {
            const dayItems = itemsForDay(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const dayKey = format(day, "yyyy-MM-dd");
            const isDragTarget = dragOverDate === dayKey;
            const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));

            return (
              <div
                key={dayKey}
                onDragOver={e => handleDragOver(e, day)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, day)}
                className={`min-h-[100px] p-1.5 transition-colors relative
                  ${isCurrentMonth ? "bg-background" : "bg-secondary/20"}
                  ${isToday(day) ? "ring-1 ring-inset ring-primary/40" : ""}
                  ${isDragTarget && !isPast ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/40" : ""}
                  ${isPast && isDragTarget ? "bg-red-500/5" : ""}
                `}
              >
                {/* Day number */}
                <div className={`text-xs font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full ${
                  isToday(day) ? "bg-primary text-primary-foreground" : isCurrentMonth ? "text-foreground" : "text-muted-foreground/40"
                }`}>
                  {format(day, "d")}
                </div>

                {/* Drop hint */}
                {isDragTarget && !isPast && (
                  <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-2">
                    <span className="text-[9px] text-violet-400 font-medium bg-violet-500/10 px-1.5 py-0.5 rounded">Drop to reschedule</span>
                  </div>
                )}

                {/* Content chips */}
                <div className="space-y-0.5">
                  {dayItems.slice(0, viewMode === "week" ? 20 : 3).map(item => (
                    <div
                      key={`${item.type}-${item.id}`}
                      draggable={item.dateType === "scheduled"}
                      onDragStart={e => handleDragStart(e, item)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedItem(selectedItem?.id === item.id && selectedItem?.type === item.type ? null : item)}
                      title={item.dateType === "scheduled" ? "Drag to reschedule" : item.title}
                      className={`
                        flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border truncate
                        ${chipColors(item)}
                        ${item.dateType === "scheduled" ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
                        ${reschedulingId === item.id ? "opacity-50" : ""}
                        ${dragState?.item.id === item.id && dragState?.item.type === item.type ? "opacity-30 scale-95" : ""}
                        hover:brightness-125 transition-all
                      `}
                    >
                      {typeIcon(item.type)}
                      <span className="truncate leading-tight">{item.title}</span>
                      {item.dateType === "scheduled" && <CalendarClock className="h-2 w-2 shrink-0 ml-auto" />}
                    </div>
                  ))}
                  {viewMode === "month" && dayItems.length > 3 && (
                    <div className="text-[9px] text-muted-foreground px-1.5">
                      +{dayItems.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Detail panel (slide-up when item selected) ───────────────── */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="fixed bottom-4 left-[284px] right-4 z-50"
          >
            <div className="bg-card border border-border/70 rounded-xl shadow-2xl p-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`p-2 rounded-lg ${selectedItem.type === "page" ? "bg-indigo-500/15" : "bg-amber-500/15"}`}>
                  {selectedItem.type === "page"
                    ? <FileText className="h-4 w-4 text-indigo-400" />
                    : <PenTool className="h-4 w-4 text-amber-400" />}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{selectedItem.title}</p>
                  <p className="text-xs text-muted-foreground truncate">/{selectedItem.slug}</p>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      selectedItem.status === "published" ? "bg-green-500/15 text-green-400" :
                      selectedItem.status === "scheduled" ? "bg-violet-500/15 text-violet-400" :
                      "bg-yellow-500/15 text-yellow-400"
                    }`}>{selectedItem.status}</span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {format(parseISO(selectedItem.date), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                    {selectedItem.siteName && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Globe className="h-2.5 w-2.5" />
                        {selectedItem.siteName}
                      </span>
                    )}
                    {selectedItem.dateType === "scheduled" && (
                      <span className="text-[10px] text-violet-400 flex items-center gap-1">
                        <CalendarClock className="h-2.5 w-2.5" /> Drag chip to reschedule
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    setLocation(`/${selectedItem.type}s/${selectedItem.id}/edit`);
                  }}
                >
                  <ExternalLink className="h-3 w-3" /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedItem(null)}>
                  ✕
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {!isLoading && items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: "200px" }}>
          <div className="text-center space-y-2">
            <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No scheduled or published content this period</p>
            <p className="text-xs text-muted-foreground/60">Schedule pages or posts to see them here</p>
          </div>
        </div>
      )}
    </div>
  );
}
