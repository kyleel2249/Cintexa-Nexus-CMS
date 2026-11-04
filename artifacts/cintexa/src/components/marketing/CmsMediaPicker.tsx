import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCachedCmsMedia } from "@/lib/marketing/cms-cache/useCachedCms";
import type { CachedMediaOption } from "@/lib/marketing/cms-cache/cmsCacheReader";
import { CmsCacheUnavailableState } from "./CmsCacheUnavailableState";
import { Image as ImageIcon, File as FileIcon, Film } from "lucide-react";

type Props = {
  onSelect: (asset: CachedMediaOption) => void;
  triggerLabel?: string;
};

function formatBytes(n?: number) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function TypeIcon({ mime }: { mime?: string }) {
  if (mime?.startsWith("image/")) return <ImageIcon className="h-6 w-6 text-muted-foreground" />;
  if (mime?.startsWith("video/")) return <Film className="h-6 w-6 text-muted-foreground" />;
  return <FileIcon className="h-6 w-6 text-muted-foreground" />;
}

export function CmsMediaPicker({ onSelect, triggerLabel = "Choose from Media Library" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const { sessionAvailable, cacheHasData, items } = useCachedCmsMedia();

  const filtered = useMemo(() => {
    return items.filter((m) => {
      if (type === "image" && !m.mimeType?.startsWith("image/")) return false;
      if (type === "video" && !m.mimeType?.startsWith("video/")) return false;
      if (type === "other" && (m.mimeType?.startsWith("image/") || m.mimeType?.startsWith("video/"))) return false;
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return m.name.toLowerCase().includes(s) || (m.filename || "").toLowerCase().includes(s);
    });
  }, [items, q, type]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select from CMS Media (session cache)</DialogTitle>
        </DialogHeader>

        {!sessionAvailable || !cacheHasData ? (
          <CmsCacheUnavailableState kind="media" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" placeholder="Search name or filename…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">All types</option>
                <option value="image">Images</option>
                <option value="video">Video</option>
                <option value="other">Other</option>
              </select>
              <Badge variant="secondary" className="text-[10px] self-center">CACHE ONLY · NO FETCH</Badge>
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2 py-2 min-h-[200px]">
              {filtered.map((m) => (
                <button
                  key={m.cmsMediaId}
                  type="button"
                  className="rounded-md border p-2 text-left hover:border-primary hover:bg-muted/40 transition-colors"
                  onClick={() => {
                    onSelect(m);
                    setOpen(false);
                  }}
                >
                  <div className="aspect-video rounded bg-muted/50 flex items-center justify-center overflow-hidden mb-1">
                    {m.mimeType?.startsWith("image/") && m.thumbnailUrl ? (
                      <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <TypeIcon mime={m.mimeType} />
                    )}
                  </div>
                  <p className="text-xs font-medium truncate">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    #{m.cmsMediaId}
                    {m.mimeType ? ` · ${m.mimeType}` : ""}
                    {m.size != null ? ` · ${formatBytes(m.size)}` : ""}
                  </p>
                </button>
              ))}
              {!filtered.length && (
                <p className="col-span-full text-xs text-muted-foreground text-center py-8">
                  Cache has no matching media for this filter.
                </p>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
