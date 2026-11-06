import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { marketingApi } from "@/lib/marketing/api";
import { Link } from "wouter";

export default function SeoManager() {
  const qc = useQueryClient();
  const [path, setPath] = useState("/");
  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState("");
  const [slug, setSlug] = useState("");
  const [keywords, setKeywords] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "seo"],
    queryFn: () => marketingApi.listSeo(),
  });

  const save = useMutation({
    mutationFn: () =>
      marketingApi.upsertSeo({
        page_path: path.trim() || "/",
        title: title || null,
        meta_description: meta || null,
        slug: slug || null,
        keywords: keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "seo"] });
    },
  });

  const items = data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SEO Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">
          On-page SEO checklist and metadata planning. Works with Nexus pages —{" "}
          <Link href="/seo" className="underline">platform SEO settings</Link> and the page builder remain the source of published meta.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Score a page</CardTitle>
          <CardDescription>Title 10–60 chars, meta 50–160 chars, slug and keywords improve the local score.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Page path</Label><Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/blog/launch" /></div>
            <div><Label>Slug</Label><Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="launch" /></div>
          </div>
          <div><Label>SEO title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product launch | Brand" /></div>
          <div><Label>Meta description</Label><Textarea value={meta} onChange={(e) => setMeta(e.target.value)} rows={3} /></div>
          <div><Label>Keywords (comma-separated)</Label><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
          <Button size="sm" disabled={!path.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save & score"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Tracked pages</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>}
          {!isLoading && items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No SEO records yet.</p>}
          {items.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{r.page_path}</p>
                <p className="text-xs text-muted-foreground truncate">{r.title || "No title"}</p>
              </div>
              <Badge variant={r.score >= 70 ? "default" : "secondary"}>Score {r.score}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
