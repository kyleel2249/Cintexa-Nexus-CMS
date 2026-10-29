import { useState } from "react";
import { Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecretField } from "./SecretField";
import { RangeField, StrengthMeter, Stat, TextField, ToggleRow, Notice } from "./ui-bits";
import { DEFAULT_PASSPHRASE_OPTIONS, generatePassphrase, PASSPHRASE_LIMITS, type PassphraseCase, type PassphraseOptions } from "@/lib/sentinel-key/passphrase";
import type { GeneratedSecret } from "@/lib/sentinel-key/password";
import { searchSpace } from "@/lib/sentinel-key/analysis";
import { recordGenerated } from "@/lib/sentinel-key/session-store";

export function PassphrasePanel() {
  const [o, setO] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS);
  const [res, setRes] = useState<GeneratedSecret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<PassphraseOptions>) => setO((x) => ({ ...x, ...p }));
  const generate = () => { try { setRes(generatePassphrase(o)); setError(null); recordGenerated("passphrase"); } catch (e) { setError(e instanceof Error ? e.message : "Generation failed."); } };
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 rounded-xl border bg-card p-4 space-y-4">
        <RangeField id="pp-words" label="Words" value={o.words} min={PASSPHRASE_LIMITS.minWords} max={PASSPHRASE_LIMITS.maxWords} onChange={(words) => set({ words })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField id="pp-sep" label="Separator" value={o.separator} maxLength={PASSPHRASE_LIMITS.maxSeparator} onChange={(separator) => set({ separator })} hint="Up to 3 characters. Can be empty." />
          <div className="space-y-1.5">
            <label htmlFor="pp-case" className="text-sm font-medium">Capitalisation</label>
            <select id="pp-case" value={o.casing} onChange={(e) => set({ casing: e.target.value as PassphraseCase })} className="h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <option value="lower">lowercase</option><option value="title">Title Case</option><option value="upper">UPPERCASE</option>
            </select>
          </div>
        </div>
        <ToggleRow id="pp-num" label="Add a number" hint="One random digit added to one random word." checked={o.includeNumber} onChange={(includeNumber) => set({ includeNumber })} />
        <Notice>Words come from the EFF Large Wordlist (7,776 words, about 12.9 bits each) and are picked with unbiased secure randomness. Do not swap words for ones you prefer; that lowers the strength.</Notice>
      </div>
      <div className="lg:col-span-2 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-4 lg:sticky lg:top-20 self-start">
        <Button type="button" className="w-full" onClick={generate}><Type /> Generate passphrase</Button>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <SecretField label="Generated passphrase" value={res?.value ?? null} mono={false} onRegenerate={generate} onClear={() => setRes(null)} />
        {res && <><StrengthMeter bits={res.entropyBits} /><div className="grid grid-cols-2 gap-2"><Stat label="Wordlist size" value={res.poolSize.toLocaleString()} /><Stat label="Search space" value={<span className="text-sm">{searchSpace(res.entropyBits)}</span>} /></div></>}
      </div>
    </div>
  );
}
