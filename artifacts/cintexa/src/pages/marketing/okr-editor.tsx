import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { marketingIntel, marketingApi, marketingAssets } from "@/lib/marketing/api";
import type { KeyResult } from "@/lib/marketing/entities";

export default function OkrEditorPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [horizon, setHorizon] = useState<"annual" | "quarterly" | "monthly" | "campaign">("quarterly");
  const [editId, setEditId] = useState<number | null>(null);
  const [krTitle, setKrTitle] = useState("");
  const [krBaseline, setKrBaseline] = useState("0");
  const [krTarget, setKrTarget] = useState("100");
  const [krCurrent, setKrCurrent] = useState("0");
  const [krUnit, setKrUnit] = useState("units");

  useEffect(() => {
    marketingIntel.ensureSeed();
    (async () => {
      try {
        const ov = await marketingApi.overview();
        await marketingAssets.syncOkrs({
          activeCampaigns: ov.kpis.activeCampaigns,
          leadsGenerated: ov.kpis.leadsGenerated,
          qualifiedLeads: ov.kpis.qualifiedLeads,
          contentItems: ov.kpis.contentItems || 0,
        });
        qc.invalidateQueries({ queryKey: ["mkt", "objectives"] });
      } catch { /* */ }
    })();
  }, []);

  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });

  const create = useMutation({
    mutationFn: () =>
      marketingIntel.createObjective({
        name,
        description: desc || undefined,
        horizon,
        key_results: [
          {
            id: crypto.randomUUID(),
            name: "Primary key result",
            baseline: 0,
            target: 100,
            current: 0,
            unit: "units",
            status: "on_track",
          },
        ],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt"] });
      setOpen(false);
      setName("");
      setDesc("");
    },
  });

  const saveObj = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) => marketingIntel.updateObjective(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "objectives"] }),
  });

  const addKr = (objId: number, existing: KeyResult[]) => {
    if (!krTitle.trim()) return;
    const kr: KeyResult = {
      id: crypto.randomUUID(),
      name: krTitle.trim(),
      baseline: Number(krBaseline) || 0,
      target: Number(krTarget) || 0,
      current: Number(krCurrent) || 0,
      unit: krUnit || "units",
      status: "on_track",
    };
    saveObj.mutate({ id: objId, patch: { key_results: [...existing, kr] } });
    setKrTitle("");
    setEditId(null);
  };

  const updateKrCurrent = (objId: number, krs: KeyResult[], krId: string, current: number) => {
    const next = krs.map((k) => {
      if (k.id !== krId) return k;
      const span = k.target - k.baseline;
      let status = "on_track";
      if (span !== 0) {
        const pct = (current - k.baseline) / span;
        status = pct >= 1 ? "completed" : pct >= 0.5 ? "on_track" : "at_risk";
      }
      return { ...k, current, status };
    });
    saveObj.mutate({ id: objId, patch: { key_results: next } });
  };

  const removeKr = (objId: number, krs: KeyResult[], krId: string) => {
    saveObj.mutate({ id: objId, patch: { key_results: krs.filter((k) => k.id !== krId) } });
  };

  const [showArchived, setShowArchived] = useState(false);
  const items = (objectives.data?.items || []).filter((o) => showArchived || o.status !== "ARCHIVED");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OKR Editor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full objective and key-result editing. Progress = (current − baseline) ÷ (target − baseline). Currents can auto-sync from local leads/campaigns.
          </p>
        </div>
        <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Objective</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New objective</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div><Label>Title</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Description</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} /></div>
              <div>
                <Label>Horizon</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={horizon} onChange={(e) => setHorizon(e.target.value as any)}>
                  <option value="annual">Annual</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="monthly">Monthly</option>
                  <option value="campaign">Campaign</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {items.map((o) => {
        const pct = marketingIntel.objectiveProgress(o);
        return (
          <Card key={o.id}>
            <CardHeader className="pb-2">
              <div className="flex justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{o.name}</CardTitle>
                  {o.description && <CardDescription>{o.description}</CardDescription>}
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <Badge variant="secondary">{o.horizon}</Badge>
                  <Badge variant="outline">{o.status}</Badge>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => marketingIntel.duplicateObjective(o.id).then(() => qc.invalidateQueries({ queryKey: ["mkt"] }))}>Duplicate</Button>
                  {o.status !== "ARCHIVED" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => marketingIntel.archiveObjective(o.id).then(() => qc.invalidateQueries({ queryKey: ["mkt"] }))}>Archive</Button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Progress value={pct} className="h-2 flex-1" />
                <span className="text-xs tabular-nums w-12 text-right">{pct}%</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {o.key_results.map((kr) => (
                <div key={kr.id} className="rounded-md border px-3 py-2 space-y-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium">{kr.name}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeKr(o.id, o.key_results, kr.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <Label className="text-[10px]">Baseline</Label>
                      <Input className="h-8" type="number" defaultValue={kr.baseline} onBlur={(e) => {
                        const baseline = Number(e.target.value) || 0;
                        saveObj.mutate({
                          id: o.id,
                          patch: { key_results: o.key_results.map((k) => (k.id === kr.id ? { ...k, baseline } : k)) },
                        });
                      }} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Target</Label>
                      <Input className="h-8" type="number" defaultValue={kr.target} onBlur={(e) => {
                        const target = Number(e.target.value) || 0;
                        saveObj.mutate({
                          id: o.id,
                          patch: { key_results: o.key_results.map((k) => (k.id === kr.id ? { ...k, target } : k)) },
                        });
                      }} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Current</Label>
                      <Input
                        className="h-8"
                        type="number"
                        defaultValue={kr.current}
                        onBlur={(e) => updateKrCurrent(o.id, o.key_results, kr.id, Number(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{kr.unit} · {kr.status}</p>
                </div>
              ))}

              {editId === o.id ? (
                <div className="rounded-md border border-dashed p-3 space-y-2">
                  <Input placeholder="Key result title" value={krTitle} onChange={(e) => setKrTitle(e.target.value)} />
                  <div className="grid grid-cols-4 gap-2">
                    <Input placeholder="Baseline" value={krBaseline} onChange={(e) => setKrBaseline(e.target.value)} />
                    <Input placeholder="Target" value={krTarget} onChange={(e) => setKrTarget(e.target.value)} />
                    <Input placeholder="Current" value={krCurrent} onChange={(e) => setKrCurrent(e.target.value)} />
                    <Input placeholder="Unit" value={krUnit} onChange={(e) => setKrUnit(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => addKr(o.id, o.key_results)}>Add KR</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditId(o.id)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Key result
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
      {!items.length && <p className="text-sm text-muted-foreground text-center py-8">No objectives yet.</p>}
    </div>
  );
}
