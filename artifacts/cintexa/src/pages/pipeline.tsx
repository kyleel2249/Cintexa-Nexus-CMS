import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion, AnimatePresence } from "framer-motion";
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  format,
  parseISO,
  isBefore,
  getDay,
  setDay,
  addDays,
  set,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  CalendarClock,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  FileText,
  PenTool,
  RefreshCw,
  Inbox,
  GripVertical,
  Clock,
  Check,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineItem {
  id: string;
  entityId: number;
  type: "post" | "page";
  title: string;
  slug: string;
  status: string;
  scheduledAt: string | null;
  sourceId: number | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchPipeline(): Promise<PipelineItem[]> {
  const res = await fetch("/api/pipeline");
  if (!res.ok) throw new Error("Failed to load pipeline");
  return res.json();
}

async function rescheduleItem(
  type: "post" | "page",
  id: number,
  scheduledAt: Date
): Promise<void> {
  const endpoint =
    type === "page" ? `/api/pages/${id}/schedule` : `/api/posts/${id}/schedule`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to reschedule");
  }
}

// ── Week utilities ─────────────────────────────────────────────────────────────

function getWeekKey(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function weekLabel(weekStart: Date, today: Date): string {
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const diff = Math.round(
    (weekStart.getTime() - thisWeekStart.getTime()) / (7 * 86400000)
  );
  if (diff === 0) return "This Week";
  if (diff === 1) return "Next Week";
  if (diff === -1) return "Last Week";
  if (diff < 0) return `${Math.abs(diff)}w ago`;
  return `In ${diff}w`;
}

function weekDateRange(weekStart: Date): string {
  const end = endOfWeek(weekStart, { weekStartsOn: 1 });
  return `${format(weekStart, "MMM d")} – ${format(end, "MMM d")}`;
}

// ── Quick Schedule Picker ──────────────────────────────────────────────────────

function QuickSchedulePicker({
  item,
  onReschedule,
}: {
  item: PipelineItem;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
}) {
  const initial = item.scheduledAt ? parseISO(item.scheduledAt) : new Date();
  const [open, setOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(initial);
  const [hour, setHour] = useState(
    String(initial.getHours()).padStart(2, "0")
  );
  const [minute, setMinute] = useState(
    String(initial.getMinutes()).padStart(2, "0")
  );
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (!selectedDay) return;
    const date = set(selectedDay, {
      hours: parseInt(hour, 10),
      minutes: parseInt(minute, 10),
      seconds: 0,
      milliseconds: 0,
    });
    setSaving(true);
    try {
      await onReschedule(item, date);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          title="Quick schedule"
          className="flex items-center justify-center h-5 w-5 rounded hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
        >
          <CalendarIcon className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 overflow-hidden"
        align="start"
        side="bottom"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-border/60">
          <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">
            {item.title}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Quick schedule</p>
        </div>

        <Calendar
          mode="single"
          selected={selectedDay}
          onSelect={setSelectedDay}
          initialFocus
          disabled={(d) => isBefore(d, addDays(new Date(), -1))}
          className="[--cell-size:1.9rem]"
        />

        {/* Time row */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border/60 bg-muted/30">
          <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(e.target.value.padStart(2, "0"))}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-10 text-center text-sm bg-background border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-muted-foreground font-bold text-sm">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) => setMinute(e.target.value.padStart(2, "0"))}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-10 text-center text-sm bg-background border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {parseInt(hour) < 12 ? "AM" : "PM"}
          </span>

          <Button
            size="sm"
            className="ml-auto h-7 text-xs gap-1 px-2.5"
            disabled={!selectedDay || saving}
            onClick={handleConfirm}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {saving ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Set
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Draggable Card ─────────────────────────────────────────────────────────────

function PipelineCard({
  item,
  isDragging = false,
  onReschedule,
}: {
  item: PipelineItem;
  isDragging?: boolean;
  onReschedule?: (item: PipelineItem, date: Date) => Promise<void>;
}) {
  const [, setLocation] = useLocation();
  const scheduled = item.scheduledAt ? parseISO(item.scheduledAt) : null;

  return (
    <div
      className={`group relative bg-card border rounded-lg p-3 space-y-2 transition-all cursor-grab active:cursor-grabbing ${
        isDragging
          ? "opacity-50 border-violet-500/50 shadow-xl shadow-violet-500/10"
          : "border-border/50 hover:border-border shadow-sm hover:shadow-md"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0 group-hover:text-muted-foreground transition-colors" />
          {item.type === "post" ? (
            <PenTool className="h-3 w-3 text-amber-400 flex-shrink-0" />
          ) : (
            <FileText className="h-3 w-3 text-indigo-400 flex-shrink-0" />
          )}
          <span className="text-xs font-medium leading-tight truncate">
            {item.title}
          </span>
        </div>

        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            item.status === "published"
              ? "bg-green-500/15 text-green-400"
              : item.status === "scheduled"
              ? "bg-violet-500/15 text-violet-400"
              : "bg-yellow-500/15 text-yellow-400"
          }`}
        >
          {item.status}
        </span>
      </div>

      {/* Date/time row with Quick Schedule trigger */}
      <div className="flex items-center gap-1 pl-5">
        <Clock className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[10px] text-muted-foreground flex-1 truncate">
          {scheduled ? format(scheduled, "EEE, MMM d · h:mm a") : "Not scheduled"}
        </span>
        {!isDragging && onReschedule && (
          <QuickSchedulePicker item={item} onReschedule={onReschedule} />
        )}
      </div>

      {/* Slug */}
      <p className="text-[10px] text-muted-foreground/50 font-mono pl-5 truncate">
        /{item.slug}
      </p>

      {/* Open editor on click (not drag) */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setLocation(`/${item.type}s/${item.entityId}/edit`)}
        className="absolute inset-0 rounded-lg opacity-0"
        aria-label="Open editor"
      />
    </div>
  );
}

// ── Droppable Week Column ──────────────────────────────────────────────────────

function WeekColumn({
  weekKey,
  weekStart,
  items,
  today,
  isOver,
  onReschedule,
}: {
  weekKey: string;
  weekStart: Date;
  items: PipelineItem[];
  today: Date;
  isOver: boolean;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
}) {
  const label = weekLabel(weekStart, today);
  const range = weekDateRange(weekStart);
  const isCurrentWeek = label === "This Week";
  const isPast = isBefore(endOfWeek(weekStart, { weekStartsOn: 1 }), today);

  return (
    <div
      className={`flex flex-col min-h-[420px] w-[220px] flex-shrink-0 rounded-xl border transition-all duration-150 ${
        isOver
          ? "border-violet-500/60 bg-violet-500/5 shadow-lg shadow-violet-500/10"
          : isCurrentWeek
          ? "border-indigo-500/30 bg-indigo-500/5"
          : isPast
          ? "border-border/30 bg-secondary/20 opacity-70"
          : "border-border/40 bg-secondary/10"
      }`}
    >
      {/* Column header */}
      <div
        className={`px-3 py-3 border-b flex items-center justify-between ${
          isCurrentWeek ? "border-indigo-500/20" : "border-border/30"
        }`}
      >
        <div>
          <p
            className={`text-xs font-bold ${
              isCurrentWeek
                ? "text-indigo-400"
                : isPast
                ? "text-muted-foreground/50"
                : "text-foreground"
            }`}
          >
            {label}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{range}</p>
        </div>
        {items.length > 0 && (
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              isCurrentWeek
                ? "bg-indigo-500/20 text-indigo-400"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {items.length}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2">
        <AnimatePresence>
          {items.map((item) => (
            <DraggableCard key={item.id} item={item} onReschedule={onReschedule} />
          ))}
        </AnimatePresence>

        {items.length === 0 && (
          <div
            className={`h-full flex flex-col items-center justify-center py-8 text-center transition-all ${
              isOver
                ? "text-violet-400"
                : "text-muted-foreground/30"
            }`}
          >
            <Inbox className="h-5 w-5 mb-1.5" />
            <p className="text-[10px]">{isOver ? "Drop here" : "No items"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Draggable wrapper ─────────────────────────────────────────────────────────

function DraggableCard({
  item,
  onReschedule,
}: {
  item: PipelineItem;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.id, data: item });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <PipelineCard item={item} isDragging={isDragging} onReschedule={onReschedule} />
    </motion.div>
  );
}

// ── Droppable wrapper ────────────────────────────────────────────────────────

function DroppableWeekColumn({
  weekKey,
  weekStart,
  items,
  today,
  onReschedule,
}: {
  weekKey: string;
  weekStart: Date;
  items: PipelineItem[];
  today: Date;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: weekKey });

  return (
    <div ref={setNodeRef}>
      <WeekColumn
        weekKey={weekKey}
        weekStart={weekStart}
        items={items}
        today={today}
        isOver={isOver}
        onReschedule={onReschedule}
      />
    </div>
  );
}

// ── Main Pipeline Page ─────────────────────────────────────────────────────────

export default function ContentPipeline() {
  const today = new Date();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // How many weeks forward to show
  const [weekOffset, setWeekOffset] = useState(0);
  const WEEKS_VISIBLE = 5;

  const { data: items = [], isLoading, isFetching, refetch } = useQuery<PipelineItem[]>({
    queryKey: ["/api/pipeline"],
    queryFn: fetchPipeline,
    refetchInterval: 60_000,
  });

  // Active dragged item for overlay
  const [activeItem, setActiveItem] = useState<PipelineItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Build week columns
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });

  const weeks: { key: string; start: Date }[] = [];

  // Always show 1 past week + WEEKS_VISIBLE future weeks, offset by weekOffset
  for (let i = -1; i < WEEKS_VISIBLE; i++) {
    const start = addWeeks(thisWeekStart, i + weekOffset);
    weeks.push({ key: getWeekKey(start), start });
  }

  // Group items into columns
  const grouped = useCallback((): Record<string, PipelineItem[]> => {
    const map: Record<string, PipelineItem[]> = {};
    for (const w of weeks) map[w.key] = [];

    for (const item of items) {
      if (!item.scheduledAt) continue;
      const d = parseISO(item.scheduledAt);
      const key = getWeekKey(d);
      if (map[key]) {
        map[key].push(item);
      }
    }
    return map;
  }, [items, weeks])();

  // Items outside visible window
  const visibleIds = new Set(Object.values(grouped).flat().map((i) => i.id));
  const outsideItems = items.filter((i) => !visibleIds.has(i.id));

  // ── Drag handlers ────────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveItem(event.active.data.current as PipelineItem);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;

    const draggedItem = active.data.current as PipelineItem;
    const targetWeekKey = over.id as string;

    // Don't do anything if dropped in same week
    if (draggedItem.scheduledAt) {
      const currentKey = getWeekKey(parseISO(draggedItem.scheduledAt));
      if (currentKey === targetWeekKey) return;
    }

    // Compute new scheduledAt: same day-of-week + same time, in target week
    const targetWeekStart = weeks.find((w) => w.key === targetWeekKey)?.start;
    if (!targetWeekStart) return;

    let newDate: Date;
    if (draggedItem.scheduledAt) {
      const orig = parseISO(draggedItem.scheduledAt);
      const dayOfWeek = getDay(orig); // 0=Sun … 6=Sat
      // Set day within target week
      newDate = setDay(targetWeekStart, dayOfWeek, { weekStartsOn: 1 });
      // Copy hours/minutes
      newDate.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
      // If that lands before today, push to next available slot
      if (isBefore(newDate, today)) {
        newDate = addDays(today, 1);
        newDate.setHours(9, 0, 0, 0);
      }
    } else {
      // No date: put at Wednesday 9am of target week
      newDate = addDays(targetWeekStart, 2);
      newDate.setHours(9, 0, 0, 0);
    }

    // Optimistic update
    queryClient.setQueryData<PipelineItem[]>(["/api/pipeline"], (prev = []) =>
      prev.map((i) =>
        i.id === draggedItem.id ? { ...i, scheduledAt: newDate.toISOString(), status: "scheduled" } : i
      )
    );

    try {
      await rescheduleItem(draggedItem.type, draggedItem.entityId, newDate);
      toast({
        title: "Rescheduled",
        description: `"${draggedItem.title}" moved to ${format(newDate, "EEE, MMM d 'at' h:mm a")}`,
      });
    } catch (err: unknown) {
      toast({
        title: "Reschedule failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      refetch();
    }
  }

  // ── Quick Schedule handler (from picker) ────────────────────────────────────

  async function handleQuickReschedule(item: PipelineItem, date: Date) {
    // Optimistic update
    queryClient.setQueryData<PipelineItem[]>(["/api/pipeline"], (prev = []) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, scheduledAt: date.toISOString(), status: "scheduled" } : i
      )
    );
    try {
      await rescheduleItem(item.type, item.entityId, date);
      toast({
        title: "Scheduled",
        description: `"${item.title}" set for ${format(date, "EEE, MMM d 'at' h:mm a")}`,
      });
    } catch (err: unknown) {
      toast({
        title: "Failed to schedule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      refetch();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Content Pipeline</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Drag cards between weeks to reschedule · {items.length} scheduled item{items.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekOffset((o) => o - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setWeekOffset(0)}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekOffset((o) => o + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refetch()}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <PenTool className="h-3 w-3 text-amber-400" /> Post
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-indigo-400" /> Page
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-violet-500/60" /> Scheduled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500/60" /> Published
        </span>
        <span className="ml-auto italic opacity-70">
          Drag a card to a different week to reschedule it
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading pipeline…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <CalendarClock className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm font-medium">No scheduled content yet</p>
          <p className="text-xs mt-1 opacity-60">
            Use <strong>Duplicate &amp; schedule</strong> or <strong>Recurring schedule</strong> from Posts or Pages to add items here.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Scrollable board */}
          <div className="overflow-x-auto pb-4 -mx-2 px-2">
            <div className="flex gap-3 min-w-max">
              {weeks.map(({ key, start }) => (
                <DroppableWeekColumn
                  key={key}
                  weekKey={key}
                  weekStart={start}
                  items={grouped[key] ?? []}
                  today={today}
                  onReschedule={handleQuickReschedule}
                />
              ))}
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
            {activeItem && (
              <div className="rotate-1 scale-105">
                <PipelineCard item={activeItem} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Items outside visible window */}
      {outsideItems.length > 0 && (
        <div className="border border-dashed border-border/50 rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Outside visible range ({outsideItems.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {outsideItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-1.5 bg-secondary/50 border border-border/40 rounded-md px-2 py-1 text-xs"
              >
                {item.type === "post" ? (
                  <PenTool className="h-2.5 w-2.5 text-amber-400" />
                ) : (
                  <FileText className="h-2.5 w-2.5 text-indigo-400" />
                )}
                <span className="text-muted-foreground truncate max-w-[160px]">{item.title}</span>
                {item.scheduledAt && (
                  <span className="text-muted-foreground/50">
                    · {format(parseISO(item.scheduledAt), "MMM d")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
