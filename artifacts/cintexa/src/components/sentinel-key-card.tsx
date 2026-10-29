import { Link } from "wouter";
import { ArrowRight, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { totalGenerated, useSessionStats } from "@/lib/sentinel-key/session-store";
import { vaultExists } from "@/lib/sentinel-key/vault";

const chip = "inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-3 py-2 text-sm font-medium cursor-pointer hover:border-primary/40 hover:bg-secondary transition-colors";

/**
 * Dashboard entry for Sentinel Key. Never generates or displays a secret: it only links to the tool and shows
 * counts and flags calculated locally in this browser.
 */
export function SentinelKeyCard() {
  const stats = useSessionStats();
  const total = totalGenerated(stats);
  const hasVault = vaultExists();
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden />Sentinel Key</CardTitle>
          <p className="text-xs font-medium text-primary mt-1">Secure ID &amp; Password Generator</p>
          <CardDescription className="mt-1.5">Generate strong passwords, private identifiers, secure passphrases, and application tokens. Review credential strength and access practical phishing-awareness checks.</CardDescription>
        </div>
        <Link href="/sentinel-key"><span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground cursor-pointer hover:opacity-90 whitespace-nowrap">Open <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span></Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Link href="/sentinel-key?mode=password"><span className={chip}><KeyRound className="h-4 w-4 text-primary" aria-hidden />Generate a password</span></Link>
          <Link href="/sentinel-key?mode=id"><span className={chip}><Fingerprint className="h-4 w-4 text-primary" aria-hidden />Generate an ID</span></Link>
        </div>
        <p className="text-xs text-muted-foreground">
          {total === 0 && !hasVault ? "You haven't used Sentinel Key yet. Generation runs in your browser and nothing is saved unless you create a vault." : `This session: ${total} generated. Vault: ${stats.vaultUnlocked ? "unlocked" : hasVault ? "locked" : "not created"}.`}
        </p>
      </CardContent>
    </Card>
  );
}
