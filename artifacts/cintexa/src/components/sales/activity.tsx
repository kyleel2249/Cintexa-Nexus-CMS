import { useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales } from "@/lib/sales/api";
import { useSalesMutation } from "@/lib/sales/hooks";
import { useSales } from "@/context/SalesContext";
import { ACTIVITY_TYPES, PRIORITIES } from "@/lib/sales/enums";
import { dateTime, fromLocalInput } from "@/lib/sales/format";
import { FormModal, type FieldDef } from "./forms";
import { StatusBadge, Modal, Field, Textarea, Input, EmptyState, IconButton } from "./ui";

export interface ActivityRow {
  id: number; type: string; subject: string; description: string | null; status: string; priority: string; owner_id: number; owner_name: string | null;
  lead_id: number | null; account_id: number | null; contact_id: number | null; opportunity_id: number | null; start_at: string | null; due_at: string | null; completed_at: string | null;
  duration_minutes: number | null; outcome: string | null; overdue?: boolean; related_name?: string | null; recurrence?: { freq: string; interval: number } | null;
}

export interface ActivityLink { lead_id?: number; account_id?: number; opportunity_id?: number; contact_id?: number }

const FIELDS: FieldDef[] = [
  { name: "type", label: "Type", type: "select", options: ACTIVITY_TYPES, required: true },
  { name: "priority", label: "Priority", type: "select", options: PRIORITIES, required: true },
  { name: "subject", label: "Subject", required: true, wide: true },
  { name: "due_at", label: "Due", type: "datetime" },
  { name: "start_at", label: "Starts (meetings, events)", type: "datetime" },
  { name: "duration_minutes", label: "Duration (minutes)", type: "number", min: 0, max: 1440 },
  { name: "repeat", label: "Repeats", type: "select", options: [{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }] },
  { name: "repeat_interval", label: "Every N periods", type: "number", min: 1, max: 52, when: (v) => !!v.repeat },
  { name: "repeat_count", label: "Number of occurrences", type: "number", min: 1, max: 200, when: (v) => !!v.repeat },
  { name: "description", label: "Details", type: "textarea" },
];

export function ActivityFormModal({ open, onClose, link, initial }: { open: boolean; onClose: () => void; link?: ActivityLink; initial?: Record<string, unknown> }) {
  return (
    <FormModal
      open={open} onClose={onClose} title="New activity" fields={FIELDS} size="lg" submitLabel="Create activity" success="Activity created" invalidate={["/activities", "/leads", "/accounts", "/opportunities", "/dashboard"]}
      initial={{ type: "task", priority: "medium", ...initial }}
      submit={(b) => {
        const { repeat, repeat_interval, repeat_count, ...rest } = b as Record<string, unknown>;
        const recurrence = repeat ? { freq: repeat, interval: repeat_interval ?? 1, ...(repeat_count ? { count: repeat_count } : {}) } : undefined;
        return sales.post("/activities", { ...rest, ...link, ...(recurrence ? { recurrence } : {}) }, { idempotent: true });
      }}
    />
  );
}

/** Complete (with outcome and optional next step), snooze or cancel — all server-validated. */
export function ActivityActions({ a }: { a: ActivityRow }) {
  const { can } = useSales();
  const [mode, setMode] = useState<null | "complete" | "snooze">(null);
  const [outcome, setOutcome] = useState("");
  const [nextSubject, setNextSubject] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [due, setDue] = useState("");
  const inv = ["/activities", "/leads", "/accounts", "/opportunities", "/dashboard"];
  const complete = useSalesMutation(() => sales.post(`/activities/${a.id}/complete`, { outcome: outcome || undefined, next: nextSubject && nextDue ? { subject: nextSubject, type: "follow_up", due_at: fromLocalInput(nextDue) } : undefined }, { idempotent: true }), { invalidate: inv, success: "Activity completed", onSuccess: () => setMode(null) });
  const snooze = useSalesMutation(() => sales.post(`/activities/${a.id}/snooze`, { due_at: fromLocalInput(due) }), { invalidate: inv, success: "Snoozed", onSuccess: () => setMode(null) });
  const cancel = useSalesMutation(() => sales.post(`/activities/${a.id}/cancel`, {}), { invalidate: inv, success: "Activity cancelled" });
  if (a.status !== "open" || !can("activities:write")) return null;
  return (
    <>
      <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <IconButton label="Complete" onClick={() => setMode("complete")}><Check className="h-4 w-4" /></IconButton>
        <IconButton label="Snooze" onClick={() => setMode("snooze")}><Clock className="h-4 w-4" /></IconButton>
        <IconButton label="Cancel activity" disabled={cancel.pending} onClick={() => void cancel.run()}><X className="h-4 w-4" /></IconButton>
      </span>
      <Modal open={mode === "complete"} onClose={() => setMode(null)} title="Complete activity" description={a.subject} footer={<><Button variant="outline" onClick={() => setMode(null)}>Cancel</Button><Button disabled={complete.pending} onClick={() => void complete.run()}>{complete.pending ? "Saving…" : "Mark done"}</Button></>}>
        <Field label="Outcome"><Textarea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What happened? What was agreed?" /></Field>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Schedule the next step (optional)</p>
        <div className="grid gap-x-4 sm:grid-cols-2"><Field label="Next step"><Input value={nextSubject} onChange={(e) => setNextSubject(e.target.value)} /></Field><Field label="Due"><Input type="datetime-local" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></Field></div>
      </Modal>
      <Modal open={mode === "snooze"} onClose={() => setMode(null)} title="Snooze until" size="sm" footer={<><Button variant="outline" onClick={() => setMode(null)}>Cancel</Button><Button disabled={!due || snooze.pending} onClick={() => void snooze.run()}>Snooze</Button></>}>
        <Field label="New due time"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

export function ActivityList({ items, empty = "No activities yet" }: { items: ActivityRow[]; empty?: string }) {
  if (items.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y">
      {items.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{a.subject}</p>
            <p className="text-xs text-muted-foreground">{a.type.replace(/_/g, " ")} · {a.status === "done" ? `done ${dateTime(a.completed_at)}` : a.due_at ? `due ${dateTime(a.due_at)}` : "no due date"}{a.owner_name ? ` · ${a.owner_name}` : ""}</p>
            {a.outcome && <p className="mt-0.5 text-xs">{a.outcome}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2"><StatusBadge status={a.overdue && a.status === "open" ? "missed" : a.status} label={a.overdue && a.status === "open" ? "Overdue" : undefined} /><ActivityActions a={a} /></div>
        </li>
      ))}
    </ul>
  );
}
