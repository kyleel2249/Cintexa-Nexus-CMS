import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingIntel } from "@/lib/marketing/api";
import { Link } from "wouter";

export default function LandingFunnelsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pagePath, setPagePath] = useState("/");

  useEffect(() => { marketingIntel.ensureSeed(); }, []);

  const funnels = useQuery({ queryKey: ["mkt", "funnels"], queryFn: () => marketingIntel.listFunnels() });

  const create = useMutation({
    mutationFn: () => marketingIntel.createFunnel({ name, page_path: pagePath }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "funnels"] }); setOpen(false); setName(""); },
  });

  const items = funnels.data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing Pages & Funnels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reference existing Nexus pages and forms — no second CMS.{" "}
            <Link href="/pages" className="underline">Open page builder</Link>
            {" · "}
            <Link href="/forms" className="underline">Forms</Link>
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New funnel</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create funnel</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Landing page path (existing Nexus page)</Label><Input value={pagePath} onChange={(e) => setPagePath(e.target.value)} placeholder="/" /></div>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {items.map((f) => (
        <Card key={f.id}>
          <CardHeader className="pb-2">
            <div className="flex justify-between gap-2">
              <div>
                <CardTitle className="text-base">{f.name}</CardTitle>
                <CardDescription>
                  Page: <code className="text-xs">{f.page_path || "—"}</code>
                  {f.form_ref ? ` · Form: ${f.form_ref}` : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-0">
              {f.stages.map((st, i) => (
                <div key={st.id} className="flex items-center gap-2">
                  <div className="rounded-md border px-2 py-1.5 text-center min-w-[88px]">
                    <p className="text-xs font-medium">{st.name}</p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">{st.actual_count ?? 0}</p>
                  </div>
                  {i < f.stages.length - 1 && <span className="hidden sm:inline text-muted-foreground px-1">→</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Counts are MANUAL unless wired to form submissions. Provenance: MANUAL.</p>
          </CardContent>
        </Card>
      ))}
      {!items.length && <p className="text-sm text-muted-foreground text-center py-8">No funnels yet.</p>}
    </div>
  );
}
