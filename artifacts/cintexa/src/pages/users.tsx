import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPlus, Search, Shield, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CmsUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar: string | null;
  status: string;
  createdAt: string;
}

function InviteUserDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create user");
      toast({ title: `User ${name} added` });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      onClose();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Full Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required className="h-10" />
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" required className="h-10" />
      </div>
      <div className="space-y-2">
        <Label>Role</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" disabled={loading || !name || !email}>
          {loading ? "Adding..." : "Add User"}
        </Button>
      </div>
    </form>
  );
}

export default function Users() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery<CmsUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/users"] }); toast({ title: "User updated" }); },
    onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
  });

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Team</h2>
          <p className="text-muted-foreground mt-1">Manage user access and roles.</p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="mr-2 h-4 w-4" />Add User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
            <InviteUserDialog onClose={() => setInviteOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} user{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {isLoading
          ? Array(8).fill(0).map((_, i) => (
              <Card key={i} className="border-border/50 bg-card/50">
                <CardContent className="p-6">
                  <div className="flex flex-col items-center text-center space-y-4">
                    <Skeleton className="h-16 w-16 rounded-full" />
                    <div className="space-y-2 w-full flex flex-col items-center">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))
          : filtered.map((user) => (
              <Card key={user.id} className="border-border/50 bg-card hover:border-primary/50 transition-colors relative overflow-hidden group">
                <div className="absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => toggleStatusMutation.mutate({ id: user.id, status: user.status === "active" ? "inactive" : "active" })}
                      >
                        {user.status === "active" ? "Deactivate" : "Activate"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <CardContent className="p-6">
                  <div className="flex flex-col items-center text-center space-y-4">
                    <Avatar className="h-16 w-16 border-2 border-background shadow-sm">
                      {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                      <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                        {user.name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="space-y-1">
                      <h3 className="font-semibold">{user.name}</h3>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-center">
                      <Badge variant="outline" className={`flex items-center gap-1 ${user.role === "admin" ? "border-purple-500/40 text-purple-400" : "border-blue-500/40 text-blue-400"}`}>
                        {user.role === "admin" && <Shield className="h-3 w-3" />}
                        {user.role}
                      </Badge>
                      <Badge variant="outline" className={user.status === "active" ? "border-green-500/40 text-green-400" : "border-border text-muted-foreground"}>
                        {user.status}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}