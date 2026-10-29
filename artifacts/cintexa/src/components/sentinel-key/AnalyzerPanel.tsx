import { useState } from "react";
import { Loader2, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, StrengthMeter, Stat, TextField } from "./ui-bits";
import { analyzePassword, searchSpace, type PasswordAnalysis } from "@/lib/sentinel-key/analysis";
import { checkPwned, type BreachResult } from "@/lib/sentinel-key/breach";
import { Eye, EyeOff } from "lucide-react";

export function AnalyzerPanel() {
  const [pw, setPw] = useState("");
  const [shown, setShown] = useState(false);
  const [breach, setBreach] = useState<BreachResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a: PasswordAnalysis = analyzePassword(pw);
  const onChange = (v: string) => { setPw(v); setBreach(null); setError(null); };
  const check = async () => {
    setBusy(true); setError(null); setBreach(null);
    try { setBreach(await checkPwned(pw)); } catch (e) { setError(e instanceof Error && e.name !== "AbortError" ? e.message : "The breach service could not be reached. Nothing was sent beyond a 5-character hash prefix."); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="space-y-1.5">
          <TextField id="an-pw" label="Password to analyse" type={shown ? "text" : "password"} value={pw} onChange={onChange} maxLength={256} autoComplete="off" hint="Analysed in your browser. Do not paste a password you currently use on a shared computer." />
          <Button type="button" variant="outline" size="sm" onClick={() => setShown((s) => !s)} aria-pressed={shown}>{shown ? <EyeOff /> : <Eye />}{shown ? "Hide" : "Show"}</Button>
        </div>
        <StrengthMeter bits={a.entropyBits} estimated />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Length" value={a.length} /><Stat label="Pool size" value={a.poolSize || "-"} /><Stat label="Search space" value={<span className="text-sm">{searchSpace(a.entropyBits)}</span>} />
        </div>
        <Notice>For a typed password the entropy is an estimate: it assumes random characters from the types you used, then deducts for patterns found. Length alone is not strength, and no estimate is a guarantee.</Notice>
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="font-medium">Findings</h3>
          {pw ? (
            <>
              {a.weaknesses.length ? <ul className="list-disc pl-5 text-sm space-y-1">{a.weaknesses.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="text-sm text-muted-foreground">No weaknesses found by the local checks.</p>}
              <h4 className="text-sm font-medium pt-2">Suggestions</h4>
              <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">{a.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          ) : <p className="text-sm text-muted-foreground">Type or paste a password to see its analysis. Nothing is stored.</p>}
        </div>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <h3 className="font-medium flex items-center gap-2"><ShieldQuestion className="h-4 w-4 text-primary" aria-hidden />Known-breach check</h3>
          <p className="text-xs text-muted-foreground">Uses the Pwned Passwords range service. Your browser sends only the first 5 characters of the password's SHA-1 hash to api.pwnedpasswords.com. The password and the full hash never leave this device.</p>
          <Button type="button" onClick={check} disabled={!pw || busy}>{busy && <Loader2 className="animate-spin" />}Check against known breaches</Button>
          <div role="status" aria-live="polite" className="text-sm">
            {error && <p className="text-destructive">{error}</p>}
            {breach?.found && <p className="text-rose-500 font-medium">This password appears in known breach data ({breach.count.toLocaleString()} times). Do not use it anywhere. This says nothing about whether any of your accounts were compromised.</p>}
            {breach && !breach.found && <p className="text-muted-foreground">Not found in the dataset. That does not prove the password is safe, only that it is not a known leaked one.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
