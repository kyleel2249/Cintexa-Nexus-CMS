import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { apiJson } from "@/lib/api";

type Campaign = {
  id: number;
  number: string;
  name: string;
  status: string;
  priority: string;
  budget: number;
  spent: number;
  start_date?: string;
  end_date?: string;
  channels?: string[];
  updated_at?: string;
};

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketing", "campaigns", statusFilter],
    queryFn: async () => {
      const q = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      return apiJson<{ items: Campaign[]; total: number }>(`/marketing/campaigns${q}`);
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      return apiJson("/marketing/campaigns", { method: "POST", body: JSON.stringify({
        name,
        objective: objective || undefined,
        budget: budget ? Number(budget) : 0,
        status: "DRAFT",
      }) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      setOpen(false);
      setName("");
      setObjective("");
      setBudget("");
    },
  });

  const items = data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaign Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">Create, track and transition marketing campaigns. Lifecycle: DRAFT → PLANNED → APPROVED → ACTIVE → PAUSED → COMPLETED → ARCHIVED.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Campaign</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="c-name">Name</Label>
                <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 Product Launch" />
              </div>
              <div>
                <Label htmlFor="c-obj">Objective</Label>
                <Input id="c-obj" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Generate 200 qualified leads" />
              </div>
              <div>
                <Label htmlFor="c-budget">Budget (USD)</Label>
                <Input id="c-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="5000" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["DRAFT","PLANNED","APPROVED","ACTIVE","PAUSED","COMPLETED","ARCHIVED"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{data?.total ?? 0} campaigns</span>
      </div>

      {error && <p className="text-sm text-destructive">Failed to load campaigns.</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Budget</th>
                  <th className="px-4 py-3 font-medium">Dates</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No campaigns match the filter.</td></tr>
                )}
                {items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/marketing/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{c.number}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="secondary">{c.status}</Badge></td>
                    <td className="px-4 py-3">{c.priority}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(c.budget || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {c.start_date || "—"} → {c.end_date || "—"}
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
