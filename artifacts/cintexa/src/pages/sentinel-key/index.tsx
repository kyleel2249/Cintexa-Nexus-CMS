import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PasswordPanel } from "@/components/sentinel-key/PasswordPanel";
import { PassphrasePanel } from "@/components/sentinel-key/PassphrasePanel";
import { IdPanel } from "@/components/sentinel-key/IdPanel";
import { DeveloperPanel } from "@/components/sentinel-key/DeveloperPanel";
import { AnalyzerPanel } from "@/components/sentinel-key/AnalyzerPanel";
import { SafetyPanel } from "@/components/sentinel-key/SafetyPanel";
import { VaultPanel } from "@/components/sentinel-key/VaultPanel";
import { StoreVaultPanel } from "@/components/sentinel-key/StoreVaultPanel";
import { HistoryPanel } from "@/components/sentinel-key/HistoryPanel";
import { AliasManager } from "@/components/sentinel-key/AliasManager";
import { OverviewPanel } from "@/components/sentinel-key/OverviewPanel";
import { useVault } from "@/components/sentinel-key/useVault";
import { initKeyring, lockKeyring, useKeyring } from "@/lib/sentinel-key/store/keyring";
import { useSentinelSettings } from "@/lib/sentinel-key/session-store";

const GEN = ["password", "passphrase", "id", "token", "recovery"] as const;
const TOP = ["generate", "vault", "history", "aliases", "analyze", "safety", "overview"] as const;
type Gen = (typeof GEN)[number];
type Top = (typeof TOP)[number];

/** Section comes from the path (/sentinel-key/vault) or, for older links, ?mode=. Neither ever carries a value. */
export function resolveMode(pathname: string, search: string): { top: Top; gen: Gen } {
  const seg = pathname.replace(/^\/sentinel-key\/?/, "").split("/")[0] ?? "";
  const m = seg || (new URLSearchParams(search).get("mode") ?? "");
  if ((GEN as readonly string[]).includes(m)) return { top: "generate", gen: m as Gen };
  if ((TOP as readonly string[]).includes(m)) return { top: m as Top, gen: "password" };
  if (m === "settings") return { top: "overview", gen: "password" };
  return { top: "generate", gen: "password" };
}

export default function SentinelKeyPage() {
  const reduce = useReducedMotion();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const legacy = useVault();
  const { phase } = useKeyring();
  const { vaultLockMinutes } = useSentinelSettings();
  const { top, gen } = useMemo(() => resolveMode(location, search), [location, search]);
  const go = (mode: string) => navigate((TOP as readonly string[]).includes(mode) && mode !== "generate" ? `/sentinel-key/${mode}` : `/sentinel-key?mode=${mode}`);

  useEffect(() => { void initKeyring(); }, []);
  // Leaving Sentinel Key (not just switching its sections, which remounts this page) or going idle drops the in-memory key.
  useEffect(() => () => { setTimeout(() => { if (!window.location.pathname.includes("/sentinel-key")) lockKeyring(); }, 0); }, []);
  useEffect(() => {
    if (phase !== "unlocked" || vaultLockMinutes <= 0) return undefined;
    let t = setTimeout(lockKeyring, vaultLockMinutes * 60_000);
    const reset = () => { clearTimeout(t); t = setTimeout(lockKeyring, vaultLockMinutes * 60_000); };
    const ev = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(t); ev.forEach((e) => window.removeEventListener(e, reset)); };
  }, [phase, vaultLockMinutes]);

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><ShieldCheck className="h-6 w-6" aria-hidden /></div>
        <div><h1 className="text-2xl font-semibold tracking-tight">Sentinel Key</h1><p className="text-muted-foreground">Secure ID &amp; Password Generator. Every generated credential is linked to an alias and saved encrypted to your Vault and History.</p></div>
      </header>

      <Tabs value={top} onValueChange={go} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto sm:inline-flex">
          <TabsTrigger value="generate">Generate</TabsTrigger><TabsTrigger value="vault">Vault</TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="aliases">Aliases</TabsTrigger><TabsTrigger value="analyze">Analyze</TabsTrigger><TabsTrigger value="safety">Website safety</TabsTrigger><TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4">
          <Tabs value={gen} onValueChange={go}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto sm:inline-flex">
              <TabsTrigger value="password">Password</TabsTrigger><TabsTrigger value="passphrase">Passphrase</TabsTrigger><TabsTrigger value="id">IDs</TabsTrigger><TabsTrigger value="token">Tokens</TabsTrigger><TabsTrigger value="recovery">Recovery codes</TabsTrigger>
            </TabsList>
            <TabsContent value="password" className="mt-4"><PasswordPanel /></TabsContent>
            <TabsContent value="passphrase" className="mt-4"><PassphrasePanel /></TabsContent>
            <TabsContent value="id" className="mt-4"><IdPanel /></TabsContent>
            <TabsContent value="token" className="mt-4"><DeveloperPanel key="token" initial="token" /></TabsContent>
            <TabsContent value="recovery" className="mt-4"><DeveloperPanel key="recovery" initial="recovery" /></TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="vault" className="space-y-6">
          <StoreVaultPanel />
          <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Local-only vault (earlier version, kept for existing data)</summary><div className="mt-4"><VaultPanel vault={legacy} /></div></details>
        </TabsContent>
        <TabsContent value="history"><HistoryPanel /></TabsContent>
        <TabsContent value="aliases"><AliasManager /></TabsContent>
        <TabsContent value="analyze"><AnalyzerPanel /></TabsContent>
        <TabsContent value="safety"><SafetyPanel /></TabsContent>
        <TabsContent value="overview"><OverviewPanel vault={legacy} go={go} /></TabsContent>
      </Tabs>
    </motion.div>
  );
}
