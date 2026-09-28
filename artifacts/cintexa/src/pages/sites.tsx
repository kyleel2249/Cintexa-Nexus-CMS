import { useMemo, useState } from "react";
import { useGetSites, useCreateSite, useUpdateSite, useDeleteSite, getGetSitesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Globe, Settings, ExternalLink, Loader2, Trash2, Power } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const LOCAL_SITES_KEY = "cintexa-local-sites";

function readLocalSites(): any[] {
  try {
    const raw = localStorage.getItem(LOCAL_SITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalSites(sites: any[]) {
  try {
    localStorage.setItem(LOCAL_SITES_KEY, JSON.stringify(sites));
  } catch {
    /* ignore quota */
  }
}

function normalizeDomain(domain: string) {
  return domain.trim().replace(/\/+$/, "");
}

export default function Sites() {
  const { data: sitesData, isLoading, isError, error, refetch } = useGetSites();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const [editSite, setEditSite] = useState<any | null>(null);
  const [eName, setEName] = useState("");
  const [eDomain, setEDomain] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eColor, setEColor] = useState("");
  const [eLang, setELang] = useState("en");
  const [eTz, setETz] = useState("UTC");
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [description, setDescription] = useState("");
  const [localVersion, setLocalVersion] = useState(0);

  const sites = useMemo(() => {
    let remote: any[] = [];
    if (Array.isArray(sitesData)) remote = sitesData as any[];
    else if (sitesData && typeof sitesData === "object" && Array.isArray((sitesData as any).data)) {
      remote = (sitesData as any).data;
    }
    const local = typeof window !== "undefined" ? readLocalSites() : [];
    const byId = new Map<number | string, any>();
    for (const s of remote) byId.set(s.id, s);
    for (const s of local) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
    return Array.from(byId.values());
  }, [sitesData, localVersion]);

  function openEdit(site: any) {
    setEditSite(site);
    setEName(site.name || "");
    setEDomain(site.domain || "");
    setEDesc(site.description || "");
    setEColor(site.primaryColor || "");
    setELang(site.language || "en");
    setETz(site.timezone || "UTC");
  }

  async function persistSite(site: any, patch: Record<string, unknown>) {
    if (site._local) {
      writeLocalSites(readLocalSites().map((x) => (x.id === site.id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)));
      setLocalVersion((v) => v + 1);
      return;
    }
    await updateSite.mutateAsync({ id: site.id, data: patch as any });
    await qc.invalidateQueries({ queryKey: getGetSitesQueryKey() });
    void refetch();
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editSite) return;
    if (!eName.trim() || !eDomain.trim()) {
      toast({ title: "Name and domain are required", variant: "destructive" });
      return;
    }
    try {
      await persistSite(editSite, {
        name: eName.trim(),
        domain: normalizeDomain(eDomain),
        description: eDesc.trim(),
        primaryColor: eColor.trim() || undefined,
        language: eLang.trim() || "en",
        timezone: eTz.trim() || "UTC",
      });
      toast({ title: "Site updated" });
      setEditSite(null);
    } catch (err: any) {
      toast({ title: err?.message || "Could not update site", variant: "destructive" });
    }
  }

  async function toggleStatus(site: any) {
    const next = String(site.status).toLowerCase() === "active" ? "paused" : "active";
    try {
      await persistSite(site, { status: next });
      toast({ title: next === "active" ? "Site activated" : "Site paused", description: site.name });
    } catch (err: any) {
      toast({ title: err?.message || "Could not change status", variant: "destructive" });
    }
  }

  async function removeSite() {
    if (!confirmDelete) return;
    try {
      if (confirmDelete._local) {
        writeLocalSites(readLocalSites().filter((x) => x.id !== confirmDelete.id));
        setLocalVersion((v) => v + 1);
      } else {
        await deleteSite.mutateAsync({ id: confirmDelete.id });
        await qc.invalidateQueries({ queryKey: getGetSitesQueryKey() });
        void refetch();
      }
      toast({ title: "Site removed", description: confirmDelete.name });
      setConfirmDelete(null);
    } catch (err: any) {
      toast({ title: err?.message || "Could not delete site", variant: "destructive" });
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim()) {
      toast({ title: "Name and domain are required", variant: "destructive" });
      return;
    }
    const payload = {
      name: name.trim(),
      domain: normalizeDomain(domain),
      description: description.trim() || undefined,
    };
    try {
      await createSite.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getGetSitesQueryKey() });
      toast({ title: "Site created", description: payload.name });
      setOpen(false);
      setName("");
      setDomain("");
      setDescription("");
      void refetch();
    } catch (err: any) {
      const status = err?.status || err?.response?.status || err?.statusCode;
      const msg = String(err?.message || err || "");
      // When static host returns 405 (no API), persist locally so the feature still works
      if (status === 405 || status === 404 || status === 503 || /405|Method Not Allowed|Failed to fetch|NetworkError/i.test(msg)) {
        const local = readLocalSites();
        const now = new Date().toISOString();
        const site = {
          id: Date.now(),
          name: payload.name,
          domain: payload.domain,
          description: payload.description || null,
          status: "active",
          language: "en",
          timezone: "UTC",
          createdAt: now,
          updatedAt: now,
          _local: true,
        };
        writeLocalSites([site, ...local]);
        setLocalVersion((v) => v + 1);
        await qc.invalidateQueries({ queryKey: getGetSitesQueryKey() });
        toast({
          title: "Site saved locally",
          description: "API returned " + (status || "unavailable") + ". Site is stored in this browser until the API is connected.",
        });
        setOpen(false);
        setName("");
        setDomain("");
        setDescription("");
        void refetch();
        return;
      }
      toast({ title: msg || "Could not create site", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Sites</h2>
          <p className="text-muted-foreground mt-1">Manage your connected websites and domains.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Site
        </Button>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          Could not load sites{(error as any)?.message ? `: ${(error as any).message}` : ""}. Showing an empty list.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))
        ) : sites?.length ? (
          sites.map((site) => (
            <Card key={site.id} className="border-border/50 bg-card hover:border-primary/50 transition-colors group">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">{site.name}</span>
                    </CardTitle>
                    <CardDescription className="truncate">{site.domain}</CardDescription>
                  </div>
                  <Badge variant={String(site.status).toLowerCase() === "active" ? "default" : "secondary"} className="capitalize">{site.status}{site._local ? " · local" : ""}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[40px]">
                  {site.description || "No description provided."}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/50">
                  <span>Added {format(new Date(site.createdAt), "MMM d, yyyy")}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                      <a href={`https://${site.domain.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Pause / activate" onClick={() => void toggleStatus(site)}>
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Site settings" onClick={() => openEdit(site)}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => setConfirmDelete(site)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-lg">
            <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium">No sites yet</h3>
            <p className="text-muted-foreground mb-4">Connect your first website or domain.</p>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Site
            </Button>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add site</DialogTitle>
            <DialogDescription>Register a domain for multi-site management in Nexus.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="site-name">Name</Label>
              <Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing site" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-domain">Domain</Label>
              <Input id="site-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.example.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site-desc">Description</Label>
              <Input id="site-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createSite.isPending}>
                {createSite.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create site
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editSite} onOpenChange={(o) => !o && setEditSite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Site settings</DialogTitle>
            <DialogDescription>Update the details for {editSite?.name}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={eName} onChange={(e) => setEName(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Domain</Label><Input value={eDomain} onChange={(e) => setEDomain(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={eDesc} onChange={(e) => setEDesc(e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>Brand colour</Label><Input type="text" value={eColor} onChange={(e) => setEColor(e.target.value)} placeholder="#D4AF37" /></div>
              <div className="space-y-2"><Label>Language</Label><Input value={eLang} onChange={(e) => setELang(e.target.value)} /></div>
              <div className="space-y-2"><Label>Timezone</Label><Input value={eTz} onChange={(e) => setETz(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditSite(null)}>Cancel</Button>
              <Button type="submit" disabled={updateSite.isPending}>{updateSite.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>The site is removed from Nexus. Pages assigned to it are kept but become unassigned.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void removeSite()} disabled={deleteSite.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
