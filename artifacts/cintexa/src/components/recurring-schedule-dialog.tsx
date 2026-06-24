import { useState, useMemo } from "react";
import { format, addDays, startOfDay, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CalendarRange, Clock, Check, Loader2, CalendarDays, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RecurringScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: number;
  sourceTitle: string;
  type: "post" | "page";
  onSuccess: () => void;
}

const DAYS = [
  { label: "S", full: "Sunday",    value: 0 },
  { label: "M", full: "Monday",    value: 1 },
  { label: "T", full: "Tuesday",   value: 2 },
  { label: "W", full: "Wednesday", value: 3 },
  { label: "T", full: "Thursday",  value: 4 },
  { label: "F", full: "Friday",    value: 5 },
  { label: "S", full: "Saturday",  value: 6 },
];

function generateDates(
  daysOfWeek: Set<number>,
  startDate: Date,
  occurrences: number,
  time: string
): Date[] {
  if (daysOfWeek.size === 0 || occurrences <= 0) return [];
  const [h, m] = time.split(":").map(Number);
  const dates: Date[] = [];
  let cursor = startOfDay(startDate);
  let safety = 0;
  while (dates.length < occurrences && safety < 365) {
    if (daysOfWeek.has(cursor.getDay())) {
      const d = new Date(cursor);
      d.setHours(h, m, 0, 0);
      if (d > new Date()) dates.push(d);
    }
    cursor = addDays(cursor, 1);
    safety++;
  }
  return dates;
}

export function RecurringScheduleDialog({
  open,
  onOpenChange,
  sourceId,
  sourceTitle,
  type,
  onSuccess,
}: RecurringScheduleDialogProps) {
  const { toast } = useToast();

  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set([1]));
  const [time, setTime] = useState("09:00");
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [occurrences, setOccurrences] = useState(4);
  const [isGenerating, setIsGenerating] = useState(false);

  const previewDates = useMemo(
    () => generateDates(selectedDays, startDate, occurrences, time),
    [selectedDays, startDate, occurrences, time]
  );

  function toggleDay(d: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) {
        if (next.size === 1) return prev;
        next.delete(d);
      } else {
        next.add(d);
      }
      return next;
    });
  }

  async function handleGenerate() {
    if (previewDates.length === 0) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/${type}s/${sourceId}/recurring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledDates: previewDates.map((d) => d.toISOString()),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to generate schedule");
      }
      const result = await res.json();
      toast({
        title: `${result.created} copies scheduled`,
        description: `"${sourceTitle}" — recurring series created from ${format(previewDates[0], "MMM d")} to ${format(previewDates[previewDates.length - 1], "MMM d, yyyy")}`,
      });
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast({ title: err.message || "Generation failed", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  }

  const dayPattern = DAYS.filter((d) => selectedDays.has(d.value))
    .map((d) => d.full)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-violet-400" />
            Recurring Schedule
          </DialogTitle>
          <DialogDescription className="truncate">
            Auto-generate copies of &ldquo;{sourceTitle}&rdquo; pre-scheduled across multiple weeks
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Day-of-week toggles */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Repeat on</label>
            <div className="flex gap-2">
              {DAYS.map((day) => {
                const active = selectedDays.has(day.value);
                return (
                  <button
                    key={day.value}
                    title={day.full}
                    onClick={() => toggleDay(day.value)}
                    className={`w-9 h-9 rounded-full text-xs font-semibold transition-all border ${
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-secondary/60 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            {dayPattern && (
              <p className="text-[11px] text-muted-foreground">Every {dayPattern}</p>
            )}
          </div>

          {/* Time + start date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Time</label>
              <div className="flex items-center gap-2 border border-border rounded-md px-2.5 py-1.5 bg-background">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-6 border-0 p-0 text-sm bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Starting from</label>
              <Popover open={startPickerOpen} onOpenChange={setStartPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-9 justify-start text-sm gap-2 font-normal">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    {format(startDate, "MMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(d) => { if (d) { setStartDate(d); setStartPickerOpen(false); } }}
                    disabled={(d) => d < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Occurrences */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Number of copies
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={24}
                value={occurrences}
                onChange={(e) => setOccurrences(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-semibold tabular-nums w-6 text-center">{occurrences}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {previewDates.length} date{previewDates.length !== 1 ? "s" : ""} will be scheduled
              {previewDates.length < occurrences && (
                <span className="text-amber-400"> (some skipped — in the past)</span>
              )}
            </p>
          </div>

          {/* Date preview */}
          {previewDates.length > 0 && (
            <div className="space-y-1.5">
              <Separator />
              <div className="flex items-center gap-2 pt-1">
                <CalendarRange className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Schedule preview</span>
              </div>
              <ScrollArea className="h-36 rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div className="space-y-1">
                  {previewDates.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground tabular-nums w-4">{i + 1}.</span>
                      <span className="text-foreground">{format(d, "EEEE, MMM d, yyyy")}</span>
                      <span className="text-muted-foreground ml-auto">{format(d, "h:mm a")}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {previewDates.length === 0 && selectedDays.size > 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No future dates match your pattern. Try a later start date.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-2"
            disabled={previewDates.length === 0 || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {isGenerating
              ? "Generating…"
              : `Generate ${previewDates.length} cop${previewDates.length !== 1 ? "ies" : "y"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
