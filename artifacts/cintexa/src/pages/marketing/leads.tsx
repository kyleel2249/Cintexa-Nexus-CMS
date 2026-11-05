import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";
import { probeSalesLocal } from "@/lib/marketing/sales-bridge";
import { Link } from "wouter";

export default function LeadGeneration() {
  const qc = useQueryClient();
  const [salesBridge, setSalesBridge] = useState<string>("");
  useEffect(() => {
    probeSalesLocal().then((s) => {
      if (s.available) {
        setSalesBridge(
          s.totalLeads != null
            ? `${s.note}`
            : s.note,
        );
      } else {
        setSalesBridge(s.reason);
      }
    });
  }, []);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [score, setScore] = useState("0");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "leads"],
    queryFn: () => marketingApi.listLeads(),
  });

  const create = useMutation({
    mutationFn: () =>
      marketingApi.createLead({
        name,
        email: email || null,
        source: source || null,
        score: Number(score) || 0,
        status: "new",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      setOpen(false);
      setName("");
      setEmail("");
      setSource("");
      setScore("0");
    },
  });

  const qualify = useMutation({
    mutationFn: (id: number) => marketingApi.updateLead(id, { status: "qualified", score: 60 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "leads"] }),
  });

  const items = data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Generation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Marketing-sourced leads stored on this device. For full CRM pipeline use{" "}
            <Link href="/sales/leads" className="underline">Sales → Leads</Link> (shared business records when Sales is in use).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add lead</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New marketing lead</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></div>
              <div><Label>Source</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Landing page / webinar / form" /></div>
              <div><Label>Score</Label><Input value={score} onChange={(e) => setScore(e.target.value)} type="number" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-4"><p className="text-2xl font-semibold tabular-nums">{items.length}</p><p className="text-xs text-muted-foreground">Total leads</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-semibold tabular-nums">{items.filter((l) => l.status === "qualified").length}</p><p className="text-xs text-muted-foreground">Qualified</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-2xl font-semibold tabular-nums">{items.filter((l) => l.status === "new").length}</p><p className="text-xs text-muted-foreground">New</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Leads</CardTitle>
          <CardDescription>Audience insights from marketing capture. No external CRM required.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
                {!isLoading && items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No leads yet.</td></tr>}
                {items.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.email || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{l.source || "—"}</td>
                    <td className="px-4 py-3"><Badge variant="secondary">{l.status}</Badge></td>
                    <td className="px-4 py-3 tabular-nums">{l.score}</td>
                    <td className="px-4 py-3">
                      {l.status === "new" && (
                        <Button size="sm" variant="outline" onClick={() => qualify.mutate(l.id)}>Qualify</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
