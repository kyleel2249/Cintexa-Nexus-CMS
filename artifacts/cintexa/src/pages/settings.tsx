import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useTheme, type Accent, type Radius } from "@/components/ThemeProvider";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiJson, API_BASE } from "@/lib/api";
import {
  Settings as SettingsIcon,
  Palette,
  Key,
  Webhook,
  Shield,
  Loader2,
  Copy,
  Trash2,
  Plus,
  Send,
  ScrollText,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "general" | "appearance" | "api-keys" | "webhooks" | "security";

const ACCENTS: { value: Exclude<Accent, "custom">; label: string; color: string }[] = [
  { value: "gold", label: "Gold (Cintexa)", color: "hsl(46 89% 55%)" },
  { value: "indigo", label: "Indigo", color: "hsl(239 84% 67%)" },
  { value: "violet", label: "Violet", color: "hsl(265 89% 66%)" },
  { value: "emerald", label: "Emerald", color: "hsl(160 84% 39%)" },
  { value: "rose", label: "Rose", color: "hsl(347 77% 50%)" },
  { value: "amber", label: "Amber", color: "hsl(38 92% 50%)" },
  { value: "cyan", label: "Cyan", color: "hsl(189 94% 43%)" },
];

const FALLBACK_EVENTS = ["content.published", "content.scheduled", "form.submitted", "intake.submitted", "media.uploaded"];

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

type ApiKeyRow = { id: string; name: string; prefix: string; scopes?: string[]; createdAt: string; expiresAt?: string | null; lastUsedAt?: string | null };
type HookRow = { id: string; url: string; events: string[]; active: boolean; secret?: string; createdAt: string; lastStatus?: number | null; lastDeliveryAt?: string | null; failureCount?: number };
type Delivery = { id: string; webhookId: string; event: string; status: number | null; ok: boolean; durationMs: number; error?: string; at: string };

function PasswordCard({ minLength }: { minLength: number }) {
  const { toast } = useToast();
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < minLength) {
      toast({ title: `Password must be at least ${minLength} characters`, variant: "destructive" });
      return;
    }
    if (next !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      toast({ title: "Password updated" });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err: any) {
      toast({ title: err?.message || "Could not change password", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change the password for your account. You will be asked to confirm your current password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label>Current password</Label>
            <Input type={show ? "text" : "password"} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>New password</Label>
            <Input type={show ? "text" : "password"} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Confirm new password</Label>
            <Input type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Update password
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setShow((v) => !v)} title="Show / hide">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme, accent, setAccent, customColor, setCustomColor, radius, setRadius, reduceMotion, setReduceMotion, resetAppearance } = useTheme();
  const { toast } = useToast();
  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Theme, accent colour and shape. Changes apply instantly and are remembered on this device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-2">
          <Label>Theme</Label>
          <div className="flex flex-wrap gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button key={t} size="sm" variant={theme === t ? "default" : "outline"} onClick={() => setTheme(t)} className="capitalize">
                {t}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Accent colour</Label>
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map(({ value, label, color }) => (
              <button
                key={value}
                type="button"
                title={label}
                onClick={() => setAccent(value)}
                className={cn(
                  "group relative flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all",
                  accent === value ? "border-foreground/40 scale-105 shadow-md" : "border-transparent hover:border-border",
                )}
              >
                <span className="w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-card transition-all" style={{ backgroundColor: color, ["--tw-ring-color" as any]: accent === value ? color : "transparent" } as React.CSSProperties} />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </button>
            ))}
            <label
              className={cn(
                "relative flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 cursor-pointer transition-all",
                accent === "custom" ? "border-foreground/40 scale-105 shadow-md" : "border-transparent hover:border-border",
              )}
              title="Pick any colour"
            >
              <span className="w-8 h-8 rounded-full ring-2 ring-offset-2 ring-offset-card" style={{ background: accent === "custom" ? customColor : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", ["--tw-ring-color" as any]: accent === "custom" ? customColor : "transparent" } as React.CSSProperties} />
              <span className="text-[10px] text-muted-foreground">Custom</span>
              <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={customColor} onChange={(e) => setCustomColor(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Corner style</Label>
          <div className="flex flex-wrap gap-2">
            {([["sharp", "Sharp"], ["default", "Default"], ["round", "Rounded"]] as [Radius, string][]).map(([v, l]) => (
              <Button key={v} size="sm" variant={radius === v ? "default" : "outline"} onClick={() => setRadius(v)}>
                {l}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between max-w-md">
          <div className="space-y-0.5">
            <Label>Reduce motion</Label>
            <p className="text-sm text-muted-foreground">Turns off animations and transitions.</p>
          </div>
          <Switch checked={reduceMotion} onCheckedChange={setReduceMotion} />
        </div>

        <div className="rounded-xl border p-4 space-y-3 bg-background/50">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Live preview</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Primary</Button>
            <Button size="sm" variant="secondary">Secondary</Button>
            <Button size="sm" variant="outline">Outline</Button>
            <Badge>Badge</Badge>
            <div className="h-2 w-40 rounded-full bg-muted overflow-hidden"><motion.div className="h-full bg-primary" initial={{ width: "10%" }} animate={{ width: "72%" }} transition={{ duration: 1.2, repeat: Infinity, repeatType: "reverse" }} /></div>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={() => { resetAppearance(); toast({ title: "Appearance reset to defaults" }); }}>
          <RotateCcw className="h-4 w-4 mr-2" /> Reset appearance
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");
  const { toast } = useToast();
  const [general, setGeneral] = useState({ platformName: "CINTEXA CMS", supportEmail: "support@cintexa.com", maintenanceMode: false, userRegistration: true, aiFeatures: true });
  const [security, setSecurity] = useState({ require2fa: false, sessionTimeoutMinutes: 60, passwordMinLength: 8, allowPasswordLogin: true, ipAllowlist: "", apiRateLimitPerMinute: 240 });
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [webhooks, setWebhooks] = useState<HookRow[]>([]);
  const [events, setEvents] = useState<string[]>(FALLBACK_EVENTS);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesFor, setDeliveriesFor] = useState<HookRow | null>(null);
  const [myIp, setMyIp] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adminOnlyNotice, setAdminOnlyNotice] = useState(false);
  const [openRouter, setOpenRouter] = useState({ configured: false, prefix: null as string | null, model: "openai/gpt-4o-mini", siteUrl: "https://cintexa.com", appName: "CINTEXA Nexus CMS", source: "none" });
  const [orKeyInput, setOrKeyInput] = useState("");
  const [orBusy, setOrBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState("Production");
  const [newKeyWrite, setNewKeyWrite] = useState(false);
  const [newKeyDays, setNewKeyDays] = useState(0);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>(["content.published", "form.submitted"]);
  const [newHookSecret, setNewHookSecret] = useState<{ url: string; secret: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const attempt = async <T,>(path: string): Promise<T | null> => {
      try {
        return await apiJson<T>(path);
      } catch (e: any) {
        if (e?.status === 403) setAdminOnlyNotice(true);
        else if (e?.status !== 404) setLoadError(e?.message || "Could not load settings");
        return null;
      }
    };
    const [g, s, k, w, ev, or, who] = await Promise.all([
      attempt<any>("/settings/general"),
      attempt<any>("/settings/security"),
      attempt<ApiKeyRow[]>("/settings/api-keys"),
      attempt<HookRow[]>("/settings/webhooks"),
      attempt<string[]>("/settings/webhooks/events"),
      attempt<any>("/settings/openrouter"),
      attempt<{ ip: string }>("/settings/whoami"),
    ]);
    if (g && !g.error) setGeneral((p) => ({ ...p, ...g }));
    if (s && !s.error) setSecurity((p) => ({ ...p, ...s }));
    if (Array.isArray(k)) setApiKeys(k);
    if (Array.isArray(w)) setWebhooks(w);
    if (Array.isArray(ev) && ev.length) setEvents(ev.filter((e) => e !== "webhook.test"));
    if (or && !or.error) setOpenRouter((p) => ({ ...p, ...or }));
    if (who?.ip) setMyIp(who.ip);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveGeneral() {
    setBusy(true);
    try {
      const data = await apiJson<typeof general>("/settings/general", { method: "PUT", body: JSON.stringify(general) });
      setGeneral((p) => ({ ...p, ...data }));
      toast({ title: "General settings saved" });
    } catch (e: any) {
      toast({ title: e?.message || "Save failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function saveSecurity() {
    setBusy(true);
    try {
      const data = await apiJson<typeof security>("/settings/security", { method: "PUT", body: JSON.stringify(security) });
      setSecurity((p) => ({ ...p, ...data }));
      toast({ title: "Security settings saved" });
    } catch (e: any) {
      toast({ title: e?.message || "Save failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function createApiKey() {
    setBusy(true);
    setNewKeySecret(null);
    try {
      const data = await apiJson<ApiKeyRow & { secret: string }>("/settings/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName, scopes: newKeyWrite ? ["read", "write"] : ["read"], expiresInDays: newKeyDays || undefined }),
      });
      setNewKeySecret(data.secret);
      const { secret: _s, ...row } = data;
      setApiKeys((prev) => [row, ...prev]);
      toast({ title: "API key created — copy it now" });
    } catch (e: any) {
      toast({ title: e?.message || "Could not create key", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteApiKey(id: string) {
    if (!window.confirm("Revoke this API key? Anything using it will stop working immediately.")) return;
    try {
      await apiJson(`/settings/api-keys/${id}`, { method: "DELETE" });
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
      toast({ title: "API key revoked" });
    } catch (e: any) {
      toast({ title: e?.message || "Failed", variant: "destructive" });
    }
  }

  async function createWebhook() {
    if (!hookUrl.trim()) return;
    setBusy(true);
    try {
      const data = await apiJson<HookRow>("/settings/webhooks", { method: "POST", body: JSON.stringify({ url: hookUrl.trim(), events: hookEvents }) });
      setWebhooks((prev) => [{ ...data, secret: `${String(data.secret).slice(0, 10)}…` }, ...prev]);
      setNewHookSecret({ url: data.url, secret: String(data.secret) });
      setHookUrl("");
      toast({ title: "Webhook registered" });
    } catch (e: any) {
      toast({ title: e?.message || "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleWebhook(h: HookRow) {
    try {
      const next = await apiJson<HookRow>(`/settings/webhooks/${h.id}`, { method: "PATCH", body: JSON.stringify({ active: !h.active }) });
      setWebhooks((prev) => prev.map((x) => (x.id === h.id ? { ...x, ...next } : x)));
    } catch (e: any) {
      toast({ title: e?.message || "Failed", variant: "destructive" });
    }
  }

  async function testWebhook(h: HookRow) {
    setTesting(h.id);
    try {
      const d = await apiJson<Delivery>(`/settings/webhooks/${h.id}/test`, { method: "POST" });
      toast({ title: d.ok ? `Test delivered (HTTP ${d.status})` : `Test failed${d.status ? ` (HTTP ${d.status})` : ""}`, description: `${d.durationMs} ms`, variant: d.ok ? "default" : "destructive" });
      void load();
    } catch (e: any) {
      const detail = e?.detail as Delivery | undefined;
      toast({ title: "Test failed", description: detail?.error || e?.message, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  }

  async function openDeliveries(h: HookRow) {
    setDeliveriesFor(h);
    try {
      setDeliveries(await apiJson<Delivery[]>(`/settings/webhooks/deliveries?webhookId=${h.id}`));
    } catch {
      setDeliveries([]);
    }
  }

  async function deleteWebhook(id: string) {
    if (!window.confirm("Remove this webhook?")) return;
    try {
      await apiJson(`/settings/webhooks/${id}`, { method: "DELETE" });
      setWebhooks((prev) => prev.filter((h) => h.id !== id));
      toast({ title: "Webhook removed" });
    } catch (e: any) {
      toast({ title: e?.message || "Failed", variant: "destructive" });
    }
  }

  async function saveOpenRouter() {
    setOrBusy(true);
    try {
      const body: Record<string, unknown> = { model: openRouter.model, siteUrl: openRouter.siteUrl, appName: openRouter.appName };
      if (orKeyInput.trim()) body.apiKey = orKeyInput.trim();
      const data = await apiJson<any>("/settings/openrouter", { method: "POST", body: JSON.stringify(body) });
      setOpenRouter((prev) => ({ ...prev, configured: Boolean(data.configured), prefix: data.prefix ?? prev.prefix, model: data.model ?? prev.model, siteUrl: data.siteUrl ?? prev.siteUrl, appName: data.appName ?? prev.appName, source: data.source ?? prev.source }));
      setOrKeyInput("");
      toast({ title: "OpenRouter settings saved", description: data.configured ? `Key ${data.prefix}` : data.message || "Saved" });
    } catch (e: any) {
      if ((e?.status === 405 || e?.status === 503 || e?.status === 404) && orKeyInput.trim()) {
        const key = orKeyInput.trim();
        try {
          sessionStorage.setItem("cintexa-openrouter-key", key);
          sessionStorage.setItem("cintexa-openrouter-meta", JSON.stringify({ model: openRouter.model, siteUrl: openRouter.siteUrl, appName: openRouter.appName }));
        } catch { /* ignore */ }
        setOpenRouter((prev) => ({ ...prev, configured: true, prefix: key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••", source: "session" }));
        setOrKeyInput("");
        toast({ title: "Key kept for this browser session only", description: "The API backend is not reachable. Set API_ORIGIN (Cloudflare) or start the API server for permanent storage." });
      } else {
        toast({ title: e?.message || "Failed to save OpenRouter key", variant: "destructive" });
      }
    } finally {
      setOrBusy(false);
    }
  }

  async function clearOpenRouterKey() {
    setOrBusy(true);
    try {
      const data = await apiJson<any>("/settings/openrouter", { method: "POST", body: JSON.stringify({ clearKey: true }) });
      setOpenRouter((prev) => ({ ...prev, configured: Boolean(data.configured), prefix: data.prefix ?? null, source: data.source ?? "none" }));
      try { sessionStorage.removeItem("cintexa-openrouter-key"); } catch { /* ignore */ }
      setOrKeyInput("");
      toast({ title: "OpenRouter key removed" });
    } catch (e: any) {
      toast({ title: e?.message || "Failed", variant: "destructive" });
    } finally {
      setOrBusy(false);
    }
  }

  async function testOpenRouter() {
    setOrBusy(true);
    try {
      const data = await apiJson<any>("/settings/openrouter/test", { method: "POST" });
      toast({ title: "OpenRouter key is valid", description: data?.message });
    } catch (e: any) {
      toast({ title: e?.message || "OpenRouter test failed", variant: "destructive" });
    } finally {
      setOrBusy(false);
    }
  }

  const nav: { id: Tab; label: string; icon: typeof SettingsIcon }[] = [
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "api-keys", label: "API Keys", icon: Key },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "security", label: "Security", icon: Shield },
  ];

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const apiUrl = API_BASE.startsWith("http") ? API_BASE : `${origin}${API_BASE}`;
  const curl = useMemo(() => `curl -H "Authorization: Bearer cxk_YOUR_KEY" ${apiUrl}/posts`, [apiUrl]);
  const verifySnippet = `// Node.js: verify a Nexus webhook
import { createHmac, timingSafeEqual } from "node:crypto";
export function verify(rawBody, headers, secret) {
  const ts = headers["x-cintexa-timestamp"];
  const expected = "sha256=" + createHmac("sha256", secret).update(ts + "." + rawBody).digest("hex");
  const got = headers["x-cintexa-signature"];
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground mt-1">Platform configuration, appearance, keys, webhooks and security.</p>
      </div>

      {(loadError || adminOnlyNotice) && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start justify-between gap-3">
          <span>
            {adminOnlyNotice
              ? "Some settings are visible to administrators only. Add your e-mail to ADMIN_EMAILS on the API server to manage them."
              : loadError}
          </span>
          <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-1 lg:col-span-1 flex lg:block gap-1 overflow-x-auto">
          {nav.map(({ id, label, icon: Icon }) => (
            <Button key={id} variant="ghost" className={cn("lg:w-full justify-start shrink-0", tab === id ? "bg-secondary/50 text-foreground font-medium" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab(id)}>
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-6">
          {tab === "general" && (
            <>
              <PasswordCard minLength={security.passwordMinLength} />
              <Card className="bg-card border-border/50">
                <CardHeader>
                  <CardTitle>Platform configuration</CardTitle>
                  <CardDescription>Core settings for the CINTEXA CMS platform.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Platform name</Label>
                    <Input value={general.platformName} onChange={(e) => setGeneral({ ...general, platformName: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Support email</Label>
                    <Input type="email" value={general.supportEmail} onChange={(e) => setGeneral({ ...general, supportEmail: e.target.value })} />
                  </div>
                  <div className="pt-4 border-t border-border/50 space-y-4">
                    <h4 className="text-sm font-semibold">Features</h4>
                    {([
                      ["maintenanceMode", "Maintenance mode", "Shows a maintenance flag to connected sites via /api/settings/public."],
                      ["userRegistration", "User registration", "Allow new users to sign up."],
                      ["aiFeatures", "AI features", "Enable AI Studio and generation tools."],
                    ] as const).map(([key, label, help]) => (
                      <div key={key} className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>{label}</Label>
                          <p className="text-sm text-muted-foreground">{help}</p>
                        </div>
                        <Switch checked={general[key]} onCheckedChange={(v) => setGeneral({ ...general, [key]: v })} />
                      </div>
                    ))}
                  </div>
                  <Button onClick={() => void saveGeneral()} disabled={busy}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save general settings
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          {tab === "appearance" && <AppearanceCard />}

          {tab === "api-keys" && (
            <>
              <Card className="bg-card border-border/50 border-primary/20">
                <CardHeader>
                  <CardTitle>OpenRouter (AI)</CardTitle>
                  <CardDescription>Secret key used by AI Studio, SEO generation, post images and comments. Stored server-side only — the full key is never shown again after save.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${openRouter.configured ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {openRouter.configured ? `Configured (${openRouter.prefix})` : "Not configured"}
                    </span>
                    <span className="text-xs text-muted-foreground">Source: {openRouter.source}</span>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="or-key">OpenRouter API key</Label>
                    <Input id="or-key" type="password" autoComplete="off" placeholder={openRouter.configured ? "••••••••  (leave blank to keep current)" : "sk-or-v1-…"} value={orKeyInput} onChange={(e) => setOrKeyInput(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="underline text-primary">openrouter.ai/keys</a>. Prefer keys with spend limits.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="or-model">Default model</Label>
                    <Input id="or-model" value={openRouter.model} onChange={(e) => setOpenRouter({ ...openRouter, model: e.target.value })} placeholder="openai/gpt-4o-mini" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>HTTP-Referer (site URL)</Label><Input value={openRouter.siteUrl} onChange={(e) => setOpenRouter({ ...openRouter, siteUrl: e.target.value })} /></div>
                    <div className="space-y-2"><Label>App name (X-Title)</Label><Input value={openRouter.appName} onChange={(e) => setOpenRouter({ ...openRouter, appName: e.target.value })} /></div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button onClick={() => void saveOpenRouter()} disabled={orBusy}>{orBusy ? "Saving…" : "Save OpenRouter settings"}</Button>
                    <Button type="button" variant="outline" onClick={() => void testOpenRouter()} disabled={orBusy || !openRouter.configured}>Test key</Button>
                    {openRouter.configured && openRouter.source !== "environment" && (
                      <Button type="button" variant="ghost" className="text-destructive" onClick={() => void clearOpenRouterKey()} disabled={orBusy}>Remove key</Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card border-border/50">
                <CardHeader>
                  <CardTitle>Application API keys</CardTitle>
                  <CardDescription>Generate keys for programmatic access to Nexus. Secrets are hashed at rest and shown once. Keys can never access Settings or Users.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
                    <div className="space-y-2">
                      <Label>Key name</Label>
                      <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="CI pipeline" />
                    </div>
                    <div className="space-y-2">
                      <Label>Expires</Label>
                      <select className="h-10 rounded-md border bg-background px-3 text-sm" value={newKeyDays} onChange={(e) => setNewKeyDays(Number(e.target.value))}>
                        <option value={0}>Never</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                        <option value={365}>1 year</option>
                      </select>
                    </div>
                    <Button onClick={() => void createApiKey()} disabled={busy}>
                      <Plus className="h-4 w-4 mr-1" />Generate key
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={newKeyWrite} onCheckedChange={setNewKeyWrite} id="key-write" />
                    <Label htmlFor="key-write" className="text-sm">Allow write access (create / update / delete). Otherwise the key is read-only.</Label>
                  </div>
                  {newKeySecret && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
                      <p className="text-sm font-medium">Copy this secret now — it will not be shown again.</p>
                      <div className="flex gap-2 items-center">
                        <code className="text-xs break-all flex-1 font-mono">{newKeySecret}</code>
                        <Button size="icon" variant="outline" onClick={async () => toast({ title: (await copy(newKeySecret)) ? "Copied" : "Copy failed" })}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </motion.div>
                  )}
                  <ul className="space-y-2">
                    {apiKeys.map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            {k.name}
                            {(k.scopes ?? ["read"]).includes("write") ? <Badge variant="default" className="text-[10px]">read + write</Badge> : <Badge variant="secondary" className="text-[10px]">read-only</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{k.prefix}…</div>
                          <div className="text-[11px] text-muted-foreground">
                            Created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
                            {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => void deleteApiKey(k.id)} title="Revoke"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </li>
                    ))}
                    {!apiKeys.length && <p className="text-sm text-muted-foreground">No API keys yet.</p>}
                  </ul>
                  <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                    <p className="text-xs font-medium">Usage</p>
                    <code className="text-[11px] break-all block">{curl}</code>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {tab === "webhooks" && (
            <Card className="bg-card border-border/50">
              <CardHeader>
                <CardTitle>Webhooks</CardTitle>
                <CardDescription>Nexus sends a signed POST (HMAC-SHA256) to your endpoint when the selected events happen.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="space-y-2 flex-1 min-w-[14rem]">
                      <Label>Endpoint URL</Label>
                      <Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://example.com/hooks/cintexa" />
                    </div>
                    <Button onClick={() => void createWebhook()} disabled={busy || !hookUrl.trim() || !hookEvents.length}>
                      <Plus className="h-4 w-4 mr-1" />Add webhook
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {events.map((ev) => {
                      const on = hookEvents.includes(ev);
                      return (
                        <button key={ev} type="button" onClick={() => setHookEvents((p) => (on ? p.filter((x) => x !== ev) : [...p, ev]))} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
                          {ev}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {newHookSecret && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
                    <p className="text-sm font-medium">Signing secret for {newHookSecret.url} — save it now.</p>
                    <div className="flex gap-2 items-center">
                      <code className="text-xs break-all flex-1 font-mono">{newHookSecret.secret}</code>
                      <Button size="icon" variant="outline" onClick={async () => toast({ title: (await copy(newHookSecret.secret)) ? "Copied" : "Copy failed" })}><Copy className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}

                <ul className="space-y-2">
                  {webhooks.map((h) => (
                    <li key={h.id} className="border rounded-lg px-3 py-3 text-sm space-y-2">
                      <div className="flex justify-between gap-2 items-start">
                        <div className="min-w-0">
                          <span className="font-mono text-xs break-all">{h.url}</span>
                          <div className="text-xs text-muted-foreground mt-1">Events: {(h.events || []).join(", ")}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Switch checked={h.active} onCheckedChange={() => void toggleWebhook(h)} title={h.active ? "Active" : "Paused"} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {h.lastDeliveryAt ? (
                          <span className="inline-flex items-center gap-1">
                            {h.lastStatus && h.lastStatus >= 200 && h.lastStatus < 300 ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                            Last: {h.lastStatus ?? "error"} · {new Date(h.lastDeliveryAt).toLocaleString()}
                          </span>
                        ) : (
                          <span>No deliveries yet</span>
                        )}
                        {!h.active && (h.failureCount ?? 0) >= 10 && <Badge variant="destructive" className="text-[10px]">Auto-paused after repeated failures</Badge>}
                        <span className="ml-auto flex gap-1">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => void testWebhook(h)} disabled={testing === h.id}>
                            {testing === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}Test
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => void openDeliveries(h)}><ScrollText className="h-3.5 w-3.5 mr-1" />Log</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => void deleteWebhook(h.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </span>
                      </div>
                    </li>
                  ))}
                  {!webhooks.length && <p className="text-sm text-muted-foreground">No webhooks configured.</p>}
                </ul>

                <details className="rounded-lg bg-muted/40 p-3">
                  <summary className="text-xs font-medium cursor-pointer">How to verify signatures</summary>
                  <pre className="text-[11px] mt-2 overflow-auto whitespace-pre-wrap">{verifySnippet}</pre>
                </details>
              </CardContent>
            </Card>
          )}

          {tab === "security" && (
            <Card className="bg-card border-border/50">
              <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>Session, authentication and access controls. These are enforced by the API.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5"><Label>Require two-factor authentication</Label><p className="text-sm text-muted-foreground">Prompt admins for 2FA when available.</p></div>
                  <Switch checked={security.require2fa} onCheckedChange={(v) => setSecurity({ ...security, require2fa: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5"><Label>Allow password login</Label><p className="text-sm text-muted-foreground">Disable to require SSO / Firebase only.</p></div>
                  <Switch checked={security.allowPasswordLogin} onCheckedChange={(v) => setSecurity({ ...security, allowPasswordLogin: v })} />
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Session timeout (min)</Label><Input type="number" min={5} value={security.sessionTimeoutMinutes} onChange={(e) => setSecurity({ ...security, sessionTimeoutMinutes: Number(e.target.value) || 60 })} /></div>
                  <div className="space-y-2"><Label>Min password length</Label><Input type="number" min={6} value={security.passwordMinLength} onChange={(e) => setSecurity({ ...security, passwordMinLength: Number(e.target.value) || 8 })} /></div>
                  <div className="space-y-2"><Label>API requests / minute</Label><Input type="number" min={30} value={security.apiRateLimitPerMinute} onChange={(e) => setSecurity({ ...security, apiRateLimitPerMinute: Number(e.target.value) || 240 })} /></div>
                </div>
                <div className="space-y-2">
                  <Label>IP allow-list (comma-separated IPs or CIDR ranges, optional)</Label>
                  <Input value={security.ipAllowlist} onChange={(e) => setSecurity({ ...security, ipAllowlist: e.target.value })} placeholder="203.0.113.0/24, 198.51.100.7" />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {myIp ? <>Your current IP: <code>{myIp}</code>
                      <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setSecurity((p) => ({ ...p, ipAllowlist: p.ipAllowlist ? `${p.ipAllowlist}, ${myIp}` : myIp }))}>Add my IP</Button></> : "Leave empty to allow every address. The API refuses a list that would lock you out."}
                  </div>
                </div>
                <Button onClick={() => void saveSecurity()} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save security settings
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!deliveriesFor} onOpenChange={(o) => !o && setDeliveriesFor(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Delivery log</DialogTitle>
            <DialogDescription className="break-all">{deliveriesFor?.url}</DialogDescription>
          </DialogHeader>
          {deliveries.length ? (
            <ul className="space-y-2 text-sm">
              {deliveries.map((d) => (
                <li key={d.id} className="border rounded-md px-3 py-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">{d.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}<code className="text-xs">{d.event}</code></span>
                  <span className="text-xs text-muted-foreground">{d.status ?? d.error ?? "error"} · {d.durationMs} ms · {new Date(d.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No deliveries recorded yet.</p>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDeliveriesFor(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
