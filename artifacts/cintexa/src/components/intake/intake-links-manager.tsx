import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api";
import {
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Power,
  QrCode,
  RefreshCw,
  Share2,
  Trash2,
  Inbox,
  Clock,
} from "lucide-react";

export type IntakeShareLink = {
  id: number;
  token: string;
  label: string;
  active: boolean;
  expired?: boolean;
  createdAt: string;
  expiresAt: string | null;
  shareUrl: string;
  submissionCount?: number;
};

type Submission = {
  id: number;
  companyName: string | null;
  status: string;
  createdAt: string;
  shareLinkId: number;
};

/** The origin the browser is really on - always used so links work on localhost, pages.dev or a custom domain. */
export function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

/** Build a link locally from a token (guarantees a usable URL even if the server picked a different host). */
export function buildShareUrl(token: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${currentOrigin()}${base}/intake/${token}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure contexts / blocked clipboard permission
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function QrPreview({ url }: { url: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: "M" })
      .then((d) => live && setSrc(d))
      .catch(() => live && setSrc(""));
    return () => {
      live = false;
    };
  }, [url]);
  if (!src) return <div className="h-[220px] w-[220px] rounded-lg bg-muted animate-pulse" />;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={src} alt="QR code for the intake link" className="rounded-lg bg-white p-2 h-[220px] w-[220px]" />
      <a download="cintexa-intake-qr.png" href={src} className="text-xs underline text-primary">
        Download QR
      </a>
    </div>
  );
}

const EXPIRY_OPTIONS = [
  { label: "Never expires", value: 0 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

/**
 * Manage public intake links: create (with label + expiry), copy, share (native share sheet, WhatsApp, e-mail),
 * QR code, activate/deactivate, delete, see submission counts and the latest submissions.
 */
export function IntakeLinksManager({ onLinkCreated }: { onLinkCreated?: (link: IntakeShareLink) => void }) {
  const { toast } = useToast();
  const [links, setLinks] = useState<IntakeShareLink[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("Diagnostic Intake");
  const [expiry, setExpiry] = useState(0);
  const [qrFor, setQrFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, s] = await Promise.all([
        apiJson<IntakeShareLink[]>(`/intake/share-links?baseUrl=${encodeURIComponent(currentOrigin())}`),
        apiJson<Submission[]>("/intake/submissions").catch(() => [] as Submission[]),
      ]);
      setLinks(Array.isArray(l) ? l : []);
      setSubs(Array.isArray(s) ? s : []);
    } catch (e: any) {
      setError(e?.message || "Could not load share links");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const link = await apiJson<IntakeShareLink>("/intake/share-links", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() || "Diagnostic Intake", expiresInDays: expiry || undefined, baseUrl: currentOrigin() }),
      });
      const url = buildShareUrl(link.token);
      const copied = await copyText(url);
      toast({ title: copied ? "Link created and copied" : "Link created", description: url });
      setLinks((prev) => [{ ...link, shareUrl: url }, ...prev]);
      onLinkCreated?.({ ...link, shareUrl: url });
    } catch (e: any) {
      setError(e?.message || "Could not create the link");
      toast({ title: "Could not create link", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(link: IntakeShareLink) {
    try {
      const next = await apiJson<IntakeShareLink>(`/intake/share-links/${link.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !link.active, baseUrl: currentOrigin() }),
      });
      setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, ...next, shareUrl: buildShareUrl(next.token) } : l)));
    } catch (e: any) {
      toast({ title: "Could not update link", description: e?.message, variant: "destructive" });
    }
  }

  async function remove(link: IntakeShareLink) {
    if (!window.confirm(`Delete "${link.label}"? The link stops working and its ${link.submissionCount ?? 0} submission(s) are removed.`)) return;
    try {
      await apiJson(`/intake/share-links/${link.id}`, { method: "DELETE" });
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      toast({ title: "Link deleted" });
    } catch (e: any) {
      toast({ title: "Could not delete link", description: e?.message, variant: "destructive" });
    }
  }

  async function share(link: IntakeShareLink) {
    const url = buildShareUrl(link.token);
    if (navigator.share) {
      try {
        await navigator.share({ title: link.label, text: "Please fill in this business intake form:", url });
        return;
      } catch {
        /* user cancelled - fall through to copy */
      }
    }
    const ok = await copyText(url);
    toast({ title: ok ? "Link copied" : "Copy the link manually", description: url });
  }

  const recent = useMemo(() => subs.slice(0, 5), [subs]);

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem] space-y-1">
          <label className="text-xs text-muted-foreground">Link label</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme Ltd intake" maxLength={120} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Expiry</label>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2 className="h-4 w-4 mr-2" />}
          {busy ? "Creating…" : "Create & copy link"}
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={() => void load()} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AnimatePresence initial={false}>
        {links.map((link) => {
          const url = buildShareUrl(link.token);
          const dead = !link.active || link.expired;
          return (
            <motion.div
              key={link.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-xl border bg-card/60 p-3 space-y-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{link.label}</span>
                <Badge variant={dead ? "secondary" : "default"} className="text-[10px]">
                  {link.expired ? "Expired" : link.active ? "Active" : "Paused"}
                </Badge>
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Inbox className="h-3 w-3" />
                  {link.submissionCount ?? 0}
                </Badge>
                {link.expiresAt && (
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> until {new Date(link.expiresAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{url}</code>
                <Button size="sm" variant="outline" onClick={async () => toast({ title: (await copyText(url)) ? "Copied" : "Copy failed", description: url })}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void share(link)}>
                  <Share2 className="h-3.5 w-3.5 mr-1" /> Share
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <a target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${link.label}: ${url}`)}`}>
                    <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
                  </a>
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <a href={`mailto:?subject=${encodeURIComponent(link.label)}&body=${encodeURIComponent(`Please fill in this form:\n${url}`)}`}>
                    <Mail className="h-3.5 w-3.5 mr-1" /> E-mail
                  </a>
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setQrFor(qrFor === link.id ? null : link.id)}>
                  <QrCode className="h-3.5 w-3.5 mr-1" /> QR
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                  </a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggle(link)}>
                  <Power className="h-3.5 w-3.5 mr-1" /> {link.active ? "Pause" : "Activate"}
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(link)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              </div>
              {qrFor === link.id && (
                <div className="flex justify-center py-2">
                  <QrPreview url={url} />
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {!loading && !links.length && !error && (
        <p className="text-xs text-muted-foreground">No links yet. Create one above and send it to your client.</p>
      )}

      {recent.length > 0 && (
        <Card className="bg-background/40">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Latest submissions</CardTitle>
            <CardDescription className="text-xs">Each submission is imported into Business Diagnostics automatically.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {recent.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs border-b border-border/40 pb-1.5 last:border-0">
                <span className="font-medium truncate">{s.companyName || "Unnamed company"}</span>
                <span className="text-muted-foreground flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                  {new Date(s.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
