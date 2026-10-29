import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecretField } from "./SecretField";
import { RangeField, StrengthMeter, Stat, TextField, ToggleRow, Notice } from "./ui-bits";
import { DEFAULT_PASSWORD_OPTIONS, generatePasswords, PASSWORD_LIMITS, validatePasswordOptions, type GeneratedSecret, type PasswordOptions } from "@/lib/sentinel-key/password";
import { searchSpace, labelFor } from "@/lib/sentinel-key/analysis";
import { copyText } from "@/lib/sentinel-key/clipboard";
import { useSentinelSettings } from "@/lib/sentinel-key/session-store";
import { useStoredGeneration } from "@/lib/sentinel-key/store/use-stored-generation";
import { StorageControls } from "./StorageControls";

export function PasswordPanel() {
  const reduce = useReducedMotion();
  const settings = useSentinelSettings();
  const sg = useStoredGeneration("password");
  const [o, setO] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [count, setCount] = useState(1);
  const [results, setResults] = useState<GeneratedSecret[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const set = (p: Partial<PasswordOptions>) => setO((prev) => ({ ...prev, ...p }));
  const invalid = validatePasswordOptions(o);

  const generate = async (n = count) => {
    const err = validatePasswordOptions(o);
    if (err) { setError(err); return; }
    let made: GeneratedSecret[] = [];
    const res = await sg.run(() => { made = generatePasswords(o, n); return made.map((r) => r.value).join("\n"); },
      { length: o.length, lower: !!o.lower, upper: !!o.upper, digits: !!o.digits, symbols: !!o.symbols, excludeAmbiguous: !!o.excludeAmbiguous, avoidRepeats: !!o.avoidRepeats, avoidSequences: !!o.avoidSequences }, n);
    setNote("");
    if (!res.generated) { setError(res.error ?? "Nothing was generated."); setResults([]); return; }
    setResults(made); setError(null);
  };
  const first = results[0];
  const clear = () => { setResults([]); setNote(""); sg.clear(); };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <div className="rounded-xl border bg-card p-4 space-y-4">
          <RangeField id="pw-length" label="Length" value={o.length} min={PASSWORD_LIMITS.minLength} max={PASSWORD_LIMITS.maxLength} onChange={(length) => set({ length })} suffix="" />
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow id="pw-lower" label="Lowercase (a-z)" checked={!!o.lower} onChange={(lower) => set({ lower })} />
            <ToggleRow id="pw-upper" label="Uppercase (A-Z)" checked={!!o.upper} onChange={(upper) => set({ upper })} />
            <ToggleRow id="pw-digits" label="Numbers (0-9)" checked={!!o.digits} onChange={(digits) => set({ digits })} />
            <ToggleRow id="pw-symbols" label="Symbols (!@#…)" checked={!!o.symbols} onChange={(symbols) => set({ symbols })} />
            <ToggleRow id="pw-amb" label="Exclude look-alikes" hint="Il1O0o|" checked={!!o.excludeAmbiguous} onChange={(excludeAmbiguous) => set({ excludeAmbiguous })} />
            <ToggleRow id="pw-rep" label="No repeated characters" hint="Never the same character twice in a row" checked={!!o.avoidRepeats} onChange={(avoidRepeats) => set({ avoidRepeats })} />
            <ToggleRow id="pw-seq" label="No sequences" hint="Blocks runs like abc or 321" checked={!!o.avoidSequences} onChange={(avoidSequences) => set({ avoidSequences })} />
            <ToggleRow id="pw-min" label="Require every selected type" hint="At least one character of each type" checked={(o.minPerCategory ?? 0) > 0} onChange={(v) => set({ minPerCategory: v ? 1 : 0 })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="pw-custom" label="Extra characters" value={o.custom ?? ""} onChange={(custom) => set({ custom })} maxLength={64} hint="Added as an additional character type." />
            <TextField id="pw-exclude" label="Never use these characters" value={o.exclude ?? ""} onChange={(exclude) => set({ exclude })} maxLength={64} hint="For sites that reject certain symbols." />
          </div>
          <RangeField id="pw-count" label="How many" value={count} min={1} max={PASSWORD_LIMITS.maxBulk} onChange={setCount} />
        </div>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-4 lg:sticky lg:top-20">
          <StorageControls sg={sg} />
          <Button type="button" className="w-full" onClick={() => generate()} disabled={!!invalid || !!sg.blocked || sg.busy}><KeyRound /> Generate password{count > 1 ? `s (${count})` : ""}</Button>
          {sg.blocked && <p className="text-xs text-muted-foreground" role="status">{sg.blocked}</p>}
          {(error || invalid) && <p className="text-sm text-destructive" role="alert">{error ?? invalid}</p>}
          {results.length <= 1 && <SecretField label="Generated password" value={first?.value ?? null} onRegenerate={sg.blocked ? undefined : () => generate(1)} onClear={clear} />}
          {first && (
            <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <StrengthMeter bits={first.entropyBits} />
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Character pool" value={first.poolSize} />
                <Stat label="Search space" value={<span className="text-sm">{searchSpace(first.entropyBits)}</span>} />
              </div>
              <p className="text-xs text-muted-foreground">Entropy is derived from how this password was generated ({labelFor(first.entropyBits).label}). It is an upper bound: rules such as no sequences remove a small number of possibilities. It is not a crack-time promise.</p>
            </motion.div>
          )}
          {!first && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" aria-hidden />Passwords are created in your browser with the Web Crypto API and are never sent anywhere or saved.</p>}
        </div>
      </div>

      {results.length > 1 && (
        <div className="lg:col-span-5 rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{results.length} passwords</h3>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={async () => setNote((await copyText(results.map((r) => r.value).join("\n"), settings.clipboardClearSeconds)) ? "All copied." : "Copy failed.")}>Copy all</Button>
              <Button type="button" variant="outline" size="sm" onClick={clear}>Remove from screen</Button>
            </div>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">{results.map((r, i) => <li key={r.value}><SecretField label={`Password ${i + 1}`} value={r.value} /></li>)}</ul>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{note}</p>
        </div>
      )}
      <div className="lg:col-span-5"><Notice title="Use each password once">Create a different password for every account, store them in a password manager or the Sentinel Key vault, and enable multi-factor authentication or passkeys where offered.</Notice></div>
    </div>
  );
}
