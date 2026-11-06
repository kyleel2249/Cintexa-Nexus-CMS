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
import { marketingExtended } from "@/lib/marketing/api";
import { marketingIntel } from "@/lib/marketing/api";
import { BrandIntelligencePanel } from "@/components/marketing/BrandIntelligencePanel";
import { scanBrandCompliance } from "@/lib/marketing/brand-compliance";

export default function TemplatesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"social" | "email" | "subject" | "article" | "cta" | "promo">("social");
  const [body, setBody] = useState("");

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const list = useQuery({ queryKey: ["mkt", "templates"], queryFn: () => marketingExtended.listTemplates() });
  const brands = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.listBrands() });
  const brand = brands.data?.items?.find((b) => b.is_default) || brands.data?.items?.[0];
  const claims = useQuery({
    queryKey: ["mkt", "claims", brand?.id],
    enabled: !!brand?.id,
    queryFn: () => marketingIntel.listClaims(brand!.id),
  });

  const create = useMutation({
    mutationFn: () => marketingExtended.createTemplate({ name, category, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "templates"] });
      setOpen(false);
      setName("");
      setBody("");
    },
  });

  const issues = body.trim() ? scanBrandCompliance(body, brand, claims.data?.items || []) : [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Template Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Brand-oriented templates. Consistency assistant only — not legal certification.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Template</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New template</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div>
                <Label>Category</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as any)}>
                  <option value="social">Social</option>
                  <option value="email">Email</option>
                  <option value="subject">Subject</option>
                  <option value="article">Article</option>
                  <option value="cta">CTA</option>
                  <option value="promo">Promo</option>
                </select>
              </div>
              <div><Label>Body</Label><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Use placeholders: {{campaign}}, {{offer}}, {{cta}}" /></div>
              {issues.slice(0, 3).map((i) => (
                <p key={i.id} className="text-[10px] text-muted-foreground">{i.severity}: {i.message}</p>
              ))}
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || !body.trim() || create.isPending} onClick={() => create.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-2">
          {(list.data || []).map((t) => (
            <Card key={t.id}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm flex items-center gap-2">{t.name} <Badge variant="outline">{t.category}</Badge></CardTitle>
                <CardDescription className="text-xs whitespace-pre-wrap line-clamp-4">{t.body}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(t.body)}>Copy body</Button>
              </CardContent>
            </Card>
          ))}
          {!(list.data || []).length && <p className="text-sm text-muted-foreground text-center py-8">No templates yet.</p>}
        </div>
        <BrandIntelligencePanel
          onInsertClaim={(text) => setBody((b) => (b ? b + "\n" + text : text))}
        />
      </div>
    </div>
  );
}
