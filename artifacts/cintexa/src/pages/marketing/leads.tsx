import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingApi, marketingIntel } from "@/lib/marketing/api";
import { probeSalesLocal } from "@/lib/marketing/sales-bridge";
import { attributeLeadsBySource } from "@/lib/marketing/attribution";
import { useMarketingSubscription } from "@/lib/marketing/useMarketingSubscription";
import { Link } from "wouter";

export default function LeadGeneration() {
  const qc = useQueryClient();
  useMarketingSubscription();
  const [salesBridge, setSalesBridge] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [score, setScore] = useState("0");

  useEffect(() => {
    marketingIntel.ensureSeed();
    probeSalesLocal().then((s) => {
      setSalesBridge(s.available ? s.note : s.reason);
    });
  }, []);

  const settings = useQuery({ queryKey: ["mkt", "settings"], queryFn: () => marketingIntel.getSettings() });
  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "leads"],
    queryFn: () => marketingApi.listLeads(),
  });

  const create = useMutation({
    mutationFn: () =>
      marketingApi.createLead({
        name,
        email: email || null,
        source: source || null,
        score: Number(score) || 0,
        status: "new",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      setOpen(false);
      setName("");
      setEmail("");
      setSource("");
      setScore("0");
    },
  });

  const qualify = useMutation({
    mutationFn: (id: number) => marketingApi.updateLead(id, { status: "qualified", score: 60 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "leads"] }),
  });

  const items = data?.items || [];
  const channels = settings.data?.channels || [];
  const model = settings.data?.attribution_model || "last_touch";
  const attr = useMemo(() => attributeLeadsBySource(items as any, model), [items, model]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Generation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Marketing-sourced leads on this device. CRM pipeline:{" "}
            <Link href="/sales/leads" className="underline">Sales → Leads</Link>.
            {salesBridge && <span className="block text-xs mt-1">{salesBridge}</span>}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add lead</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New marketing lead</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div>
                <Label>Source channel</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm mb-1" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">— Select or type —</option>
                  {channels.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Or free-text source" className="mt-1" />
              </div>
              <div><Label>Score</Label><Input type="number" value={score} onChange={(e) => setScore(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Source distribution</CardTitle>
          <CardDescription>
            Model preference: <Badge variant="outline" className="text-[10px]">{model}</Badge>{" "}
            — {attr.limitation}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {attr.buckets.map((b) => (
            <div key={b.source} className="flex items-center gap-2 text-sm">
              <span className="w-28 truncate font-medium">{b.source}</span>
              <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${Math.min(100, b.share)}%` }} />
              </div>
              <span className="text-xs tabular-nums w-16 text-right">{b.count} · {b.share}%</span>
            </div>
          ))}
          {!attr.total && <p className="text-xs text-muted-foreground">No leads yet — distribution empty.</p>}
          <Badge variant="secondary" className="text-[10px] mt-1">MANUAL / SINGLE-SOURCE</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Leads</CardTitle>
          <CardDescription>{items.length} marketing leads (not Sales CRM copies)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>}
          {items.map((lead: any) => (
            <div key={lead.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{lead.name}</p>
                <p className="text-xs text-muted-foreground">
                  {lead.email || "No email"} · {lead.source || "No source"} · score {lead.score ?? 0}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline">{lead.status}</Badge>
                {lead.status !== "qualified" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => qualify.mutate(lead.id)}>
                    Qualify
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!isLoading && !items.length && (
            <p className="text-sm text-muted-foreground text-center py-6">No marketing leads yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
