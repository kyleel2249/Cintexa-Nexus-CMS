import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingExtended, marketingIntel } from "@/lib/marketing/api";

function rate(num?: number | null, den?: number | null) {
  if (num == null || den == null || den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export default function VariantsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Variant A");
  const [hypothesis, setHypothesis] = useState("");
  const [body, setBody] = useState("");
  const [parentType, setParentType] = useState<"content" | "email" | "social">("social");

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const list = useQuery({ queryKey: ["mkt", "variants"], queryFn: () => marketingExtended.listVariants() });

  const create = useMutation({
    mutationFn: () =>
      marketingExtended.createVariant({
        name,
        hypothesis,
        body,
        parent_type: parentType,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "variants"] });
      setOpen(false);
      setName("Variant A");
      setHypothesis("");
      setBody("");
    },
  });

  const saveMetrics = useMutation({
    mutationFn: ({ id, impressions, clicks, conversions }: { id: string; impressions: number; clicks: number; conversions: number }) =>
      marketingExtended.updateVariant(id, { impressions, clicks, conversions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "variants"] }),
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">A/B Variants</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Local variants with <strong>manual</strong> results. No automatic statistical winner declaration.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Variant</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New variant</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div>
                <Label>Type</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={parentType} onChange={(e) => setParentType(e.target.value as any)}>
                  <option value="social">Social</option>
                  <option value="email">Email</option>
                  <option value="content">Content</option>
                </select>
              </div>
              <div><Label>Hypothesis</Label><Input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="What are you testing?" /></div>
              <div><Label>Copy</Label><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || !body.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {(list.data || []).map((v) => {
        const ctr = rate(v.clicks, v.impressions);
        const cvr = rate(v.conversions, v.clicks);
        return (
          <Card key={v.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                {v.name} <Badge variant="outline">{v.parent_type}</Badge>
              </CardTitle>
              {v.hypothesis && <CardDescription>{v.hypothesis}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-xs whitespace-pre-wrap border rounded p-2 bg-muted/20">{v.body}</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Impressions</Label>
                  <Input className="h-8" type="number" defaultValue={v.impressions ?? ""} id={`imp-${v.id}`} />
                </div>
                <div>
                  <Label className="text-[10px]">Clicks</Label>
                  <Input className="h-8" type="number" defaultValue={v.clicks ?? ""} id={`clk-${v.id}`} />
                </div>
                <div>
                  <Label className="text-[10px]">Conversions</Label>
                  <Input className="h-8" type="number" defaultValue={v.conversions ?? ""} id={`cv-${v.id}`} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const impressions = Number((document.getElementById(`imp-${v.id}`) as HTMLInputElement)?.value) || 0;
                    const clicks = Number((document.getElementById(`clk-${v.id}`) as HTMLInputElement)?.value) || 0;
                    const conversions = Number((document.getElementById(`cv-${v.id}`) as HTMLInputElement)?.value) || 0;
                    saveMetrics.mutate({ id: v.id, impressions, clicks, conversions });
                  }}
                >
                  Save manual metrics
                </Button>
                <Badge variant="secondary" className="text-[10px]">MANUAL</Badge>
                <span className="text-xs text-muted-foreground">
                  CTR {ctr != null ? `${ctr}%` : "—"} · CVR {cvr != null ? `${cvr}%` : "—"}
                  {ctr == null ? " (need impressions)" : ""}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {!(list.data || []).length && <p className="text-sm text-muted-foreground text-center py-8">No variants yet.</p>}
    </div>
  );
}
