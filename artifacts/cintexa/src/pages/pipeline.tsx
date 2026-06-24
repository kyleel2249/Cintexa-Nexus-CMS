import { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
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
  addMonths,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  X,
  Repeat,
  Copy,
  Pause,
  Play,
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

async function unscheduleItem(
  type: "post" | "page",
  id: number
): Promise<void> {
  const endpoint =
    type === "page" ? `/api/pages/${id}/schedule` : `/api/posts/${id}/schedule`;
  const res = await fetch(endpoint, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to unschedule");
  }
}

async function pauseSeries(
  type: "post" | "page",
  sourceId: number
): Promise<{ paused: number }> {
  const endpoint =
    type === "page"
      ? `/api/pages/${sourceId}/series/pause`
      : `/api/posts/${sourceId}/series/pause`;
  const res = await fetch(endpoint, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to pause series");
  }
  return res.json();
}

async function resumeSeries(
  type: "post" | "page",
  sourceId: number
): Promise<{ resumed: number }> {
  const endpoint =
    type === "page"
      ? `/api/pages/${sourceId}/series/resume`
      : `/api/posts/${sourceId}/series/resume`;
  const res = await fetch(endpoint, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to resume series");
  }
  return res.json();
}

async function createRecurringSchedule(
  type: "post" | "page",
  id: number,
  scheduledDates: string[]
): Promise<{ created: number; ids: number[] }> {
  const endpoint =
    type === "page" ? `/api/pages/${id}/recurring` : `/api/posts/${id}/recurring`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledDates }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to create recurring schedule"
    );
  }
  return res.json();
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

// ── Recurring helpers ──────────────────────────────────────────────────────────

type Cadence = "weekly" | "biweekly" | "monthly";

