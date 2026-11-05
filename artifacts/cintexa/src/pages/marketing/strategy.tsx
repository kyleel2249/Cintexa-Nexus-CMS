import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2 } from "lucide-react";
import { marketingIntel, marketingApi, marketingAssets } from "@/lib/marketing/api";

export default function MarketingStrategyPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [swotOpen, setSwotOpen] = useState(false);
  const [swotTitle, setSwotTitle] = useState("");
  const [swotQ, setSwotQ] = useState<"strength" | "weakness" | "opportunity" | "threat">("strength");
  const [objOpen, setObjOpen] = useState(false);
  const [objName, setObjName] = useState("");

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
      } catch { /* ignore */ }
    })();
  }, []);

  const strategies = useQuery({ queryKey: ["mkt", "strategies"], queryFn: () => marketingIntel.listStrategies() });
  const personas = useQuery({ queryKey: ["mkt", "personas"], queryFn: () => marketingIntel.listPersonas() });
  const swot = useQuery({ queryKey: ["mkt", "swot"], queryFn: () => marketingIntel.listSwot() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });

  const createStrategy = useMutation({
    mutationFn: () => marketingIntel.createStrategy({ name, status: "DRAFT", priority: "MEDIUM" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt"] }); setOpen(false); setName(""); },
  });
  const createSwot = useMutation({
    mutationFn: () => marketingIntel.createSwot({ title: swotTitle, quadrant: swotQ, assumption: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "swot"] }); setSwotOpen(false); setSwotTitle(""); },
  });
  const createObj = useMutation({
    mutationFn: () => marketingIntel.createObjective({
      name: objName,
      horizon: "quarterly",
      key_results: [{ id: crypto.randomUUID(), name: "Primary KR", baseline: 0, target: 100, current: 0, unit: "units", status: "on_track" }],
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "objectives"] }); setObjOpen(false); setObjName(""); },
  });

  const strat = strategies.data?.items || [];
  const people = personas.data?.items || [];
  const swotItems = swot.data?.items || [];
  const objs = objectives.data?.items || [];
  const byQ = (q: string) => swotItems.filter((s) => s.quadrant === q);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Strategy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Strategy, personas, SWOT and OKRs for CINTEXA — Assess → Apply technology → Improve and grow.
            Seed data is editable; nothing is fabricated as proven results.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New strategy</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create strategy</DialogTitle></DialogHeader>
            <div className="space-y-2 py-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || createStrategy.isPending} onClick={() => createStrategy.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="strategies">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="strategies">Strategies</TabsTrigger>
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="swot">SWOT</TabsTrigger>
          <TabsTrigger value="okrs">OKRs</TabsTrigger>
        </TabsList>

        <TabsContent value="strategies" className="space-y-3 mt-3">
          {strat.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <CardDescription>{s.positioning || s.mission || "—"}</CardDescription>
                  </div>
                  <Badge>{s.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {s.vision && <p><span className="text-muted-foreground">Vision:</span> {s.vision}</p>}
                {s.value_proposition && <p><span className="text-muted-foreground">Value:</span> {s.value_proposition}</p>}
                {s.channels?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">{s.channels.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</div>
                )}
              </CardContent>
            </Card>
          ))}
          {!strat.length && <p className="text-sm text-muted-foreground text-center py-8">No strategies yet.</p>}
        </TabsContent>

        <TabsContent value="personas" className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {people.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription>{p.category}{p.role ? ` · ${p.role}` : ""}{p.business_size ? ` · ${p.business_size}` : ""}</CardDescription>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  {p.pain_points?.length > 0 && <p><span className="font-medium">Pains:</span> {p.pain_points.join("; ")}</p>}
                  {p.recommended_message && <p className="text-muted-foreground italic">“{p.recommended_message}”</p>}
                  {p.conversion_offer && <Badge variant="secondary">{p.conversion_offer}</Badge>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="swot" className="mt-3 space-y-3">
          <div className="flex justify-end">
            <Dialog open={swotOpen} onOpenChange={setSwotOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add item</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>SWOT item</DialogTitle></DialogHeader>
                <div className="space-y-2">
                  <Label>Title</Label><Input value={swotTitle} onChange={(e) => setSwotTitle(e.target.value)} />
                  <Label>Quadrant</Label>
                  <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={swotQ} onChange={(e) => setSwotQ(e.target.value as any)}>
                    <option value="strength">Strength</option>
                    <option value="weakness">Weakness</option>
                    <option value="opportunity">Opportunity</option>
                    <option value="threat">Threat</option>
                  </select>
                </div>
                <DialogFooter>
                  <Button disabled={!swotTitle.trim() || createSwot.isPending} onClick={() => createSwot.mutate()}>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(["strength", "weakness", "opportunity", "threat"] as const).map((q) => (
              <Card key={q}>
                <CardHeader className="pb-2"><CardTitle className="text-sm capitalize">{q}s</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {byQ(q).map((item) => (
                    <div key={item.id} className="rounded-md border px-2 py-1.5 text-sm flex justify-between gap-2">
                      <div>
                        <p className="font-medium">{item.title}</p>
                        {item.assumption && <span className="text-[10px] text-muted-foreground">Assumption</span>}
                        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => marketingIntel.deleteSwot(item.id).then(() => qc.invalidateQueries({ queryKey: ["mkt", "swot"] }))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {!byQ(q).length && <p className="text-xs text-muted-foreground">None yet</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="okrs" className="mt-3 space-y-3">
          <div className="flex justify-end">
            <Dialog open={objOpen} onOpenChange={setObjOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Objective</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New objective</DialogTitle></DialogHeader>
                <div className="space-y-2"><Label>Name</Label><Input value={objName} onChange={(e) => setObjName(e.target.value)} /></div>
                <DialogFooter>
                  <Button disabled={!objName.trim() || createObj.isPending} onClick={() => createObj.mutate()}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {objs.map((o) => {
            const pct = marketingIntel.objectiveProgress(o);
            return (
              <Card key={o.id}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between gap-2">
                    <CardTitle className="text-base">{o.name}</CardTitle>
                    <Badge variant="secondary">{o.horizon}</Badge>
                  </div>
                  {o.description && <CardDescription>{o.description}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Progress value={pct} className="h-2 flex-1" />
                    <span className="text-xs tabular-nums w-12 text-right">{pct}%</span>
                  </div>
                  {o.key_results.map((kr) => (
                    <div key={kr.id} className="text-xs flex justify-between border rounded px-2 py-1">
                      <span>{kr.name}</span>
                      <span className="tabular-nums text-muted-foreground">{kr.current} / {kr.target} {kr.unit}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
