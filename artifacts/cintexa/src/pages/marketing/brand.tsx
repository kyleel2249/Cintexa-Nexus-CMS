import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { marketingIntel } from "@/lib/marketing/api";

export default function BrandManagementPage() {
  const qc = useQueryClient();
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimText, setClaimText] = useState("");
  const [editMission, setEditMission] = useState("");
  const [editPositioning, setEditPositioning] = useState("");

  useEffect(() => { marketingIntel.ensureSeed(); }, []);

  const brands = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.listBrands() });
  const brand = brands.data?.items?.[0];
  const claims = useQuery({
    queryKey: ["mkt", "claims", brand?.id],
    enabled: !!brand?.id,
    queryFn: () => marketingIntel.listClaims(brand!.id),
  });

  useEffect(() => {
    if (brand) {
      setEditMission(brand.mission || "");
      setEditPositioning(brand.positioning || "");
    }
  }, [brand?.id]);

  const saveBrand = useMutation({
    mutationFn: () => marketingIntel.updateBrand(brand!.id, { mission: editMission, positioning: editPositioning }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "brands"] }),
  });

  const addClaim = useMutation({
    mutationFn: () => marketingIntel.createClaim({ brand_id: brand!.id, text: claimText, status: "unverified", category: "claim" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "claims"] }); setClaimOpen(false); setClaimText(""); },
  });

  if (!brand) return <div className="p-6 text-sm text-muted-foreground">Loading brand…</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Canonical brand profile for {brand.name}. Content, campaigns and landing tools should reference this profile — not copies.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{brand.name}</CardTitle>
          <CardDescription>{brand.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[brand.primary_color, brand.secondary_color, brand.accent_color, brand.bg_color].map((c) => (
              <div key={c} className="flex items-center gap-2 text-xs">
                <span className="h-8 w-8 rounded-md border shadow-inner" style={{ background: c }} />
                <code>{c}</code>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {brand.tone.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Mission</Label>
              <Textarea value={editMission} onChange={(e) => setEditMission(e.target.value)} rows={3} />
            </div>
            <div>
              <Label>Positioning</Label>
              <Textarea value={editPositioning} onChange={(e) => setEditPositioning(e.target.value)} rows={3} />
            </div>
          </div>
          <Button size="sm" disabled={saveBrand.isPending} onClick={() => saveBrand.mutate()}>
            {saveBrand.isPending ? "Saving…" : "Save brand"}
          </Button>
          {brand.value_proposition && (
            <p className="text-sm"><span className="text-muted-foreground">Value proposition:</span> {brand.value_proposition}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Approved claims</CardTitle>
            <CardDescription>Use only approved claims in public marketing. Restricted/prohibited are blocked by policy.</CardDescription>
          </div>
          <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline">Add claim</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New claim</DialogTitle></DialogHeader>
              <Textarea value={claimText} onChange={(e) => setClaimText(e.target.value)} rows={3} />
              <DialogFooter>
                <Button disabled={!claimText.trim() || addClaim.isPending} onClick={() => addClaim.mutate()}>Save as unverified</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-2">
          {(claims.data?.items || []).map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div>
                <p>{c.text}</p>
                {c.evidence && <p className="text-xs text-muted-foreground">Source: {c.evidence}</p>}
              </div>
              <Badge variant={c.status === "approved" ? "default" : "secondary"}>{c.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