function computeRecurringDates(
  cadence: Cadence,
  startDate: Date,
  count: number
): Date[] {
  const dates: Date[] = [];
  let current = startDate;
  for (let i = 0; i < count; i++) {
    dates.push(new Date(current));
    if (cadence === "weekly") current = addWeeks(current, 1);
    else if (cadence === "biweekly") current = addWeeks(current, 2);
    else current = addMonths(current, 1);
  }
  return dates;
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

// ── Recurring Schedule Dialog ──────────────────────────────────────────────────

function RecurringScheduleDialog({
  item,
  open,
  onOpenChange,
  onCreated,
}: {
  item: PipelineItem;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (count: number) => void;
}) {
  const { toast } = useToast();
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [startDay, setStartDay] = useState<Date | undefined>(
    addDays(new Date(), 7)
  );
  const [hour, setHour] = useState("09");
  const [minute, setMinute] = useState("00");
  const [count, setCount] = useState(4);
  const [saving, setSaving] = useState(false);

  const previewDates = useMemo(() => {
    if (!startDay) return [];
    const base = set(startDay, {
      hours: parseInt(hour, 10) || 0,
      minutes: parseInt(minute, 10) || 0,
      seconds: 0,
      milliseconds: 0,
    });
    return computeRecurringDates(cadence, base, count);
  }, [cadence, startDay, hour, minute, count]);

  async function handleConfirm() {
    if (previewDates.length === 0) return;
    setSaving(true);
    try {
      const result = await createRecurringSchedule(
        item.type,
        item.entityId,
        previewDates.map((d) => d.toISOString())
      );
      toast({
        title: "Recurring schedule created",
        description: `${result.created} ${item.type} ${result.created === 1 ? "copy" : "copies"} added to the pipeline.`,
      });
      onCreated(result.created);
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Failed to create recurring schedule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const cadenceLabels: Record<Cadence, string> = {
    weekly: "Weekly",
    biweekly: "Bi-weekly",
    monthly: "Monthly",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Repeat className="h-4 w-4 text-primary" />
            Recurring Schedule
          </DialogTitle>
          <div className="flex items-center gap-1.5 mt-0.5">
            {item.type === "post" ? (
              <PenTool className="h-3 w-3 text-amber-400 flex-shrink-0" />
            ) : (
              <FileText className="h-3 w-3 text-indigo-400 flex-shrink-0" />
            )}
            <p className="text-xs text-muted-foreground truncate">{item.title}</p>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Cadence picker */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Cadence
            </p>
            <div className="flex gap-1.5">
              {(["weekly", "biweekly", "monthly"] as Cadence[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCadence(c)}
                  className={`flex-1 text-xs rounded-md border px-2 py-1.5 font-medium transition-colors ${
                    cadence === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {cadenceLabels[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Start date + time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Start Date
              </p>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="w-full flex items-center gap-1.5 text-xs border border-border/60 rounded-md px-2 py-1.5 hover:border-primary/40 transition-colors text-left">
                    <CalendarIcon className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">
                      {startDay ? format(startDay, "MMM d, yyyy") : "Pick date"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDay}
                    onSelect={setStartDay}
                    disabled={(d) => isBefore(d, new Date())}
                    initialFocus
                    className="[--cell-size:1.9rem]"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Time
              </p>
              <div className="flex items-center gap-1 border border-border/60 rounded-md px-2 py-1.5">
                <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => setHour(e.target.value.padStart(2, "0"))}
                  className="w-7 text-center text-xs bg-transparent focus:outline-none"
                />
                <span className="text-muted-foreground text-xs font-bold">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => setMinute(e.target.value.padStart(2, "0"))}
                  className="w-7 text-center text-xs bg-transparent focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Occurrences slider */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Occurrences — <span className="text-foreground">{count}</span>
            </p>
            <input
              type="range"
              min={1}
              max={12}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value))}
              className="w-full accent-primary h-1.5"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/40">
              <span>1</span>
              <span>12</span>
            </div>
          </div>

          {/* Preview list */}
          {previewDates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Preview — {previewDates.length}{" "}
                {previewDates.length === 1 ? "entry" : "entries"}
              </p>
              <div className="rounded-md border border-border/40 bg-secondary/20 divide-y divide-border/30 max-h-36 overflow-y-auto">
                {previewDates.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5"
                  >
                    <span className="text-[10px] font-medium text-muted-foreground/40 w-4 flex-shrink-0 text-right">
                      {i + 1}
                    </span>
                    <span className="text-xs text-foreground/80">
                      {format(d, "EEE, MMM d · h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!startDay || previewDates.length === 0 || saving}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            {saving ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Repeat className="h-3 w-3" />
            )}
            Create {previewDates.length}{" "}
            {previewDates.length === 1 ? "entry" : "entries"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Draggable Card ─────────────────────────────────────────────────────────────

function PipelineCard({
  item,
  isDragging = false,
  onReschedule,
  onUnschedule,
  onRecurring,
}: {
  item: PipelineItem;
  isDragging?: boolean;
  onReschedule?: (item: PipelineItem, date: Date) => Promise<void>;
  onUnschedule?: (item: PipelineItem) => Promise<void>;
  onRecurring?: () => void;
}) {
  const [, setLocation] = useLocation();
  const [unscheduling, setUnscheduling] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const scheduled = item.scheduledAt ? parseISO(item.scheduledAt) : null;

  async function handleUnschedule(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onUnschedule) return;
    setUnscheduling(true);
    try {
      await onUnschedule(item);
    } finally {
      setUnscheduling(false);
    }
  }

  return (
    <>
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

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Recurring copy badge */}
            {item.sourceId !== null && (
              <span
                title="Recurring copy"
                className="flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded-full bg-violet-500/10 text-violet-400"
              >
                <Copy className="h-2.5 w-2.5" />
              </span>
            )}

            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                item.status === "published"
                  ? "bg-green-500/15 text-green-400"
                  : item.status === "scheduled"
                  ? "bg-violet-500/15 text-violet-400"
                  : "bg-yellow-500/15 text-yellow-400"
              }`}
            >
              {item.status}
            </span>

            {!isDragging && onUnschedule && item.status !== "published" && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleUnschedule}
                disabled={unscheduling}
                title="Unschedule — move back to draft"
                className="opacity-0 group-hover:opacity-100 flex items-center justify-center h-4 w-4 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                {unscheduling ? (
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <X className="h-2.5 w-2.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Date/time row with Quick Schedule + Recurring triggers */}
        <div className="flex items-center gap-1 pl-5">
          <Clock className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0" />
          <span className="text-[10px] text-muted-foreground flex-1 truncate">
            {scheduled
              ? format(scheduled, "EEE, MMM d · h:mm a")
              : "Not scheduled"}
          </span>
          {!isDragging && onReschedule && (
            <QuickSchedulePicker item={item} onReschedule={onReschedule} />
          )}
          {!isDragging && onRecurring && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setRecurringOpen(true);
              }}
              title="Set recurring schedule"
              className="flex items-center justify-center h-5 w-5 rounded hover:bg-violet-500/15 text-muted-foreground hover:text-violet-400 transition-colors flex-shrink-0"
            >
              <Repeat className="h-3 w-3" />
            </button>
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

      {/* Recurring dialog (rendered outside the draggable so it isn't clipped) */}
      {onRecurring && (
        <RecurringScheduleDialog
          item={item}
          open={recurringOpen}
          onOpenChange={setRecurringOpen}
          onCreated={() => onRecurring()}
        />
      )}
    </>
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
  onUnschedule,
  onRecurring,
}: {
  weekKey: string;
  weekStart: Date;
  items: PipelineItem[];
  today: Date;
  isOver: boolean;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
  onUnschedule: (item: PipelineItem) => Promise<void>;
  onRecurring: () => void;
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
            <DraggableCard
              key={item.id}
              item={item}
              onReschedule={onReschedule}
              onUnschedule={onUnschedule}
              onRecurring={onRecurring}
            />
          ))}
        </AnimatePresence>

        {items.length === 0 && (
          <div
            className={`h-full flex flex-col items-center justify-center py-8 text-center transition-all ${
              isOver ? "text-violet-400" : "text-muted-foreground/30"
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
  onUnschedule,
  onRecurring,
}: {
  item: PipelineItem;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
  onUnschedule: (item: PipelineItem) => Promise<void>;
  onRecurring: () => void;
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
      <PipelineCard
        item={item}
        isDragging={isDragging}
        onReschedule={onReschedule}
        onUnschedule={onUnschedule}
        onRecurring={onRecurring}
      />
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
  onUnschedule,
  onRecurring,
}: {
  weekKey: string;
  weekStart: Date;
  items: PipelineItem[];
  today: Date;
  onReschedule: (item: PipelineItem, date: Date) => Promise<void>;
  onUnschedule: (item: PipelineItem) => Promise<void>;
  onRecurring: () => void;
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
        onUnschedule={onUnschedule}
        onRecurring={onRecurring}
      />
    </div>
  );
}

// ── Main Pipeline Page ─────────────────────────────────────────────────────────

export default function ContentPipeline() {
  const today = new Date();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [weekOffset, setWeekOffset] = useState(0);
  const WEEKS_VISIBLE = 5;

  const {
    data: items = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<PipelineItem[]>({
    queryKey: ["/api/pipeline"],
    queryFn: fetchPipeline,
    refetchInterval: 60_000,
  });

  const [activeItem, setActiveItem] = useState<PipelineItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weeks: { key: string; start: Date }[] = [];
  for (let i = -1; i < WEEKS_VISIBLE; i++) {
    const start = addWeeks(thisWeekStart, i + weekOffset);
    weeks.push({ key: getWeekKey(start), start });
  }

  const grouped = useCallback((): Record<string, PipelineItem[]> => {
    const map: Record<string, PipelineItem[]> = {};
    for (const w of weeks) map[w.key] = [];
    for (const item of items) {
      if (!item.scheduledAt) continue;
      const d = parseISO(item.scheduledAt);
      const key = getWeekKey(d);
      if (map[key]) map[key].push(item);
    }
    return map;
  }, [items, weeks])();

  const visibleIds = new Set(Object.values(grouped).flat().map((i) => i.id));
  const outsideItems = items.filter((i) => !visibleIds.has(i.id));

  // ── Drag handlers ─────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    setActiveItem(event.active.data.current as PipelineItem);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;

    const draggedItem = active.data.current as PipelineItem;
    const targetWeekKey = over.id as string;

    if (draggedItem.scheduledAt) {
      const currentKey = getWeekKey(parseISO(draggedItem.scheduledAt));
      if (currentKey === targetWeekKey) return;
    }

    const targetWeekStart = weeks.find((w) => w.key === targetWeekKey)?.start;
    if (!targetWeekStart) return;

    let newDate: Date;
    if (draggedItem.scheduledAt) {
      const orig = parseISO(draggedItem.scheduledAt);
      const dayOfWeek = getDay(orig);
      newDate = setDay(targetWeekStart, dayOfWeek, { weekStartsOn: 1 });
      newDate.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
      if (isBefore(newDate, today)) {
        newDate = addDays(today, 1);
        newDate.setHours(9, 0, 0, 0);
      }
    } else {
      newDate = addDays(targetWeekStart, 2);
      newDate.setHours(9, 0, 0, 0);
    }

    queryClient.setQueryData<PipelineItem[]>(["/api/pipeline"], (prev = []) =>
      prev.map((i) =>
        i.id === draggedItem.id
          ? { ...i, scheduledAt: newDate.toISOString(), status: "scheduled" }
          : i
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

  // ── Unschedule handler ────────────────────────────────────────────────────

  async function handleUnschedule(item: PipelineItem) {
    queryClient.setQueryData<PipelineItem[]>(["/api/pipeline"], (prev = []) =>
      prev.filter((i) => i.id !== item.id)
    );
    try {
      await unscheduleItem(item.type, item.entityId);
      toast({
        title: "Moved to draft",
        description: `"${item.title}" has been unscheduled.`,
      });
    } catch (err: unknown) {
      toast({
        title: "Failed to unschedule",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      refetch();
    }
  }

  // ── Quick Schedule handler ────────────────────────────────────────────────

  async function handleQuickReschedule(item: PipelineItem, date: Date) {
    queryClient.setQueryData<PipelineItem[]>(["/api/pipeline"], (prev = []) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, scheduledAt: date.toISOString(), status: "scheduled" }
          : i
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

  // ── Recurring handler ─────────────────────────────────────────────────────

  function handleRecurring() {
    refetch();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Content Pipeline</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Drag cards between weeks to reschedule · {items.length} scheduled
            item{items.length !== 1 ? "s" : ""}
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
            <RefreshCw
              className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            />
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
        <span className="flex items-center gap-1.5">
          <Copy className="h-3 w-3 text-violet-400" /> Recurring copy
        </span>
        <span className="ml-auto flex items-center gap-1.5 italic opacity-70">
          <Repeat className="h-3 w-3" /> Click the repeat icon on any card to set a cadence
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
            Schedule a post or page, then use the{" "}
            <Repeat className="inline h-3 w-3" /> icon to set a recurring
            cadence.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
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
                  onUnschedule={handleUnschedule}
                  onRecurring={handleRecurring}
                />
              ))}
            </div>
          </div>

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
                <span className="text-muted-foreground truncate max-w-[160px]">
                  {item.title}
                </span>
                {item.scheduledAt && (
                  <span className="text-muted-foreground/50">
                    · {format(parseISO(item.scheduledAt), "MMM d")}
                  </span>
                )}
                {item.sourceId !== null && (
                  <Copy className="h-2.5 w-2.5 text-violet-400" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
