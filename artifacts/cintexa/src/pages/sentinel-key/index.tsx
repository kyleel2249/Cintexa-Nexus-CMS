import { useMemo } from "react";
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
import { OverviewPanel } from "@/components/sentinel-key/OverviewPanel";
import { useVault } from "@/components/sentinel-key/useVault";

const GEN = ["password", "passphrase", "id", "token", "recovery"] as const;
const TOP = ["generate", "analyze", "safety", "vault", "overview"] as const;
type Gen = (typeof GEN)[number];
type Top = (typeof TOP)[number];

/** Maps ?mode= to a top-level tab and generator sub-tab. The query carries only a mode name, never a value. */
export function resolveMode(search: string): { top: Top; gen: Gen } {
  const m = new URLSearchParams(search).get("mode") ?? "";
  if ((GEN as readonly string[]).includes(m)) return { top: "generate", gen: m as Gen };
  if ((TOP as readonly string[]).includes(m)) return { top: m as Top, gen: "password" };
  if (m === "settings") return { top: "overview", gen: "password" };
  return { top: "generate", gen: "password" };
}

export default function SentinelKeyPage() {
  const reduce = useReducedMotion();
  const search = useSearch();
  const [, navigate] = useLocation();
  const vault = useVault();
  const { top, gen } = useMemo(() => resolveMode(search), [search]);
  const go = (mode: string) => navigate(`/sentinel-key?mode=${mode}`);

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><ShieldCheck className="h-6 w-6" aria-hidden /></div>
        <div><h1 className="text-2xl font-semibold tracking-tight">Sentinel Key</h1><p className="text-muted-foreground">Secure ID &amp; Password Generator. Everything is created and checked in your browser.</p></div>
      </header>

      <Tabs value={top} onValueChange={go} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-auto sm:inline-flex">
          <TabsTrigger value="generate">Generate</TabsTrigger><TabsTrigger value="analyze">Analyze</TabsTrigger><TabsTrigger value="safety">Website safety</TabsTrigger><TabsTrigger value="vault">Vault</TabsTrigger><TabsTrigger value="overview">Overview</TabsTrigger>
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
        <TabsContent value="analyze"><AnalyzerPanel /></TabsContent>
        <TabsContent value="safety"><SafetyPanel /></TabsContent>
        <TabsContent value="vault"><VaultPanel vault={vault} /></TabsContent>
        <TabsContent value="overview"><OverviewPanel vault={vault} go={go} /></TabsContent>
      </Tabs>
    </motion.div>
  );
}
