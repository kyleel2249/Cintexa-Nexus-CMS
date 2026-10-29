import { format } from "date-fns";
import { Activity, CheckCircle2, Fingerprint, KeyRound, LifeBuoy, Lock, ShieldCheck, Type, KeySquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, Stat } from "./ui-bits";
import type { VaultApi } from "./useVault";
import { totalGenerated, useSessionStats, useSentinelSettings, updateSettings, DEFAULT_SETTINGS, type GenKind } from "@/lib/sentinel-key/session-store";
import type { StrengthLabel } from "@/lib/sentinel-key/analysis";

const KINDS: { k: GenKind; label: string; Icon: typeof KeyRound }[] = [
  { k: "password", label: "Passwords", Icon: KeyRound }, { k: "passphrase", label: "Passphrases", Icon: Type }, { k: "id", label: "IDs", Icon: Fingerprint }, { k: "token", label: "Tokens", Icon: KeySquare }, { k: "recovery", label: "Recovery codes", Icon: LifeBuoy },
];
const BAR: Record<StrengthLabel, string> = { "Very weak": "bg-rose-500", Weak: "bg-orange-500", Fair: "bg-amber-500", Strong: "bg-lime-500", Excellent: "bg-emerald-500" };

function Select({ id, label, value, options, onChange }: { id: string; label: string; value: number; options: [number, string][]; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5"><label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );
}

export function OverviewPanel({ vault, go }: { vault: VaultApi; go: (mode: string) => void }) {
  const stats = useSessionStats();
  const settings = useSentinelSettings();
  const total = totalGenerated(stats);
  const a = vault.audit;
  const actions: string[] = [];
  if (!vault.exists) actions.push("Create an encrypted vault to keep generated passwords somewhere safe.");
  if (vault.exists && !vault.session) actions.push("Unlock the vault to run a local audit.");
  if (vault.session && !a) actions.push("Run a local audit to check strength and reuse.");
  if (a && a.reused.length) actions.push(`Replace reused passwords (${a.reused.length} group${a.reused.length > 1 ? "s" : ""} found).`);
  if (a && a.weak.length) actions.push(`Replace ${a.weak.length} weak password${a.weak.length > 1 ? "s" : ""}.`);
  if (vault.exists && !vault.lastBackup) actions.push("Download an encrypted backup. Without one, a lost browser profile means a lost vault.");
  actions.push("Turn on passkeys or multi-factor authentication for your important accounts.");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Everything on this page is calculated locally in your browser. No data here is verified by a server, and no secret values are ever shown.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Generated this session" value={total} />
        <Stat label="Local-only vault (earlier)" value={<span className="flex items-center gap-2 text-base">{vault.session ? <><ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />Unlocked</> : vault.exists ? <><Lock className="h-4 w-4 text-primary" aria-hidden />Locked</> : "Not created"}</span>} />
        <Stat label="Last local audit" value={<span className="text-base">{stats.lastAuditAt ? format(stats.lastAuditAt, "p") : "Not run"}</span>} />
        <Stat label="Last backup export" value={<span className="text-base">{vault.lastBackup ? format(vault.lastBackup, "PP") : "None"}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-medium">Password strength</h3>{vault.session && <Button type="button" size="sm" variant="outline" onClick={vault.runAudit}>Run local audit</Button>}</div>
          {a ? (
            <div className="space-y-2">
              {(Object.keys(a.distribution) as StrengthLabel[]).map((k) => (
                <div key={k} className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0 text-muted-foreground">{k}</span>
                  <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden"><div className={`h-full ${BAR[k]} transition-all duration-700`} style={{ width: `${a.total ? (a.distribution[k] / a.total) * 100 : 0}%` }} /></div><span className="w-6 text-right tabular-nums">{a.distribution[k]}</span></div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">{a.total} credential{a.total === 1 ? "" : "s"} · {a.reused.length} reuse group{a.reused.length === 1 ? "" : "s"} · {a.short.length} short · {a.patterns.length} with predictable patterns · audited {format(a.at, "p")}</p>
              {a.reused.map((g) => <p key={g.ids.join()} className="text-xs text-amber-500">Same password used for: {g.names.join(", ")}</p>)}
            </div>
          ) : <p className="text-sm text-muted-foreground">{vault.session ? "No audit has been run yet." : "Nothing to show. Unlock a vault with saved credentials and run a local audit to see strength and reuse findings."}</p>}
          {!vault.session && <Button type="button" size="sm" variant="outline" onClick={() => go("vault")}>{vault.exists ? "Unlock vault" : "Create vault"}</Button>}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="font-medium flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />Recommended actions</h3>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">{actions.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>

      {settings.showActivity && (
        <div className="rounded-xl border bg-card p-4"><h3 className="font-medium flex items-center gap-2 mb-3"><Activity className="h-4 w-4 text-primary" aria-hidden />This session's activity</h3>
          {total === 0 ? <p className="text-sm text-muted-foreground">Nothing generated yet. Counts only; generated values are never recorded.</p>
            : <ul className="grid gap-2 sm:grid-cols-5">{KINDS.map(({ k, label, Icon }) => <li key={k} className="rounded-lg border bg-background/60 p-3 text-center"><Icon className="mx-auto mb-1 h-4 w-4 text-primary" aria-hidden /><div className="text-lg font-semibold tabular-nums">{stats.generated[k]}</div><div className="text-xs text-muted-foreground">{label}</div></li>)}</ul>}
        </div>
      )}

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <h3 className="font-medium">Settings</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select id="st-hide" label="Hide revealed secrets after" value={settings.autoHideSeconds} onChange={(autoHideSeconds) => updateSettings({ autoHideSeconds })} options={[[0, "Never"], [15, "15 seconds"], [30, "30 seconds"], [60, "1 minute"]]} />
          <Select id="st-clip" label="Clear clipboard after copy" value={settings.clipboardClearSeconds} onChange={(clipboardClearSeconds) => updateSettings({ clipboardClearSeconds })} options={[[0, "Do not clear"], [15, "15 seconds"], [30, "30 seconds"], [60, "1 minute"]]} />
          <Select id="st-lock" label="Lock vault after inactivity" value={settings.vaultLockMinutes} onChange={(vaultLockMinutes) => updateSettings({ vaultLockMinutes })} options={[[0, "Never"], [1, "1 minute"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"]]} />
        </div>
        <div className="flex items-center gap-2"><input id="st-act" type="checkbox" checked={settings.showActivity} onChange={(e) => updateSettings({ showActivity: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" /><label htmlFor="st-act" className="text-sm">Show session activity counts</label>
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => updateSettings(DEFAULT_SETTINGS)}>Reset to defaults</Button></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Notice title="What Sentinel Key does and does not do">Generation, analysis, URL checks and the vault all run in your browser. The only network request is the optional breach check, which sends a 5-character hash prefix. It helps you spot weak passwords and suspicious links; it cannot stop every attack, and it cannot detect malware on your device.</Notice>
        <Notice title="Vault limits">The vault lives in this browser profile only and is not synchronised. Clearing site data, switching browsers or forgetting the master password loses it unless you keep an encrypted backup. Anyone with your unlocked device can read an unlocked vault.</Notice>
      </div>
    </div>
  );
}
