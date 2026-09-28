import { useMemo, useState } from "react";
import {
  useGetMenus,
  useCreateMenu,
  useUpdateMenu,
  useDeleteMenu,
  useGetPages,
  getGetMenusQueryKey,
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
import { Plus, Menu as MenuIcon, Loader2, Pencil, Trash2, Copy, ArrowUp, ArrowDown, CornerDownRight, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

type MenuLeaf = { label: string; url: string };
type MenuItem = MenuLeaf & { children?: MenuLeaf[] };
type MenuRow = { id: number; name: string; location: string; items: string; createdAt: string };

const LOCATIONS = ["header", "footer", "sidebar", "mobile", "utility"];

function parseItems(raw: string | undefined): MenuItem[] {
  try {
    const v = JSON.parse(raw || "[]");
    if (!Array.isArray(v)) return [];
    return v.map((i: any) => ({
      label: String(i?.label ?? ""),
      url: String(i?.url ?? ""),
      children: Array.isArray(i?.children) ? i.children.map((c: any) => ({ label: String(c?.label ?? ""), url: String(c?.url ?? "") })) : undefined,
    }));
  } catch {
    return [];
  }
}

function serialize(items: MenuItem[]): string {
  return JSON.stringify(
    items.map((i) => {
      const base: MenuItem = { label: i.label.trim(), url: i.url.trim() };
      if (i.children?.length) base.children = i.children.map((c) => ({ label: c.label.trim(), url: c.url.trim() }));
      return base;
    }),
  );
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = arr.slice();
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

export default function Menus() {
  const { data: menusData, isLoading, refetch } = useGetMenus();
  const { data: pagesData } = useGetPages();
  const menus = useMemo(() => (Array.isArray(menusData) ? (menusData as MenuRow[]) : []), [menusData]);
  const pages = useMemo(() => (Array.isArray(pagesData) ? (pagesData as Array<{ id: number; title: string; slug: string }>) : []), [pagesData]);
  const create = useCreateMenu();
  const update = useUpdateMenu();
  const remove = useDeleteMenu();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MenuRow | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("header");
  const [items, setItems] = useState<MenuItem[]>([{ label: "Home", url: "/" }]);
  const [itemsJson, setItemsJson] = useState('[{"label":"Home","url":"/"}]');
  const [tab, setTab] = useState<"visual" | "json">("visual");
  const [confirmDelete, setConfirmDelete] = useState<MenuRow | null>(null);

  function openNew() {
    setEditing(null);
    setName("");
    setLocation("header");
    setItems([{ label: "Home", url: "/" }]);
    setItemsJson('[{"label":"Home","url":"/"}]');
    setTab("visual");
    setOpen(true);
  }

  function openEdit(m: MenuRow) {
    const parsed = parseItems(m.items);
    setEditing(m);
    setName(m.name);
    setLocation(m.location);
    setItems(parsed);
    setItemsJson(JSON.stringify(parsed, null, 2));
    setTab("visual");
    setOpen(true);
  }

  function changeTab(next: string) {
    if (next === "json") {
      setItemsJson(JSON.stringify(JSON.parse(serialize(items)), null, 2));
    } else {
      try {
        setItems(parseItems(itemsJson));
      } catch {
        toast({ title: "Fix the JSON before switching", variant: "destructive" });
        return;
      }
    }
    setTab(next as "visual" | "json");
  }

  function patchItem(idx: number, patch: Partial<MenuItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function patchChild(idx: number, cIdx: number, patch: Partial<MenuLeaf>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, children: (it.children ?? []).map((c, j) => (j === cIdx ? { ...c, ...patch } : c)) } : it)),
    );
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: getGetMenusQueryKey() });
    void refetch();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    let payloadItems: string;
    if (tab === "json") {
      try {
        payloadItems = serialize(parseItems(itemsJson));
        if (!Array.isArray(JSON.parse(itemsJson))) throw new Error("not an array");
      } catch {
        toast({ title: "Items must be a valid JSON array of { label, url }", variant: "destructive" });
        return;
      }
    } else {
      payloadItems = serialize(items.filter((i) => i.label.trim() || i.url.trim()));
    }
    const parsed = JSON.parse(payloadItems) as MenuItem[];
    if (parsed.some((i) => !i.label || !i.url)) {
      toast({ title: "Every menu item needs a label and a URL", variant: "destructive" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Menu name is required", variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: { name: name.trim(), location: location.trim() || "header", items: payloadItems } });
        toast({ title: "Menu updated" });
      } else {
        await create.mutateAsync({ data: { name: name.trim(), location: location.trim() || "header", items: payloadItems } });
        toast({ title: "Menu created" });
      }
      setOpen(false);
      await refresh();
    } catch (err: any) {
      toast({ title: err?.message || "Could not save menu", variant: "destructive" });
    }
  }

  async function duplicate(m: MenuRow) {
    try {
      await create.mutateAsync({ data: { name: `${m.name} (copy)`, location: m.location, items: m.items } });
      toast({ title: "Menu duplicated" });
      await refresh();
    } catch (err: any) {
      toast({ title: err?.message || "Could not duplicate menu", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync({ id: confirmDelete.id });
      toast({ title: "Menu deleted", description: confirmDelete.name });
      setConfirmDelete(null);
      await refresh();
    } catch (err: any) {
      toast({ title: err?.message || "Could not delete menu", variant: "destructive" });
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Menus</h2>
          <p className="text-muted-foreground mt-1">Navigation structures for your sites.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Create menu
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          Array(2)
            .fill(0)
            .map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-1/2" />
                </CardHeader>
              </Card>
            ))
        ) : menus.length ? (
          <AnimatePresence initial={false}>
            {menus.map((m) => {
              const parsed = parseItems(m.items);
              return (
                <motion.div key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Card className="border-border/50 hover:border-primary/40 transition-colors h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <MenuIcon className="h-4 w-4 text-primary" />
                            {m.name}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="capitalize">{m.location}</Badge>
                            {parsed.length} item{parsed.length === 1 ? "" : "s"}
                          </CardDescription>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => openEdit(m)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Duplicate" onClick={() => void duplicate(m)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Delete" onClick={() => setConfirmDelete(m)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {parsed.length ? (
                          parsed.map((it, i) => (
                            <li key={i}>
                              <span className="font-medium">{it.label}</span> <span className="text-muted-foreground text-xs">{it.url}</span>
                              {it.children?.map((c, j) => (
                                <div key={j} className="ml-4 flex items-center gap-1 text-xs text-muted-foreground">
                                  <CornerDownRight className="h-3 w-3" /> {c.label} <span className="opacity-70">{c.url}</span>
                                </div>
                              ))}
                            </li>
                          ))
                        ) : (
                          <li className="text-muted-foreground text-xs">No items yet.</li>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed rounded-lg">
            <MenuIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-3">No menus yet.</p>
            <Button onClick={openNew}>Create menu</Button>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit menu" : "Create menu"}</DialogTitle>
            <DialogDescription>Build the menu visually, or edit the JSON directly.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input list="menu-locations" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="header, footer, sidebar" />
                <datalist id="menu-locations">
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </div>
            </div>

            <Tabs value={tab} onValueChange={changeTab}>
              <TabsList>
                <TabsTrigger value="visual">Visual builder</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="visual" className="space-y-3">
                {items.map((it, idx) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-2 bg-card/50">
                    <div className="flex gap-2 items-center">
                      <Input className="flex-1" placeholder="Label" value={it.label} onChange={(e) => patchItem(idx, { label: e.target.value })} />
                      <Input className="flex-1 font-mono text-xs" placeholder="/path or https://…" value={it.url} onChange={(e) => patchItem(idx, { url: e.target.value })} />
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9" disabled={idx === 0} onClick={() => setItems((p) => move(p, idx, idx - 1))}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9" disabled={idx === items.length - 1} onClick={() => setItems((p) => move(p, idx, idx + 1))}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-destructive" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {it.children?.map((c, cIdx) => (
                      <div key={cIdx} className="flex gap-2 items-center ml-6">
                        <CornerDownRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        <Input className="flex-1" placeholder="Sub-item label" value={c.label} onChange={(e) => patchChild(idx, cIdx, { label: e.target.value })} />
                        <Input className="flex-1 font-mono text-xs" placeholder="/path" value={c.url} onChange={(e) => patchChild(idx, cIdx, { url: e.target.value })} />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-destructive"
                          onClick={() => patchItem(idx, { children: (it.children ?? []).filter((_, j) => j !== cIdx) })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="ghost" className="ml-6 h-7 text-xs" onClick={() => patchItem(idx, { children: [...(it.children ?? []), { label: "", url: "" }] })}>
                      <Plus className="h-3 w-3 mr-1" /> Sub-item
                    </Button>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setItems((p) => [...p, { label: "", url: "" }])}>
                    <Plus className="h-4 w-4 mr-1" /> Custom link
                  </Button>
                  {pages.length > 0 && (
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value=""
                      onChange={(e) => {
                        const pg = pages.find((p) => String(p.id) === e.target.value);
                        if (pg) setItems((p) => [...p, { label: pg.title, url: `/${pg.slug.replace(/^\//, "")}` }]);
                      }}
                    >
                      <option value="">+ Add a page…</option>
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  )}
                  {pages.length > 0 && <FileText className="h-4 w-4 text-muted-foreground self-center" />}
                </div>
              </TabsContent>

              <TabsContent value="json">
                <textarea
                  className="w-full min-h-[220px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
                  value={itemsJson}
                  onChange={(e) => setItemsJson(e.target.value)}
                />
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
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
            <DialogDescription>This removes the menu from your sites. This cannot be undone.</DialogDescription>
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
