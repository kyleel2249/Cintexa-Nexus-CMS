import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { marketingApi, marketingIntel, marketingAssets } from "@/lib/marketing/api";
import { ArrowLeft } from "lucide-react";
import { BrandIntelligencePanel } from "@/components/marketing/BrandIntelligencePanel";

const NEXT: Record<string, string[]> = {
  DRAFT: ["PLANNED", "ARCHIVED"],
  PLANNED: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["ACTIVE", "PLANNED", "ARCHIVED"],
  ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export default function CampaignDetail() {
  const [, params] = useRoute("/marketing/campaigns/:id");
  const id = Number(params?.id);
  const qc = useQueryClient();

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const campaign = useQuery({
    queryKey: ["marketing", "campaign", id],
    enabled: Number.isFinite(id),
    queryFn: () => marketingApi.getCampaign(id),
  });
  const strategies = useQuery({ queryKey: ["mkt", "strategies"], queryFn: () => marketingIntel.listStrategies() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });
  const personas = useQuery({ queryKey: ["mkt", "personas"], queryFn: () => marketingIntel.listPersonas() });
  const funnels = useQuery({ queryKey: ["mkt", "funnels"], queryFn: () => marketingIntel.listFunnels() });
  const brands = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.listBrands() });
  const assets = useQuery({ queryKey: ["mkt", "assets"], queryFn: () => marketingAssets.list() });

  const [strategyId, setStrategyId] = useState<string>("");
  const [objectiveId, setObjectiveId] = useState<string>("");
  const [personaId, setPersonaId] = useState<string>("");
  const [funnelId, setFunnelId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");

  useEffect(() => {
    const meta = (campaign.data as any)?.metadata || {};
    setStrategyId(meta.strategy_id != null ? String(meta.strategy_id) : "");
    setObjectiveId(meta.objective_id != null ? String(meta.objective_id) : "");
    setPersonaId(meta.persona_id != null ? String(meta.persona_id) : "");
    setFunnelId(meta.funnel_id != null ? String(meta.funnel_id) : "");
    setBrandId(meta.brand_id != null ? String(meta.brand_id) : "");
  }, [campaign.data?.id]);

  const transition = useMutation({
    mutationFn: (status: string) => marketingApi.transitionCampaign(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing"] }),
  });

  const saveLinks = useMutation({
    mutationFn: async () => {
      const row = await marketingApi.updateCampaign(id, {
        metadata: {
          ...((campaign.data as any)?.metadata || {}),
          strategy_id: strategyId ? Number(strategyId) : null,
          objective_id: objectiveId ? Number(objectiveId) : null,
          persona_id: personaId ? Number(personaId) : null,
          funnel_id: funnelId ? Number(funnelId) : null,
          brand_id: brandId ? Number(brandId) : null,
        },
      } as any);
      try {
        await marketingIntel.logActivity({
          action: "linked",
          entity_type: "campaign",
          entity_id: id,
          summary: `Campaign links updated: ${campaign.data?.name || id}`,
        });
      } catch { /* */ }
      return row;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "campaign", id] });
      qc.invalidateQueries({ queryKey: ["mkt", "activity"] });
      qc.invalidateQueries({ queryKey: ["marketing", "campaigns"] });
    },
  });

  const linkAsset = useMutation({
    mutationFn: (assetId: number) => {
      const a = (assets.data?.items || []).find((x) => x.id === assetId);
      if (!a) return Promise.reject(new Error("Asset not found"));
      const ids = Array.from(new Set([...(a.campaign_ids || []), id]));
      return marketingAssets.update(assetId, { campaign_ids: ids });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "assets"] }),
  });

  if (campaign.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (campaign.error || !campaign.data) return <div className="p-6 text-sm text-destructive">Campaign not found.</div>;

  const c = campaign.data as any;
  const next = NEXT[c.status] || [];
  const linkedAssets = (assets.data?.items || []).filter((a) => (a.campaign_ids || []).includes(id));
  const obj = (objectives.data?.items || []).find((o) => String(o.id) === objectiveId);
  const funnel = (funnels.data?.items || []).find((f) => String(f.id) === funnelId);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/marketing/campaigns"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{c.name}</h1>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge>{c.status}</Badge>
            <Badge variant="outline">{c.number}</Badge>
            <span className="text-xs text-muted-foreground">Budget {c.budget} · Spent {c.spent}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button key={s} size="sm" variant="outline" disabled={transition.isPending} onClick={() => transition.mutate(s)}>
            → {s}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Integration hub</CardTitle>
              <CardDescription>Link strategy, OKRs, personas, brand, and funnels. One campaign, shared records.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Strategy</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={strategyId} onChange={(e) => setStrategyId(e.target.value)}>
                  <option value="">— None —</option>
                  {(strategies.data?.items || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Objective / OKR</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={objectiveId} onChange={(e) => setObjectiveId(e.target.value)}>
                  <option value="">— None —</option>
                  {(objectives.data?.items || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Persona</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                  <option value="">— None —</option>
                  {(personas.data?.items || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Brand</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  <option value="">— Default —</option>
                  {(brands.data?.items || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Funnel</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={funnelId} onChange={(e) => setFunnelId(e.target.value)}>
                  <option value="">— None —</option>
                  {(funnels.data?.items || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Button size="sm" disabled={saveLinks.isPending} onClick={() => saveLinks.mutate()}>
                  {saveLinks.isPending ? "Saving…" : "Save links"}
                </Button>
              </div>
              <div className="sm:col-span-2 text-xs text-muted-foreground space-y-0.5">
                {strategyId && <p>Strategy: {(strategies.data?.items || []).find((s) => String(s.id) === strategyId)?.name || strategyId}</p>}
                {objectiveId && <p>OKR: {(objectives.data?.items || []).find((o) => String(o.id) === objectiveId)?.name || objectiveId}</p>}
                {personaId && <p>Persona: {(personas.data?.items || []).find((p) => String(p.id) === personaId)?.name || personaId}</p>}
                {funnelId && <p>Funnel: {(funnels.data?.items || []).find((f) => String(f.id) === funnelId)?.name || funnelId}</p>}
                {brandId && <p>Brand: {(brands.data?.items || []).find((b) => String(b.id) === brandId)?.name || brandId}</p>}
              </div>
            </CardContent>
          </Card>

          {obj && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Linked OKR progress</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">{obj.name}</p>
                <p className="text-xs text-muted-foreground">{marketingIntel.objectiveProgress(obj)}% · shared objective record</p>
              </CardContent>
            </Card>
          )}

          {funnel && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Linked funnel</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                <p className="font-medium text-sm">{funnel.name}</p>
                {funnel.stages.map((st) => (
                  <div key={st.id} className="flex justify-between border rounded px-2 py-1">
                    <span>{st.name}</span>
                    <span className="tabular-nums">{st.actual_count ?? 0} <Badge variant="outline" className="text-[9px] ml-1">MANUAL</Badge></span>
                  </div>
                ))}
                <Link href="/marketing/landing" className="underline text-muted-foreground">Edit funnel counts</Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Assets</CardTitle>
              <CardDescription>Associate registered marketing asset refs (not file copies).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {linkedAssets.map((a) => (
                <div key={a.id} className="text-sm border rounded px-2 py-1 flex justify-between">
                  <span>{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.media_id != null ? `Media #${a.media_id}` : "manual"}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-1">
                {(assets.data?.items || [])
                  .filter((a) => !(a.campaign_ids || []).includes(id))
                  .slice(0, 8)
                  .map((a) => (
                    <Button key={a.id} size="sm" variant="outline" className="h-7 text-xs" onClick={() => linkAsset.mutate(a.id)}>
                      + {a.name}
                    </Button>
                  ))}
              </div>
              {!linkedAssets.length && <p className="text-xs text-muted-foreground">No assets linked yet.</p>}
            </CardContent>
          </Card>

          {c.description && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Description</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">{c.description}</CardContent>
            </Card>
          )}

          {(c.activities || []).length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Activity</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-xs">
                {(c.activities || []).slice().reverse().map((a: any, i: number) => (
                  <div key={i} className="flex justify-between gap-2 border-b border-border/40 py-1">
                    <span>{a.summary || a.action}</span>
                    <span className="text-muted-foreground shrink-0">{a.at ? new Date(a.at).toLocaleString() : ""}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <BrandIntelligencePanel compact />
      </div>
    </div>
  );
}
