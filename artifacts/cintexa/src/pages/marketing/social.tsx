import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check } from "lucide-react";
import { apiJson } from "@/lib/api";

const CHANNELS = ["facebook", "instagram", "linkedin", "tiktok", "x", "youtube", "other"];
const STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "READY_TO_PUBLISH", "PUBLISHED_MANUALLY", "FAILED", "CANCELLED"];

type CalEvent = {
  id: number;
  title: string;
  status: string;
  channel?: string;
  starts_at: string;
  event_type?: string;
  description?: string;
};

export default function SocialMediaManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("linkedin");
  const [startsAt, setStartsAt] = useState("");
  const [caption, setCaption] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "calendar"],
    queryFn: () => apiJson<{ items: CalEvent[]; total: number }>("/marketing/calendar"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiJson("/marketing/calendar", {
        method: "POST",
        body: JSON.stringify({
          title,
          channel,
          starts_at: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
          event_type: "social",
          status: "DRAFT",
          description: caption,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "calendar"] });
      setOpen(false);
      setTitle("");
      setCaption("");
      setStartsAt("");
    },
  });

  const confirmPublish = useMutation({
    mutationFn: (id: number) =>
      apiJson(`/marketing/calendar/${id}/confirm-published`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "calendar"] }),
  });

  const items = (data?.items || []).filter((e) => e.event_type === "social" || e.channel);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social Media Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan posts and captions for Facebook, Instagram, LinkedIn, TikTok, X and YouTube.
            <strong className="font-medium"> No external APIs</strong> — mark as published only after you post manually.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Plan post</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Plan social post</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Title / label</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch teaser" />
              </div>
              <div>
                <Label>Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scheduled time</Label>
                <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <Label>Caption (copy-ready)</Label>
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="Write the caption to copy into the platform…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Save plan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Publishing queue</CardTitle>
          <CardDescription>Statuses never claim external publish unless you confirm manually.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
          {!isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">No social posts planned yet.</p>
          )}
          {items.map((e) => (
            <div key={e.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {e.channel || "—"} · {e.starts_at ? new Date(e.starts_at).toLocaleString() : "—"}
                </p>
                {e.description && <p className="text-xs mt-1 line-clamp-2 text-muted-foreground">{e.description}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary">{e.status}</Badge>
                {e.status !== "PUBLISHED_MANUALLY" && e.status !== "CANCELLED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={confirmPublish.isPending}
                    onClick={() => confirmPublish.mutate(e.id)}
                    title="Confirm you published this manually on the platform"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Mark published
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
