import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { marketingAssets, marketingIntel } from "@/lib/marketing/api";
import { Link } from "wouter";
import { CmsMediaPicker } from "@/components/marketing/CmsMediaPicker";

export default function AssetLibraryPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => { marketingIntel.ensureSeed(); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["mkt", "assets"],
    queryFn: () => marketingAssets.list(),
  });

  const create = useMutation({
    mutationFn: () =>
      marketingAssets.create({
        name,
        url: url || null,
        media_id: mediaId ? Number(mediaId) : null,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        category: category || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "assets"] });
      setOpen(false);
      setName("");
      setUrl("");
      setMediaId("");
      setTags("");
      setCategory("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => marketingAssets.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "assets"] }),
  });

  const items = (data?.items || []).filter((a) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)) || (a.category || "").toLowerCase().includes(q);
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asset Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Marketing tags and references to media — files stay in the{" "}
            <Link href="/media" className="underline">Nexus Media Library</Link>. No duplicate storage.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <CmsMediaPicker
          multiSelect
          onSelect={(m) => {
            marketingAssets.create({
              name: m.name,
              media_id: m.cmsMediaId,
              url: m.thumbnailUrl || null,
              mime_type: m.mimeType || null,
              tags: [],
              category: m.mimeType?.startsWith("image/") ? "Image" : m.mimeType?.startsWith("video/") ? "Video" : "File",
            }).then(() => qc.invalidateQueries({ queryKey: ["mkt", "assets"] }));
          }}
          onSelectMany={(list) => {
            Promise.all(
              list.map((m) =>
                marketingAssets.create({
                  name: m.name,
                  media_id: m.cmsMediaId,
                  url: m.thumbnailUrl || null,
                  mime_type: m.mimeType || null,
                  tags: [],
                  category: m.mimeType?.startsWith("image/") ? "Image" : "File",
                }),
              ),
            ).then(() => qc.invalidateQueries({ queryKey: ["mkt", "assets"] }));
          }}
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Register asset</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Register media reference</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hero — homepage" /></div>
              <div><Label>Media library ID (optional)</Label><Input value={mediaId} onChange={(e) => setMediaId(e.target.value)} placeholder="e.g. 42" type="number" /></div>
              <div><Label>URL or data path (optional)</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/uploads/…" /></div>
              <div><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Logo / Photo / Document" /></div>
              <div><Label>Tags (comma-separated)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="brand, social, q4" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex gap-2">
        <Input className="max-w-xs" placeholder="Filter by name or tag…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button variant="outline" size="sm" asChild>
          <Link href="/media"><ExternalLink className="h-3.5 w-3.5 mr-1" /> Open Media</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Marketing asset refs</CardTitle>
          <CardDescription>{items.length} registered · associate with campaigns via tags</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>}
          {!isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No asset refs yet. Upload in Media Library, then register a reference here with tags.
            </p>
          )}
          {items.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {a.media_id != null ? `Media #${a.media_id}` : "No media id"}
                  {a.url ? ` · ${a.url}` : ""}
                  {a.category ? ` · ${a.category}` : ""}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {a.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                </div>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => remove.mutate(a.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
