import { useState } from "react";
import { Download, KeySquare, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RangeField, TextField, Notice, StrengthMeter } from "./ui-bits";
import { SecretField } from "./SecretField";
import { generateToken, ID_LIMITS, type TokenEncoding } from "@/lib/sentinel-key/ids";
import { DEFAULT_RECOVERY_OPTIONS, generateRecoveryCodes, recoveryEntropyBits, RECOVERY_LIMITS, type RecoveryOptions } from "@/lib/sentinel-key/recovery";
import { copyText, downloadText } from "@/lib/sentinel-key/clipboard";
import { recordGenerated, useSentinelSettings } from "@/lib/sentinel-key/session-store";

function TokenTool() {
  const [bytes, setBytes] = useState(32);
  const [encoding, setEncoding] = useState<TokenEncoding>("base64url");
  const [prefix, setPrefix] = useState("");
  const [res, setRes] = useState<{ value: string; entropyBits: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generate = () => { try { setRes(generateToken({ bytes, encoding, prefix })); setError(null); recordGenerated("token"); } catch (e) { setError(e instanceof Error ? e.message : "Generation failed."); } };
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 rounded-xl border bg-card p-4 space-y-4">
        <RangeField id="tk-bytes" label="Size in bytes" value={bytes} min={ID_LIMITS.minTokenBytes} max={ID_LIMITS.maxTokenBytes} onChange={setBytes} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><label htmlFor="tk-enc" className="text-sm font-medium">Encoding</label>
            <select id="tk-enc" value={encoding} onChange={(e) => setEncoding(e.target.value as TokenEncoding)} className="h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><option value="base64url">Base64url (shorter)</option><option value="hex">Hex</option></select></div>
          <TextField id="tk-prefix" label="Optional prefix" value={prefix} onChange={setPrefix} maxLength={32} placeholder="sk_live_" hint="Only if the receiving system expects one." />
        </div>
        <Notice tone="warn" title="Keep tokens out of client code and repositories">Store API tokens and application secrets in a server-side secret manager or environment variable. Anything shipped to a browser or committed to a public repository must be treated as exposed. This tool does not create credentials for Cintexa Nexus itself.</Notice>
      </div>
      <div className="lg:col-span-2 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-4 self-start lg:sticky lg:top-20">
        <Button type="button" className="w-full" onClick={generate}><KeySquare /> Generate token</Button>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <SecretField label="Generated token" value={res?.value ?? null} onRegenerate={generate} onClear={() => setRes(null)} />
        {res && <StrengthMeter bits={res.entropyBits} />}
        <p className="text-xs text-muted-foreground">Generated from {bytes} secure random bytes. Entropy is exact for the random part; a prefix adds none.</p>
      </div>
    </div>
  );
}

function RecoveryTool() {
  const settings = useSentinelSettings();
  const [o, setO] = useState<RecoveryOptions>(DEFAULT_RECOVERY_OPTIONS);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(false);
  const generate = () => { try { setCodes(generateRecoveryCodes(o)); setError(null); setShown(false); setNote(""); recordGenerated("recovery", o.count); } catch (e) { setError(e instanceof Error ? e.message : "Generation failed."); } };
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 rounded-xl border bg-card p-4 space-y-4">
        <RangeField id="rc-count" label="Number of codes" value={o.count} min={RECOVERY_LIMITS.minCount} max={RECOVERY_LIMITS.maxCount} onChange={(count) => setO((x) => ({ ...x, count }))} />
        <RangeField id="rc-groups" label="Groups per code" value={o.groups} min={RECOVERY_LIMITS.minGroups} max={RECOVERY_LIMITS.maxGroups} onChange={(groups) => setO((x) => ({ ...x, groups }))} />
        <RangeField id="rc-len" label="Characters per group" value={o.groupLength} min={RECOVERY_LIMITS.minGroupLen} max={RECOVERY_LIMITS.maxGroupLen} onChange={(groupLength) => setO((x) => ({ ...x, groupLength }))} />
        <p className="text-xs text-muted-foreground">About {Math.round(recoveryEntropyBits(o))} bits per code. Look-alike characters (0, O, 1, I, L) are never used.</p>
        <Notice tone="warn" title="These are not active MFA credentials">Codes only work if the receiving service supports this format and you register them there. Sentinel Key does not enrol or verify multi-factor authentication. Store codes apart from your passwords, for example printed in a safe place. They are not saved automatically.</Notice>
      </div>
      <div className="lg:col-span-2 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-4 self-start lg:sticky lg:top-20">
        <Button type="button" className="w-full" onClick={generate}><LifeBuoy /> Generate codes</Button>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {codes.length === 0 ? <p className="text-sm text-muted-foreground">No codes on screen.</p> : (
          <>
            <ul className="grid grid-cols-1 gap-1.5 rounded-lg border bg-background p-3 font-mono text-sm" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{shown ? c : "•".repeat(c.length)}</li>)}</ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShown((s) => !s)} aria-pressed={shown}>{shown ? "Hide" : "Show"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={async () => setNote((await copyText(codes.join("\n"), settings.clipboardClearSeconds)) ? "Copied." : "Copy failed.")}>Copy</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => downloadText("recovery-codes.txt", `Recovery codes (generated ${new Date().toISOString().slice(0, 10)})\nKeep separate from your passwords.\n\n${codes.join("\n")}\n`)}><Download /> Download</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setCodes([]); setNote("Codes removed from the screen."); }}>Clear</Button>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{note}</p>
      </div>
    </div>
  );
}

export function DeveloperPanel({ initial }: { initial: "token" | "recovery" }) {
  return (
    <Tabs defaultValue={initial} className="space-y-4">
      <TabsList><TabsTrigger value="token">API tokens</TabsTrigger><TabsTrigger value="recovery">Recovery codes</TabsTrigger></TabsList>
      <TabsContent value="token"><TokenTool /></TabsContent>
      <TabsContent value="recovery"><RecoveryTool /></TabsContent>
    </Tabs>
  );
}
