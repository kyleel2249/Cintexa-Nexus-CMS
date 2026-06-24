import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, isFuture } from "date-fns";
import {
  Calendar,
  Clock,
  X,
  Send,
  Loader2,
  CalendarClock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SchedulePanelProps {
  entityId: number;
  currentScheduledAt: string | null | undefined;
  onSchedule: (id: number, scheduledAt: string) => Promise<void>;
  onUnschedule: (id: number) => Promise<void>;
  onSuccess: () => void;
}

export function SchedulePanel({
  entityId,
  currentScheduledAt,
  onSchedule,
  onUnschedule,
  onSuccess,
}: SchedulePanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Minimum datetime is "now + 1 minute" so the user can't pick the past
  const minDateTime = new Date(Date.now() + 60_000);
  const minDateTimeLocal = new Date(minDateTime.getTime() - minDateTime.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  // Default to tomorrow at 9 AM for convenience
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const defaultValue = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  const [pickedDate, setPickedDate] = useState(defaultValue);

  const isScheduled = !!(currentScheduledAt && isFuture(new Date(currentScheduledAt)));

  async function handleSchedule() {
    if (!pickedDate) return;
    const isoDate = new Date(pickedDate).toISOString();
    setIsSaving(true);
    try {
      await onSchedule(entityId, isoDate);
      toast({
        title: "Scheduled!",
        description: `Will publish ${format(new Date(isoDate), "MMM d, yyyy 'at' h:mm a")}`,
      });
      setOpen(false);
      onSuccess();
    } catch {
      toast({ title: "Scheduling failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnschedule() {
    setIsCancelling(true);
    try {
      await onUnschedule(entityId);
      toast({ title: "Schedule cancelled", description: "Content reverted to draft." });
      onSuccess();
    } catch {
      toast({ title: "Failed to cancel schedule", variant: "destructive" });
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <div className="space-y-2.5">
      {/* Current schedule banner */}
      <AnimatePresence>
        {isScheduled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg bg-violet-500/10 border border-violet-500/25 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-violet-400 text-[10px] font-semibold uppercase tracking-wide">
                <CalendarClock className="h-3 w-3" />
                Scheduled to publish
              </div>
              <p className="text-xs font-medium text-foreground">
                {format(new Date(currentScheduledAt!), "EEE, MMM d yyyy 'at' h:mm a")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(currentScheduledAt!), { addSuffix: true })}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUnschedule}
                disabled={isCancelling}
                className="h-6 text-[10px] px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 w-full mt-1"
              >
                {isCancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <X className="h-3 w-3 mr-1" />
                )}
                Cancel schedule
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schedule toggle */}
      {!isScheduled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className="w-full h-8 text-xs gap-1.5 border-dashed"
        >
          <Calendar className="h-3.5 w-3.5" />
          Schedule publish
        </Button>
      )}

      {/* Date/time picker */}
      <AnimatePresence>
        {open && !isScheduled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> Publish date & time
                </Label>
                <input
                  type="datetime-local"
                  value={pickedDate}
                  min={minDateTimeLocal}
                  onChange={(e) => setPickedDate(e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {pickedDate && (
                  <p className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(pickedDate), { addSuffix: true })}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  className="flex-1 h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSchedule}
                  disabled={isSaving || !pickedDate}
                  className="flex-1 h-7 text-xs bg-violet-600 hover:bg-violet-500 text-white"
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Send className="h-3 w-3 mr-1" />
                  )}
                  Set schedule
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
