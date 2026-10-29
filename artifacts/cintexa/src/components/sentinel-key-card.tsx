import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, Fingerprint, KeyRound, KeySquare, LifeBuoy, ScrollText, ShieldCheck, Tag, Type, LockKeyhole } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSk } from "@/lib/sentinel-key/store/queries";
import { SENTINEL_REMOTE } from "@/lib/sentinel-key/store/api";

interface Summary { vaultEntries: number; aliases: number; historyEvents: number; failed: number; pending: number; incomplete: number; expiredEntries: number; recent: { id: string; aliasName: string; type: string; status: string; createdAt: string }[] }
const chip = "inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-3 py-2 text-sm font-medium cursor-pointer hover:border-primary/40 hover:bg-secondary transition-colors";
const tile = "block rounded-xl border bg-background/60 p-3 hover:border-primary/40 transition-colors cursor-pointer h-full";
const ACTIONS = [["password", "Password", KeyRound], ["passphrase", "Passphrase", Type], ["id", "ID", Fingerprint], ["token", "Token", KeySquare], ["recovery", "Recovery codes", LifeBuoy]] as const;

/**
 * Dashboard entry for Sentinel Key. Shows counts and non-secret metadata only; it never generates, decrypts or displays a
 * secret. The summary loads shortly after the dashboard so the on-device store does not slow the first paint.
 */
export function SentinelKeyCard() {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 1200); return () => clearTimeout(t); }, []);
  const { data, error, loading } = useSk<Summary>(ready ? "/summary" : null);
  const bad = (data?.incomplete ?? 0) > 0;
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden />Sentinel Key</CardTitle>
          <p className="mt-1 text-xs font-medium text-primary">Secure ID &amp; Password Generator</p>
          <CardDescription className="mt-1.5">Generate strong passwords, private identifiers, secure passphrases, and application tokens. Every item is linked to an alias and saved encrypted to your Vault and History. Review credential strength and access practical phishing-awareness checks.</CardDescription>
        </div>
        <Link href="/sentinel-key"><span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground cursor-pointer hover:opacity-90">Open <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span></Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/sentinel-key/vault"><span className={tile}><LockKeyhole className="h-4 w-4 text-primary" aria-hidden /><p className="mt-1 text-2xl font-semibold tabular-nums">{data ? data.vaultEntries : "–"}</p><p className="text-xs text-muted-foreground">Secure Vault · saved entries</p></span></Link>
          <Link href="/sentinel-key/aliases"><span className={tile}><Tag className="h-4 w-4 text-primary" aria-hidden /><p className="mt-1 text-2xl font-semibold tabular-nums">{data ? data.aliases : "–"}</p><p className="text-xs text-muted-foreground">Alias Manager · active aliases</p></span></Link>
          <Link href="/sentinel-key/history"><span className={tile}><ScrollText className="h-4 w-4 text-primary" aria-hidden /><p className="mt-1 text-2xl font-semibold tabular-nums">{data ? data.historyEvents : "–"}</p><p className="text-xs text-muted-foreground">Generation History · events</p></span></Link>
          <Link href={bad ? "/sentinel-key/history?status=incomplete" : "/sentinel-key/history"}>
            <span className={`${tile} ${bad ? "border-amber-500/50" : ""}`} role="status">
              {bad ? <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />}
              <p className="mt-1 text-sm font-semibold">{error ? "Storage unavailable" : !data ? "Checking…" : bad ? `${data.incomplete} need attention` : "All saves complete"}</p>
              <p className="text-xs text-muted-foreground">Storage Health{data && data.expiredEntries > 0 ? ` · ${data.expiredEntries} expired` : ""}</p>
            </span>
          </Link>
        </div>
        {data && data.recent.length > 0 && (
          <div><p className="mb-1.5 text-xs font-medium text-muted-foreground">Recent generations</p>
            <ul className="space-y-1 text-sm">{data.recent.slice(0, 3).map((e) => <li key={e.id} className="flex items-center justify-between gap-2"><span className="truncate">{e.aliasName} <span className="text-xs text-muted-foreground">· {e.type}</span></span><span className={`text-xs ${e.status === "saved" ? "text-emerald-500" : "text-amber-500"}`}>{e.status === "saved" ? "Saved" : "Incomplete"}</span></li>)}</ul></div>)}
        {ready && !loading && !error && data && data.historyEvents === 0 && <p className="text-xs text-muted-foreground">You haven't generated anything yet. Pick an alias in any generator and the result is saved for you.</p>}
        <div className="flex flex-wrap gap-2" aria-label="Quick generate">{ACTIONS.map(([m, label, Icon]) => <Link key={m} href={`/sentinel-key?mode=${m}`}><span className={chip}><Icon className="h-4 w-4 text-primary" aria-hidden />{label}</span></Link>)}</div>
        <p className="text-xs text-muted-foreground">Stored on {SENTINEL_REMOTE ? "your account" : "this device"}. Secrets are encrypted in your browser before they are saved.</p>
      </CardContent>
    </Card>
  );
}
