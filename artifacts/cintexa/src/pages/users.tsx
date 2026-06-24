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
import { UserPlus, Search, Shield, KeyRound, Eye, EyeOff, CheckCircle2, MoreVertical } from "lucide-react";
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
  lastLoginAt: string | null;
  createdAt: string;
}

function SetPasswordDialog({ user, onClose }: { user: CmsUser; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    if (password !== confirm) { toast({ title: "Passwords do not match", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem("cintexa_token");
      const res = await fetch(`/api/users/${user.id}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to set password");
      toast({ title: `Password updated for ${user.name}` });
      onClose();
    } catch (err: any) {
      toast({ title: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const strength = [
    { label: "8+ chars", ok: password.length >= 8 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /\d/.test(password) },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40">
        <Avatar className="h-9 w-9">
          {user.avatar && <AvatarImage src={user.avatar} />}
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
            {user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <Badge variant="outline" className={`ml-auto text-[10px] py-0 h-4 ${user.role === "admin" ? "border-purple-500/40 text-purple-400" : "border-blue-500/40 text-blue-400"}`}>
          {user.role}
        </Badge>
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-password">New Password</Label>
        <div className="relative">
          <Input
            id="new-password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="pr-10 h-10"
            required
          />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShow((v) => !v)} tabIndex={-1}>
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {password && (
          <div className="flex gap-3 pt-0.5">
            {strength.map((s) => (
              <span key={s.label} className={`flex items-center gap-1 text-[11px] ${s.ok ? "text-green-400" : "text-muted-foreground"}`}>
                <CheckCircle2 className={`w-3 h-3 ${s.ok ? "text-green-400" : "text-muted-foreground"}`} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input
          id="confirm-password"
          type={show ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          className={`h-10 ${confirm && confirm !== password ? "border-destructive" : ""}`}
          required
        />
        {confirm && confirm !== password && <p className="text-xs text-destructive">Passwords do not match</p>}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button type="submit" className="flex-1" disabled={loading || !password || password !== confirm}>
          {loading ? "Saving..." : "Set Password"}
        </Button>
      </div>
    </form>
  );
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
      const token = localStorage.getItem("cintexa_token");
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
      <p className="text-xs text-muted-foreground">Use "Set Password" on the user card to assign their login credentials.</p>
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
  const [setPasswordUser, setSetPasswordUser] = useState<CmsUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery<CmsUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const token = localStorage.getItem("cintexa_token");
      const res = await fetch("/api/users", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const token = localStorage.getItem("cintexa_token");
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
                      <DropdownMenuItem onClick={() => setSetPasswordUser(user)} className="cursor-pointer">
                        <KeyRound className="mr-2 h-4 w-4" />
                        Set Password
                      </DropdownMenuItem>
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
                      {user.lastLoginAt && (
                        <p className="text-[10px] text-muted-foreground/60">
                          Last login {new Date(user.lastLoginAt).toLocaleDateString()}
                        </p>
                      )}
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

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs gap-1.5"
                      onClick={() => setSetPasswordUser(user)}
                    >
                      <KeyRound className="w-3 h-3" />
                      Set Password
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      <Dialog open={!!setPasswordUser} onOpenChange={(open) => { if (!open) setSetPasswordUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" />
              Set Password
            </DialogTitle>
          </DialogHeader>
          {setPasswordUser && (
            <SetPasswordDialog user={setPasswordUser} onClose={() => setSetPasswordUser(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}