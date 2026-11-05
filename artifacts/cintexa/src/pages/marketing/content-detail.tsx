import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { marketingApi } from "@/lib/marketing/api";
import { BrandIntelligencePanel } from "@/components/marketing/BrandIntelligencePanel";
import { scanBrandCompliance } from "@/lib/marketing/brand-compliance";
import { marketingIntel } from "@/lib/marketing/api";

import { ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";

export default function ContentDetail() {
  const [, params] = useRoute("/marketing/content/:id");
  const id = params?.id;
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("DRAFT");

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketing", "content", id],
    enabled: !!id,
    queryFn: () => marketingApi.getContent(Number(id)),
  });

  useEffect(() => {
    if (data) {
      setTitle(data.title || "");
      setBody(data.body || "");
      setStatus(data.status || "DRAFT");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => marketingApi.updateContent(Number(id), { title, body, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "content"] }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">Content not found.</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/marketing/content"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{data.title}</h1>
          <div className="flex gap-2 mt-1">
            <Badge variant="outline">{data.type}</Badge>
            <Badge variant="secondary">{data.status}</Badge>
            <span className="text-xs text-muted-foreground">v{data.version || 1}</span>
          </div>
        </div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Edit</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-sm" />
          </div>
          <p className="text-xs text-muted-foreground">
            Export or copy for external channels. Publishing to social/email is manual confirmation only — no external APIs.
          </p>
        </CardContent>
      </Card>
      <div className="space-y-3">
      <BrandComplianceInline text={body} />
      <BrandIntelligencePanel
        onInsertClaim={(text) => setBody((b) => (b ? b + "\n\n" + text : text))}
      />
      </div>
      </div>
    </div>
  );
}

function BrandComplianceInline({ text }: { text: string }) {
  const brandQ = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.listBrands() });
  const brand = brandQ.data?.items?.find((b) => b.is_default) || brandQ.data?.items?.[0];
  const claimsQ = useQuery({
    queryKey: ["mkt", "claims", brand?.id],
    enabled: !!brand?.id,
    queryFn: () => marketingIntel.listClaims(brand!.id),
  });
  const issues = scanBrandCompliance(text, brand, claimsQ.data?.items || []);
  if (!text.trim()) return null;
  return (
    <div className="rounded-md border px-3 py-2 space-y-1">
      <p className="text-xs font-medium">Brand consistency check</p>
      <p className="text-[10px] text-muted-foreground">Assistant only — not legal certification.</p>
      {issues.map((i) => (
        <div key={i.id} className="text-[11px] border-t border-border/40 pt-1">
          <span className="uppercase text-[9px] text-muted-foreground">{i.severity}</span> {i.message}
          {i.suggestion && <p className="text-muted-foreground">{i.suggestion}</p>}
        </div>
      ))}
    </div>
  );
}

