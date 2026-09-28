import { useMemo, useState } from "react";
import {
  useGetCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useGetTags,
  useCreateTag,
  useDeleteTag,
  getGetCategoriesQueryKey,
  getGetTagsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, FolderTree, Loader2, Pencil, Trash2, Tag as TagIcon, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type CategoryRow = { id: number; name: string; slug: string; description?: string | null; postCount?: number };

export default function Categories() {
  const { data: categoriesData, isLoading, refetch } = useGetCategories();
  const { data: tagsData, isLoading: tagsLoading, refetch: refetchTags } = useGetTags();
  const categories = useMemo(() => (Array.isArray(categoriesData) ? (categoriesData as CategoryRow[]) : []), [categoriesData]);
  const tags = useMemo(() => (Array.isArray(tagsData) ? (tagsData as CategoryRow[]) : []), [tagsData]);
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const createTag = useCreateTag();
  const removeTag = useDeleteTag();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [tagName, setTagName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<CategoryRow | null>(null);

  const filtered = useMemo(
    () => categories.filter((c) => `${c.name} ${c.slug} ${c.description ?? ""}`.toLowerCase().includes(query.toLowerCase())),
    [categories, query],
  );

  function openNew() {
    setEditing(null);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setOpen(true);
  }

  function openEdit(c: CategoryRow) {
    setEditing(c);
    setName(c.name);
    setSlug(c.slug);
    setSlugTouched(true);
    setDescription(c.description ?? "");
    setOpen(true);
  }

  async function refreshCategories() {
    await qc.invalidateQueries({ queryKey: getGetCategoriesQueryKey() });
    void refetch();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const finalSlug = slugify(slug || name);
    if (!name.trim() || !finalSlug) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (categories.some((c) => c.slug === finalSlug && c.id !== editing?.id)) {
      toast({ title: "That slug is already used", description: "Pick a unique slug for this category.", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: { name: name.trim(), slug: finalSlug, description: description.trim() } });
        toast({ title: "Category updated" });
      } else {
        await create.mutateAsync({ data: { name: name.trim(), slug: finalSlug, description: description.trim() || undefined } });
        toast({ title: "Category created" });
      }
      setOpen(false);
      await refreshCategories();
    } catch (err: any) {
      toast({ title: err?.message || "Could not save category", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync({ id: confirmDelete.id });
      toast({ title: "Category deleted", description: confirmDelete.name });
      setConfirmDelete(null);
      await refreshCategories();
    } catch (err: any) {
      toast({ title: err?.message || "Could not delete category", variant: "destructive" });
    }
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    const n = tagName.trim();
    const s = slugify(n);
    if (!n || !s) return;
    if (tags.some((t) => t.slug === s)) {
      toast({ title: "Tag already exists", variant: "destructive" });
      return;
    }
    try {
      await createTag.mutateAsync({ data: { name: n, slug: s } });
      setTagName("");
      await qc.invalidateQueries({ queryKey: getGetTagsQueryKey() });
      void refetchTags();
    } catch (err: any) {
      toast({ title: err?.message || "Could not create tag", variant: "destructive" });
    }
  }

  async function deleteTag(t: CategoryRow) {
    try {
      await removeTag.mutateAsync({ id: t.id });
      await qc.invalidateQueries({ queryKey: getGetTagsQueryKey() });
      void refetchTags();
    } catch (err: any) {
      toast({ title: err?.message || "Could not delete tag", variant: "destructive" });
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Taxonomy</h2>
          <p className="text-muted-foreground mt-1">Organise posts and pages with categories and tags.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Add category
        </Button>
      </div>

      <Tabs defaultValue="categories" className="space-y-6">
        <TabsList className="bg-card border border-border/50">
          <TabsTrigger value="categories" className="gap-2">
            <FolderTree className="h-4 w-4" /> Categories <Badge variant="secondary">{categories.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="tags" className="gap-2">
            <TagIcon className="h-4 w-4" /> Tags <Badge variant="secondary">{tags.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search categories…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? (
              Array(3)
                .fill(0)
                .map((_, i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-5 w-2/3" />
                    </CardHeader>
                  </Card>
                ))
            ) : filtered.length ? (
              <AnimatePresence initial={false}>
                {filtered.map((c) => (
                  <motion.div key={c.id} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                    <Card className="border-border/50 hover:border-primary/40 transition-colors h-full">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <FolderTree className="h-4 w-4 text-primary shrink-0" />
                              <span className="truncate">{c.name}</span>
                            </CardTitle>
                            <CardDescription>/{c.slug}</CardDescription>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)} title="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setConfirmDelete(c)} title="Delete">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        {c.description || "No description"}
                        <p className="mt-2 text-xs">
                          <Badge variant="outline">{c.postCount ?? 0} post{(c.postCount ?? 0) === 1 ? "" : "s"}</Badge>
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            ) : (
              <div className="col-span-full py-12 text-center border-2 border-dashed rounded-lg">
                <FolderTree className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-3">{query ? "No categories match your search." : "No categories yet."}</p>
                {!query && <Button onClick={openNew}>Add category</Button>}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tags" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Tags</CardTitle>
              <CardDescription>Lightweight labels you can attach to posts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={addTag} className="flex gap-2 max-w-md">
                <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="New tag name" />
                <Button type="submit" disabled={createTag.isPending || !tagName.trim()}>
                  {createTag.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </form>
              <div className="flex flex-wrap gap-2">
                {tagsLoading ? (
                  <Skeleton className="h-8 w-40" />
                ) : tags.length ? (
                  tags.map((t) => (
                    <Badge key={t.id} variant="secondary" className="gap-1 py-1 pl-3 pr-1 text-sm">
                      {t.name}
                      <button className="rounded-full p-1 hover:bg-destructive/20" onClick={() => void deleteTag(t)} aria-label={`Delete ${t.name}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No tags yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>The slug is used in URLs and filters.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editing ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.postCount ? `${confirmDelete.postCount} post(s) use this category and will become uncategorised.` : "This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
