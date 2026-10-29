import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Loader2, Lock, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AliasPicker } from "./AliasPicker";
import { Notice, TextField } from "./ui-bits";
import { createKeyring, unlockKeyring } from "@/lib/sentinel-key/store/keyring";
import { SENTINEL_REMOTE } from "@/lib/sentinel-key/store/api";
import type { StoredGeneration } from "@/lib/sentinel-key/store/use-stored-generation";
import { analyzePassword } from "@/lib/sentinel-key/analysis";

export const STORE_WHERE = SENTINEL_REMOTE ? "your account" : "this device";

export function VaultKeyGate({ phase }: { phase: StoredGeneration["keyPhase"] }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (phase === "loading") return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Opening your vault…</p>;
  if (phase === "error") return <Notice tone="warn" title="Storage unavailable">The vault could not be opened, so nothing can be generated (every credential must be saved). Reload the page or check the API connection.</Notice>;
  if (phase === "unlocked") return null;
  const creating = phase === "none";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (creating) { if (pw !== pw2) return setErr("The two passwords do not match."); if (analyzePassword(pw).level < 2) return setErr("That master password is too weak. Use a long passphrase."); }
    setBusy(true);
    try { await (creating ? createKeyring(pw) : unlockKeyring(pw)); setPw(""); setPw2(""); } catch (x) { setErr(x instanceof Error ? x.message : "Could not open the vault."); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-primary/30 bg-background/60 p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><Lock className="h-4 w-4 text-primary" aria-hidden />{creating ? "Create your vault master password" : "Unlock your vault"}</p>
      <p className="text-xs text-muted-foreground">Every generated credential is encrypted in your browser with this password and saved to the Vault automatically.</p>
      <TextField id="gate-pw" type="password" label="Master password" value={pw} onChange={setPw} autoComplete={creating ? "new-password" : "current-password"} />
      {creating && <><TextField id="gate-pw2" type="password" label="Confirm master password" value={pw2} onChange={setPw2} autoComplete="new-password" /><Notice tone="warn" title="No recovery">The master password is never stored or sent. If you forget it, saved credentials cannot be decrypted by anyone, including Cintexa. Use at least 12 characters.</Notice></>}
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <Button type="submit" disabled={busy || !pw}>{busy ? "Working…" : creating ? "Create vault" : "Unlock"}</Button>
    </form>
  );
}

export function StorageBanner({ sg }: { sg: StoredGeneration }) {
  const o = sg.outcome;
  if (!o) return null;
  if (o.status === "saved") return (
    <div role="status" className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
      <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden /><span><b>Saved to the Vault and Generation History</b> under alias <b>{o.aliasName}</b>. Stored encrypted on {STORE_WHERE}.</span></p>
      <div className="flex flex-wrap gap-2"><Link href={`/sentinel-key/vault?entry=${o.entryId}`}><span className="inline-flex cursor-pointer items-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary">Open Vault record</span></Link><Link href={`/sentinel-key/history?event=${o.eventId}`}><span className="inline-flex cursor-pointer items-center rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-secondary">View history event</span></Link></div>
    </div>);
  if (o.status === "incomplete") return (
    <div role="alert" className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /><span><b>Not fully saved.</b> {o.error} Copy the value now if you need it, then retry. History records this as incomplete.</span></p>
      <Button type="button" size="sm" onClick={sg.retry} disabled={sg.busy}><RefreshCw className={sg.busy ? "animate-spin" : ""} /> Retry saving</Button>
    </div>);
  return <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden /><span>{o.error}</span></p>;
}

/** Alias picker + vault unlock + save status: the same block in every generator. */
export function StorageControls({ sg }: { sg: StoredGeneration }) {
  return (
    <div className="space-y-3">
      <VaultKeyGate phase={sg.keyPhase} />
      <AliasPicker value={sg.aliasId} onChange={sg.setAliasId} />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />Saved automatically to the Vault and History on {STORE_WHERE}, encrypted before storage.</p>
      <StorageBanner sg={sg} />
    </div>
  );
}
