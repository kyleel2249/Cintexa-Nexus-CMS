import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";
import { BrandIntelligencePanel } from "@/components/marketing/BrandIntelligencePanel";
import { PersonaRecommendPanel } from "@/components/marketing/PersonaRecommendPanel";
import { scanBrandCompliance } from "@/lib/marketing/brand-compliance";
import { marketingIntel } from "@/lib/marketing/api";
import { useQuery } from "@tanstack/react-query";

export default function EmailMarketing() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "emails"],
    queryFn: () => marketingApi.listEmails(),
  });

  const create = useMutation({
    mutationFn: () =>
      marketingApi.createEmail({
        name,
        subject,
        body_text: body,
        body_html: body,
        audience: audience || null,
        status: "DRAFT",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "emails"] });
      setOpen(false);
      setName("");
      setSubject("");
      setBody("");
      setAudience("");
    },
  });

  const markReady = useMutation({
    mutationFn: (id: number) => marketingApi.updateEmail(id, { status: "READY_TO_EXPORT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "emails"] }),
  });

  const items = data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Marketing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan newsletters and campaigns. Export HTML/text — <strong>sending is not automated</strong> (no external email APIs).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New email</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create email campaign</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="November newsletter" /></div>
              <div><Label>Subject line</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What’s new this month" /></div>
              <div><Label>Audience note</Label><Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Subscribers · product updates" /></div>
              <div><Label>Body</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Write the email body…" /></div>
              <EmailComplianceHint text={body} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || !subject.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Save draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Campaigns</CardTitle>
          <CardDescription>Copy body for your mail tool. Record performance manually if needed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>}
          {!isLoading && items.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No email campaigns yet.</p>}
          {items.map((e) => (
            <div key={e.id} className="rounded-md border px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{e.name}</p>
                  <p className="text-xs text-muted-foreground truncate">Subject: {e.subject}</p>
                </div>
                <Badge variant="secondary">{e.status}</Badge>
              </div>
              {e.audience && <p className="text-xs text-muted-foreground">Audience: {e.audience}</p>}
              {e.body_text && <p className="text-xs line-clamp-2 text-muted-foreground">{e.body_text}</p>}
              <div className="flex gap-2 pt-1">
                {e.status === "DRAFT" && (
                  <Button size="sm" variant="outline" onClick={() => markReady.mutate(e.id)}>Mark ready to export</Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const blob = new Blob([e.body_html || e.body_text || ""], { type: "text/html" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${e.name.replace(/\s+/g, "-").toLowerCase()}.html`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export HTML
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="space-y-3">
      <PersonaRecommendPanel />
      <BrandIntelligencePanel
        onInsertClaim={(text) => {
          setBody((b) => (b ? b + "\n\n" + text : text));
          setOpen(true);
        }}
      />
      </div>
      </div>
    </div>
  );
}


function EmailComplianceHint({ text }: { text: string }) {
  const brandQ = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.listBrands() });
  const brand = brandQ.data?.items?.find((b) => b.is_default) || brandQ.data?.items?.[0];
  const claimsQ = useQuery({
    queryKey: ["mkt", "claims", brand?.id],
    enabled: !!brand?.id,
    queryFn: () => marketingIntel.listClaims(brand!.id),
  });
  if (!text.trim()) return null;
  const issues = scanBrandCompliance(text, brand, claimsQ.data?.items || []);
  return (
    <div className="rounded-md border px-2 py-1.5 space-y-1 max-h-28 overflow-y-auto">
      <p className="text-[10px] font-medium">Brand consistency (assistant)</p>
      {issues.slice(0, 4).map((i) => (
        <p key={i.id} className="text-[10px] text-muted-foreground">
          <span className="uppercase">{i.severity}</span> — {i.message}
        </p>
      ))}
    </div>
  );
}
