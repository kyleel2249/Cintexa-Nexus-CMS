import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCachedCmsForms } from "@/lib/marketing/cms-cache/useCachedCms";
import type { CachedFormOption } from "@/lib/marketing/cms-cache/cmsCacheReader";
import { CmsCacheUnavailableState } from "./CmsCacheUnavailableState";

type Props = {
  onSelect: (form: CachedFormOption) => void;
  triggerLabel?: string;
};

export function CmsFormsPicker({ onSelect, triggerLabel = "Choose from Forms" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { sessionAvailable, cacheHasData, items } = useCachedCmsForms();

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const s = q.toLowerCase();
    return items.filter((f) => f.name.toLowerCase().includes(s));
  }, [items, q]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select from CMS Forms (session cache)</DialogTitle>
        </DialogHeader>
        {!sessionAvailable || !cacheHasData ? (
          <CmsCacheUnavailableState kind="forms" />
        ) : (
          <>
            <div className="flex gap-2">
              <Input placeholder="Search forms…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Badge variant="secondary" className="text-[10px] self-center shrink-0">CACHE ONLY · NO FETCH</Badge>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 py-2 min-h-[180px]">
              {filtered.map((f) => (
                <button
                  key={f.cmsFormId}
                  type="button"
                  className="w-full rounded-md border px-3 py-2 text-left hover:border-primary hover:bg-muted/40"
                  onClick={() => {
                    onSelect(f);
                    setOpen(false);
                  }}
                >
                  <p className="text-sm font-medium">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    #{f.cmsFormId}
                    {f.submissionCount != null ? ` · ${f.submissionCount} submissions (CMS CACHE)` : ""}
                  </p>
                </button>
              ))}
              {!filtered.length && <p className="text-xs text-muted-foreground text-center py-6">No matching forms in cache.</p>}
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
