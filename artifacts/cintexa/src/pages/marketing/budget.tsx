import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { marketingApi } from "@/lib/marketing/api";

function money(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

export default function BudgetRoi() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [spent, setSpent] = useState("0");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "budgets"],
    queryFn: () => marketingApi.listBudgets(),
  });

  const overview = useQuery({
    queryKey: ["marketing", "overview"],
    queryFn: () => marketingApi.overview(),
  });

  const create = useMutation({
    mutationFn: () =>
      marketingApi.createBudget({
        name,
        amount: Number(amount) || 0,
        spent: Number(spent) || 0,
        period_start: start || new Date().toISOString().slice(0, 10),
        period_end: end || new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing"] });
      setOpen(false);
      setName("");
      setAmount("");
      setSpent("0");
    },
  });

  const items = data?.items || [];
  const totalAmount = items.reduce((s, b) => s + b.amount, 0);
  const totalSpent = items.reduce((s, b) => s + b.spent, 0);
  const leads = overview.data?.kpis.leadsGenerated ?? 0;
  const cpl = leads > 0 ? totalSpent / leads : null;
  const util = totalAmount > 0 ? Math.round((totalSpent / totalAmount) * 1000) / 10 : 0;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Budget & ROI</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track marketing spend and simple ROI signals from stored budgets and leads. No fabricated analytics.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add budget</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Budget line</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q4 paid social" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div><Label>Spent</Label><Input type="number" value={spent} onChange={(e) => setSpent(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
                <div><Label>End</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4"><p className="text-xl font-semibold tabular-nums">{money(totalAmount)}</p><p className="text-xs text-muted-foreground">Total budget</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xl font-semibold tabular-nums">{money(totalSpent)}</p><p className="text-xs text-muted-foreground">Spent</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xl font-semibold tabular-nums">{util}%</p><p className="text-xs text-muted-foreground">Utilisation</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xl font-semibold tabular-nums">{cpl != null ? money(cpl) : "—"}</p><p className="text-xs text-muted-foreground">Cost per lead (stored)</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Budget lines</CardTitle>
          <CardDescription>Enter actual spend manually. ROI uses only numbers you store.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Spent</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No budget lines yet.</td></tr>}
              {items.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{b.period_start} → {b.period_end}</td>
                  <td className="px-4 py-3 tabular-nums">{money(b.amount)}</td>
                  <td className="px-4 py-3 tabular-nums">{money(b.spent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
