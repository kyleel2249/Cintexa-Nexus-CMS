import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Mail, Users, Trash2, Upload, Download, CheckCircle2, XCircle } from "lucide-react";

interface Subscriber {
  id: number;
  email: string;
  name: string | null;
  status: string;
  createdAt: string;
}

export default function Subscribers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [search, setSearch] = useState("");

  const { data: subscribers = [], isLoading } = useQuery<Subscriber[]>({
    queryKey: ["/api/subscribers"],
    queryFn: async () => {
      const res = await fetch("/api/subscribers");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async ({ email, name }: { email: string; name: string }) => {
      const res = await fetch("/api/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to add");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
      toast({ title: "Subscriber added" });
      setAddOpen(false);
      setNewEmail("");
      setNewName("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/subscribers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
      toast({ title: "Subscriber removed" });
    },
    onError: () => toast({ title: "Failed to remove subscriber", variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async (subs: Array<{ email: string; name?: string }>) => {
      const res = await fetch("/api/subscribers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribers: subs }),
      });
      if (!res.ok) throw new Error("Import failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
      toast({ title: `Imported ${data.added} subscriber(s), skipped ${data.skipped}` });
      setImportOpen(false);
      setCsvText("");
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const handleImport = () => {
    const lines = csvText.trim().split("\n").filter(Boolean);
    const subs = lines.map((line) => {
      const [email, name] = line.split(",").map((s) => s.trim());
      return { email, name: name || undefined };
    }).filter((s) => s.email && s.email.includes("@"));
    if (subs.length === 0) return toast({ title: "No valid emails found", variant: "destructive" });
    importMutation.mutate(subs);
  };

  const handleExport = () => {
    const header = ["Name", "Email", "Status", "Signup Date"];
    const rows = subscribers.map((s) => [
      s.name ?? "",
      s.email,
      s.status,
      new Date(s.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${subscribers.length} subscriber${subscribers.length !== 1 ? "s" : ""}` });
  };

  const filtered = subscribers.filter((s) =>
    s.email.toLowerCase().includes(search.toLowerCase()) ||
    (s.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const active = subscribers.filter((s) => s.status === "active").length;
  const unsubscribed = subscribers.filter((s) => s.status === "unsubscribed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Subscribers</h1>
          <p className="text-muted-foreground mt-1">Manage your email subscriber list</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={subscribers.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>

          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Upload className="w-4 h-4 mr-2" />Import CSV</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Import Subscribers</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Paste one subscriber per line: <code className="bg-secondary px-1 rounded">email, name</code> (name is optional)</p>
                <Textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={"jane@example.com, Jane Smith\njohn@example.com"}
                  className="min-h-[160px] font-mono text-sm"
                />
                <Button onClick={handleImport} disabled={importMutation.isPending} className="w-full">
                  {importMutation.isPending ? "Importing..." : "Import"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-2" />Add Subscriber</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Subscriber</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@example.com" type="email" />
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Optional" />
                </div>
                <Button
                  onClick={() => addMutation.mutate({ email: newEmail, name: newName })}
                  disabled={!newEmail || addMutation.isPending}
                  className="w-full"
                >
                  {addMutation.isPending ? "Adding..." : "Add Subscriber"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border/50">
          <CardContent className="pt-6 flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{subscribers.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="pt-6 flex items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-2xl font-bold text-green-400">{active}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="pt-6 flex items-center gap-3">
            <XCircle className="w-8 h-8 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold">{unsubscribed}</p>
              <p className="text-xs text-muted-foreground">Unsubscribed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Input
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium">Subscriber List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Mail className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{search ? "No results found" : "No subscribers yet. Add your first subscriber above."}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filtered.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between px-6 py-3 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                      {(sub.name ?? sub.email)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{sub.name ?? sub.email}</p>
                      {sub.name && <p className="text-xs text-muted-foreground truncate">{sub.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge
                      variant="outline"
                      className={sub.status === "active" ? "border-green-500/40 text-green-400" : "border-border text-muted-foreground"}
                    >
                      {sub.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(sub.createdAt).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(sub.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
