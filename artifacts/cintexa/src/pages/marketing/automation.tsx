import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Play } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";

const TRIGGERS = [
  "lead.created",
  "campaign.approved",
  "campaign.ended",
  "content.approved",
  "email.ready",
];

export default function MarketingAutomation() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("lead.created");
  const [description, setDescription] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "automations"],
    queryFn: () => marketingApi.listAutomations(),
  });

  const create = useMutation({
    mutationFn: () =>
      marketingApi.createAutomation({
        name,
        trigger_event: trigger,
        description: description || null,
        enabled: true,
        actions: [{ type: "notify", message: "Automation fired" }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "automations"] });
      setOpen(false);
      setName("");
      setDescription("");
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      marketingApi.updateAutomation(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "automations"] }),
  });

  const run = useMutation({
    mutationFn: (id: number) => marketingApi.runAutomation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "automations"] }),
  });

  const items = data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Automation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rule-based workflows on marketing events. Runs locally on this device — no external automation platforms.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New rule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create automation</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New lead follow-up" /></div>
              <div>
                <Label>Trigger</Label>
                <Select value={trigger} onValueChange={setTrigger}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rules</CardTitle>
          <CardDescription>Enable/disable and run manually to verify. Destructive actions are not executed automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>}
          {!isLoading && items.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No automations yet.</p>}
          {items.map((a) => (
            <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">When <code className="text-[11px]">{a.trigger_event}</code> · runs {a.run_count}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Switch checked={a.enabled} onCheckedChange={(v) => toggle.mutate({ id: a.id, enabled: v })} />
                  <span className="text-xs text-muted-foreground">{a.enabled ? "On" : "Off"}</span>
                </div>
                <Button size="sm" variant="outline" disabled={!a.enabled || run.isPending} onClick={() => run.mutate(a.id)}>
                  <Play className="h-3.5 w-3.5 mr-1" /> Run
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
