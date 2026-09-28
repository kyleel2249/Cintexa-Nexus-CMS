import { useMemo, useRef, useState } from "react";
import { useGetMedia, useCreateMedia, useUpdateMedia, useDeleteMedia, getGetMediaQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Upload, Image as ImageIcon, File as FileIcon, Film, Search, Loader2, Trash2, Copy, Pencil, LayoutGrid, List, Download, CloudUpload } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const MAX_BYTES = 8 * 1024 * 1024; // files are stored as data URLs, keep them reasonable

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

type MediaRow = {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  altText?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  createdAt: string;
};

export default function Media() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dragging, setDragging] = useState(false);
  const { data: media, isLoading, refetch } = useGetMedia({ search: search || undefined, type: type === "all" ? undefined : type });
  const createMedia = useCreateMedia();
  const updateMedia = useUpdateMedia();
  const deleteMedia = useDeleteMedia();
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [editing, setEditing] = useState<MediaRow | null>(null);
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<MediaRow | null>(null);

  const items = useMemo(() => (Array.isArray(media) ? (media as MediaRow[]) : []), [media]);
  const totalSize = useMemo(() => items.reduce((n, i) => n + (i.size || 0), 0), [items]);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: getGetMediaQueryKey() });
    void refetch();
  }

  async function onFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    const tooBig = list.filter((f) => f.size > MAX_BYTES);
    const ok = list.filter((f) => f.size <= MAX_BYTES);
    if (tooBig.length) {
      toast({ title: `${tooBig.length} file(s) skipped`, description: `Files must be under ${formatBytes(MAX_BYTES)}: ${tooBig.map((f) => f.name).join(", ")}`, variant: "destructive" });
    }
    if (!ok.length) return;
    setUploading(true);
    setProgress({ done: 0, total: ok.length });
    let added = 0;
    const failures: string[] = [];
    for (const file of ok) {
      try {
        const dataUrl = await readAsDataUrl(file);
        const dims = file.type.startsWith("image/") ? await imageSize(dataUrl) : null;
        await createMedia.mutateAsync({
          data: {
            filename: `${Date.now()}-${file.name.replace(/\s+/g, "-")}`,
            originalName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            url: dataUrl,
            altText: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
            ...(dims ?? {}),
          },
        });
        added += 1;
      } catch (err: any) {
        failures.push(`${file.name}: ${err?.message || "failed"}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    await refresh();
    if (added) toast({ title: "Upload complete", description: `${added} file(s) added to the library` });
    if (failures.length) toast({ title: "Some uploads failed", description: failures.slice(0, 3).join(" · "), variant: "destructive" });
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function openEdit(item: MediaRow) {
    setEditing(item);
    setAlt(item.altText ?? "");
    setCaption(item.caption ?? "");
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await updateMedia.mutateAsync({ id: editing.id, data: { altText: alt, caption } });
      toast({ title: "Media details saved" });
      setEditing(null);
      await refresh();
    } catch (err: any) {
      toast({ title: err?.message || "Could not save", variant: "destructive" });
    }
  }

  async function removeItem() {
    if (!confirmDelete) return;
    try {
      await deleteMedia.mutateAsync({ id: confirmDelete.id });
      toast({ title: "Removed from library" });
      setConfirmDelete(null);
      await refresh();
    } catch (err: any) {
      toast({ title: err?.message || "Delete failed", variant: "destructive" });
    }
  }

  async function copyUrl(item: MediaRow) {
    const isData = item.url.startsWith("data:");
    const value = isData || item.url.startsWith("http") ? item.url : `${window.location.origin}${item.url}`;
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: isData ? "Data URL copied" : "URL copied", description: isData ? "Embedded (base64) file. Use it directly in an <img> tag." : value });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  const Thumb = ({ item, className = "" }: { item: MediaRow; className?: string }) => {
    if (item.mimeType?.startsWith("image/")) return <img src={item.url} alt={item.altText || item.originalName} className={`object-cover ${className}`} loading="lazy" />;
    if (item.mimeType?.startsWith("video/")) return <div className={`flex items-center justify-center ${className}`}><Film className="h-10 w-10 text-muted-foreground" /></div>;
    return <div className={`flex items-center justify-center ${className}`}><FileIcon className="h-10 w-10 text-muted-foreground" /></div>;
  };

  return (
    <div
      className="space-y-6 relative"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void onFiles(e.dataTransfer.files); }}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 rounded-xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
            <CloudUpload className="h-12 w-12 text-primary mb-2" />
            <p className="font-medium">Drop files to upload</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Media library</h2>
          <p className="text-muted-foreground mt-1">
            {items.length} file{items.length === 1 ? "" : "s"} · {formatBytes(totalSize)} · drag & drop anywhere to upload
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={inputRef} type="file" multiple className="hidden" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.svg" onChange={(e) => void onFiles(e.target.files)} />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {uploading ? `Uploading ${progress.done}/${progress.total}` : "Upload"}
          </Button>
        </div>
      </div>

      {uploading && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <motion.div className="h-full bg-primary" animate={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search media…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {["all", "image", "video", "application"].map((t) => (
            <Button key={t} size="sm" variant={type === t ? "default" : "outline"} onClick={() => setType(t)} className="capitalize">
              {t === "application" ? "Docs" : t}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant={view === "grid" ? "default" : "outline"} onClick={() => setView("grid")} title="Grid"><LayoutGrid className="h-4 w-4" /></Button>
          <Button size="icon" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")} title="List"><List className="h-4 w-4" /></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
        </div>
      ) : items.length && view === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((item) => (
            <motion.div key={item.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="overflow-hidden border-border/50 group hover:border-primary/40 transition-colors">
                <div className="aspect-square bg-muted/40 relative">
                  <Thumb item={item} className="h-full w-full" />
                  <div className="absolute inset-x-0 top-0 p-2 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b from-black/50 to-transparent">
                    <Button size="icon" variant="secondary" className="h-7 w-7" title="Edit details" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="secondary" className="h-7 w-7" title="Copy URL" onClick={() => void copyUrl(item)}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="destructive" className="h-7 w-7" title="Delete" onClick={() => setConfirmDelete(item)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <CardContent className="p-3 space-y-1">
                  <p className="text-sm font-medium truncate" title={item.originalName}>{item.originalName}</p>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>{formatBytes(item.size)}{item.width && item.height ? ` · ${item.width}×${item.height}` : ""}</span>
                    <span>{format(new Date(item.createdAt), "MMM d")}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-normal">{item.mimeType?.split("/")[0] || "file"}</Badge>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : items.length ? (
        <div className="rounded-xl border divide-y">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-3">
              <Thumb item={item} className="h-12 w-12 rounded-md bg-muted/40 shrink-0 overflow-hidden" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.originalName}</p>
                <p className="text-xs text-muted-foreground truncate">{item.altText || "No alt text"} · {formatBytes(item.size)} · {format(new Date(item.createdAt), "MMM d, yyyy")}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => void copyUrl(item)}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" asChild><a href={item.url} download={item.originalName}><Download className="h-4 w-4" /></a></Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(item)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center border-2 border-dashed border-border rounded-xl">
          <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">{search || type !== "all" ? "Nothing matches your filters" : "Library is empty"}</h3>
          <p className="text-muted-foreground mb-4">Upload or drop images, videos and documents to use across pages and posts.</p>
          <Button onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Upload media</Button>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Media details</DialogTitle>
            <DialogDescription>{editing?.originalName}</DialogDescription>
          </DialogHeader>
          {editing?.mimeType?.startsWith("image/") && <img src={editing.url} alt="" className="max-h-48 mx-auto rounded-md" />}
          <div className="space-y-3">
            <div className="space-y-2"><Label>Alt text (accessibility & SEO)</Label><Input value={alt} onChange={(e) => setAlt(e.target.value)} /></div>
            <div className="space-y-2"><Label>Caption</Label><Input value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void saveEdit()} disabled={updateMedia.isPending}>{updateMedia.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.originalName}”?</DialogTitle>
            <DialogDescription>Pages or posts that use this file will show a broken image.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void removeItem()} disabled={deleteMedia.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
