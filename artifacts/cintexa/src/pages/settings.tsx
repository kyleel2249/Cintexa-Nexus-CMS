import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, Save, Key, Shield, Webhook, Palette, Sun, Moon, Monitor, Loader2 } from "lucide-react";
import { useTheme, type Accent } from "@/components/ThemeProvider";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ACCENT_OPTIONS: { value: Accent; label: string; color: string }[] = [
  { value: "indigo", label: "Indigo", color: "hsl(239 84% 67%)" },
  { value: "violet", label: "Violet", color: "hsl(265 89% 66%)" },
  { value: "emerald", label: "Emerald", color: "hsl(160 84% 39%)" },
  { value: "rose", label: "Rose", color: "hsl(347 77% 50%)" },
  { value: "amber", label: "Amber", color: "hsl(38 92% 50%)" },
  { value: "cyan", label: "Cyan", color: "hsl(198 89% 48%)" },
];

function AppearanceCard() {
  const { theme, setTheme, accent, setAccent } = useTheme();
  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose your colour scheme and accent colour. Changes apply instantly across the entire app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-medium">Interface mode</Label>
          <div className="flex gap-2">
            {([
              { value: "light", label: "Light", Icon: Sun },
              { value: "dark", label: "Dark", Icon: Moon },
              { value: "system", label: "System", Icon: Monitor },
            ] as const).map(({ value, label, Icon }) => (
              <button key={value} onClick={() => setTheme(value)} className={cn("flex-1 flex flex-col items-center gap-2 py-3 px-2 rounded-xl border-2 text-xs font-medium transition-all", theme === value ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground")}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Label className="text-sm font-medium">Accent colour</Label>
          <div className="grid grid-cols-6 gap-2">
            {ACCENT_OPTIONS.map(({ value, label, color }) => (
              <button key={value} title={label} onClick={() => setAccent(value)} className={cn("group relative flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all", accent === value ? "border-foreground/40 scale-105 shadow-md" : "border-transparent hover:border-border")}>
                <span className="w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-card transition-all" style={{ backgroundColor: color, ["--tw-ring-color" as any]: accent === value ? color : "transparent" } as React.CSSProperties} />
                <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground transition-colors leading-none">{label}</span>
                {accent === value && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-foreground flex items-center justify-center"><svg viewBox="0 0 10 10" className="w-2 h-2 text-background fill-current"><path d="M2 5 L4 7 L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></span>}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Currently using <span className="font-medium text-foreground capitalize">{accent}</span>. Preference is saved to your browser.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const { user, changePassword } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Missing password fields", description: "Enter your current password and the new password twice.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Your new password must contain at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Confirm the new password exactly.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password changed", description: `The password for ${user?.email ?? "your account"} has been updated.` });
    } catch (error) {
      toast({ title: "Unable to change password", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Password & Security</CardTitle>
        <CardDescription>Change the password for your signed-in CINTEXA account. Your current password is required.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4 max-w-xl">
          <div className="space-y-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><p className="text-xs text-muted-foreground">Minimum 8 characters.</p></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}{saving ? "Changing…" : "Change Password"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div><h2 className="text-3xl font-bold tracking-tight">System Settings</h2><p className="text-muted-foreground mt-1">Configure global platform behaviour and your account security.</p></div>
        <Button><Save className="mr-2 h-4 w-4" />Save Changes</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="space-y-1 lg:col-span-1">
          <Button variant="ghost" className="w-full justify-start bg-secondary/50 text-foreground font-medium"><SettingsIcon className="mr-2 h-4 w-4" /> General</Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground"><Palette className="mr-2 h-4 w-4" /> Appearance</Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground"><Key className="mr-2 h-4 w-4" /> API Keys</Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground"><Webhook className="mr-2 h-4 w-4" /> Webhooks</Button>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground"><Shield className="mr-2 h-4 w-4" /> Security</Button>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <PasswordCard />
          <AppearanceCard />

          <Card className="bg-card border-border/50">
            <CardHeader><CardTitle>Platform Configuration</CardTitle><CardDescription>Core settings for the CINTEXA CMS platform.</CardDescription></CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2"><Label>Platform Name</Label><Input defaultValue="CINTEXA CMS" /></div>
              <div className="space-y-2"><Label>Support Email</Label><Input defaultValue="support@cintexa.com" type="email" /></div>
              <div className="pt-4 border-t border-border/50 space-y-4">
                <h4 className="text-sm font-semibold">Features</h4>
                <div className="flex items-center justify-between"><div className="space-y-0.5"><Label>Maintenance Mode</Label><p className="text-sm text-muted-foreground">Disables public access to all connected sites.</p></div><Switch /></div>
                <div className="flex items-center justify-between"><div className="space-y-0.5"><Label>User Registration</Label><p className="text-sm text-muted-foreground">Allow new users to sign up automatically.</p></div><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><div className="space-y-0.5"><Label>AI Features</Label><p className="text-sm text-muted-foreground">Enable the AI Studio and inline generation tools.</p></div><Switch defaultChecked /></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
