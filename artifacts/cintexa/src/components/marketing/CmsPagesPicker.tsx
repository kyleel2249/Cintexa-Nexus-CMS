import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCachedCmsPages } from "@/lib/marketing/cms-cache/useCachedCms";
import type { CachedPageOption } from "@/lib/marketing/cms-cache/cmsCacheReader";
import { CmsCacheUnavailableState } from "./CmsCacheUnavailableState";

type Props = {
  onSelect: (page: CachedPageOption) => void;
  triggerLabel?: string;
};

export function CmsPagesPicker({ onSelect, triggerLabel = "Choose from CMS Pages" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const { sessionAvailable, cacheHasData, items } = useCachedCmsPages();

  const filtered = useMemo(() => {
    return items.filter((p) => {
      if (status !== "all" && (p.status || "").toLowerCase() !== status) return false;
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return p.title.toLowerCase().includes(s) || (p.slug || "").toLowerCase().includes(s);
    });
  }, [items, q, status]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select from CMS Pages (session cache)</DialogTitle>
        </DialogHeader>

        {!sessionAvailable || !cacheHasData ? (
          <CmsCacheUnavailableState kind="pages" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" placeholder="Search title or slug…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
              <Badge variant="secondary" className="text-[10px] self-center">CACHE ONLY · NO FETCH</Badge>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 py-2 min-h-[200px]">
              {filtered.map((p) => (
                <button
                  key={p.cmsPageId}
                  type="button"
                  className="w-full rounded-md border px-3 py-2 text-left hover:border-primary hover:bg-muted/40"
                  onClick={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    {p.status && <Badge variant="outline" className="text-[10px] shrink-0">{p.status}</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    #{p.cmsPageId}
                    {p.slug ? ` · /${p.slug}` : ""}
                    {p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleDateString()}` : ""}
                  </p>
                </button>
              ))}
              {!filtered.length && (
                <p className="text-xs text-muted-foreground text-center py-8">Cache has no matching pages for this filter.</p>
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
