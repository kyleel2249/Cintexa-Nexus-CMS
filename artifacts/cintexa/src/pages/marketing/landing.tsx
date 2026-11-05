import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingIntel, marketingAssets } from "@/lib/marketing/api";
import { Link } from "wouter";
import { CmsPagesPicker } from "@/components/marketing/CmsPagesPicker";
import { CmsFormsPicker } from "@/components/marketing/CmsFormsPicker";
import { readCachedFormSubmissionCount } from "@/lib/marketing/cms-cache/cmsCacheReader";

export default function LandingFunnelsPage() {
  const qc = useQueryClient();
  // qc used for funnel updates + CMS submission cache reads
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pagePath, setPagePath] = useState("/");
  const [formName, setFormName] = useState("");
  const [refOpen, setRefOpen] = useState(false);
  const [refTitle, setRefTitle] = useState("");
  const [refPath, setRefPath] = useState("/");
  const [formRefOpen, setFormRefOpen] = useState(false);
  const [formRefName, setFormRefName] = useState("");

  useEffect(() => { marketingIntel.ensureSeed(); }, []);

  const funnels = useQuery({ queryKey: ["mkt", "funnels"], queryFn: () => marketingIntel.listFunnels() });
  const pageRefs = useQuery({ queryKey: ["mkt", "pageRefs"], queryFn: () => marketingAssets.listPageRefs() });
  const formRefs = useQuery({ queryKey: ["mkt", "formRefs"], queryFn: () => marketingAssets.listFormRefs() });

  const create = useMutation({
    mutationFn: () => marketingIntel.createFunnel({
      name,
      page_path: pagePath,
      form_ref: formName || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "funnels"] }); setOpen(false); setName(""); },
  });

  const addPage = useMutation({
    mutationFn: () => marketingAssets.createPageRef({ title: refTitle, path: refPath }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "pageRefs"] }); setRefOpen(false); setRefTitle(""); },
  });

  const addForm = useMutation({
    mutationFn: () => marketingAssets.createFormRef({ name: formRefName }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "formRefs"] }); setFormRefOpen(false); setFormRefName(""); },
  });

  const updateFunnel = useMutation({
    mutationFn: ({ id, stages }: { id: number; stages: any[] }) => marketingIntel.updateFunnel(id, { stages }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mkt", "funnels"] }),
  });

  const items = funnels.data?.items || [];

  function stageMetrics(stages: { actual_count?: number }[], i: number) {
    const cur = Number(stages[i]?.actual_count || 0);
    const prev = i > 0 ? Number(stages[i - 1]?.actual_count || 0) : null;
    const conv = prev && prev > 0 ? Math.round((cur / prev) * 1000) / 10 : null;
    const drop = prev != null ? prev - cur : null;
    return { cur, prev, conv, drop };
  }
  const pages = pageRefs.data?.items || [];
  const forms = formRefs.data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing Pages & Funnels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reference Nexus pages and forms by path/name (local registry).{" "}
            <Link href="/pages" className="underline">Pages</Link>
            {" · "}
            <Link href="/forms" className="underline">Forms</Link>
            {" — no second CMS."}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New funnel</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create funnel</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div>
                <Label>Landing page</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm mb-1" value={pagePath} onChange={(e) => setPagePath(e.target.value)}>
                  <option value="/">/ (home)</option>
                  {pages.map((p) => <option key={p.id} value={p.path}>{p.title} ({p.path})</option>)}
                </select>
                <Input value={pagePath} onChange={(e) => setPagePath(e.target.value)} placeholder="Or type path…" className="mt-1" />
              </div>
              <div>
                <Label>Form (optional)</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm mb-1" value={formName} onChange={(e) => setFormName(e.target.value)}>
                  <option value="">— None —</option>
                  {forms.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                </select>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Or type form name…" className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Page registry</CardTitle>
              <CardDescription>Paths you use as landing pages</CardDescription>
            </div>
            <div className="flex gap-1">
            <CmsPagesPicker
              triggerLabel="Browse cached pages"
              onSelect={(page) => {
                marketingAssets.createPageRef({
                  title: page.title,
                  path: page.slug ? `/${page.slug}` : page.url || "/",
                  notes: `cmsPageId=${page.cmsPageId}`,
                }).then(() => qc.invalidateQueries({ queryKey: ["mkt", "pageRefs"] }));
              }}
            />
            <Dialog open={refOpen} onOpenChange={setRefOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline">Add page</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Register page path</DialogTitle></DialogHeader>
                <div className="space-y-2">
                  <div><Label>Title</Label><Input value={refTitle} onChange={(e) => setRefTitle(e.target.value)} /></div>
                  <div><Label>Path</Label><Input value={refPath} onChange={(e) => setRefPath(e.target.value)} placeholder="/services" /></div>
                </div>
                <DialogFooter>
                  <Button disabled={!refTitle.trim() || addPage.isPending} onClick={() => addPage.mutate()}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {pages.map((p) => (
              <div key={p.id} className="text-sm flex justify-between border rounded px-2 py-1">
                <span>{p.title}</span>
                <code className="text-xs text-muted-foreground">{p.path}</code>
              </div>
            ))}
            {!pages.length && <p className="text-xs text-muted-foreground">Add pages from the builder paths you use.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Form registry</CardTitle>
              <CardDescription>Forms linked to conversion steps</CardDescription>
            </div>
            <div className="flex gap-1 flex-wrap">
            <CmsFormsPicker
              triggerLabel="Browse cached forms"
              onSelect={(f) => {
                marketingAssets.createFormRef({ name: f.name, form_id: f.cmsFormId, notes: f.submissionCount != null ? `submissions=${f.submissionCount}` : undefined }).then(() => qc.invalidateQueries({ queryKey: ["mkt", "formRefs"] }));
              }}
            />
            <Dialog open={formRefOpen} onOpenChange={setFormRefOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline">Add form</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Register form</DialogTitle></DialogHeader>
                <div><Label>Name</Label><Input value={formRefName} onChange={(e) => setFormRefName(e.target.value)} placeholder="Contact form" /></div>
                <DialogFooter>
                  <Button disabled={!formRefName.trim() || addForm.isPending} onClick={() => addForm.mutate()}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {forms.map((f) => (
              <div key={f.id} className="text-sm border rounded px-2 py-1">{f.name}</div>
            ))}
            {!forms.length && <p className="text-xs text-muted-foreground">Register form names from Nexus Forms.</p>}
          </CardContent>
        </Card>
      </div>

      {items.map((f) => (
        <Card key={f.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{f.name}</CardTitle>
            <CardDescription>
              Page: <code className="text-xs">{f.page_path || "—"}</code>
              {f.form_ref ? <> · Form: {f.form_ref}</> : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {f.stages.map((st, i) => {
                const m = stageMetrics(f.stages, i);
                return (
                  <div key={st.id} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                    <div className="min-w-[120px]">
                      <p className="text-xs font-medium">{st.name}</p>
                      {m.conv != null && (
                        <p className="text-[10px] text-muted-foreground">Conv {m.conv}% · drop {m.drop}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-[10px]">Count</Label>
                      <Input
                        className="h-8 w-24"
                        type="number"
                        defaultValue={st.actual_count ?? 0}
                        onBlur={(e) => {
                          const val = Number(e.target.value) || 0;
                          const stages = f.stages.map((s, idx) =>
                            idx === i ? { ...s, actual_count: val } : s,
                          );
                          updateFunnel.mutate({ id: f.id, stages });
                        }}
                      />
                      <Badge variant="outline" className="text-[9px]">MANUAL</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Conversion = stage ÷ previous stage. Default provenance: MANUAL.
            </p>
            {f.form_ref && forms.some((fr) => fr.name === f.form_ref && fr.notes?.includes("submissions=")) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const fr = forms.find((x) => x.name === f.form_ref);
                    let count: number | null = null;
                    if (fr?.form_id != null) {
                      const live = readCachedFormSubmissionCount(qc, fr.form_id);
                      if (live.available && live.count != null) count = live.count;
                    }
                    if (count == null) {
                      const m = fr?.notes?.match(/submissions=(\d+)/);
                      count = m ? Number(m[1]) : null;
                    }
                    if (count == null || !confirm(`Apply CMS CACHE submission count (${count}) to the form/conversion stage? Explicit override — provenance becomes MANUAL OVERRIDE.`)) return;
                    const stages = f.stages.map((s) => ({ ...s }));
                    let idx = stages.findIndex((s) => /form|submission|convert/i.test(s.name));
                    if (idx < 0) idx = Math.min(3, stages.length - 1);
                    stages[idx] = { ...stages[idx], actual_count: count };
                    updateFunnel.mutate({ id: f.id, stages });
                  }}
                >
                  Apply CMS count to stage
                </Button>
                <Badge variant="outline" className="text-[9px]">CMS CACHE → MANUAL OVERRIDE when applied</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
