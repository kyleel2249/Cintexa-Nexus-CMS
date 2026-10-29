import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/sentinel-key/clipboard";
import { useSentinelSettings } from "@/lib/sentinel-key/session-store";
import { cn } from "@/lib/utils";

/** Shows a secret masked by default, with reveal, copy (auto-clearing), regenerate and clear controls. */
export function SecretField({ value, label, onRegenerate, onClear, mono = true, emptyText = "Nothing generated yet." }: { value: string | null; label: string; onRegenerate?: () => void; onClear?: () => void; mono?: boolean; emptyText?: string }) {
  const settings = useSentinelSettings();
  const [shown, setShown] = useState(false);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setShown(false); setStatus(""); }, [value]);
  useEffect(() => {
    if (!shown || settings.autoHideSeconds <= 0) return undefined;
    timer.current = setTimeout(() => { setShown(false); setStatus("Value hidden automatically."); }, settings.autoHideSeconds * 1000);
    return () => clearTimeout(timer.current);
  }, [shown, settings.autoHideSeconds, value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    if (!value) return;
    const ok = await copyText(value, settings.clipboardClearSeconds);
    setStatus(ok ? (settings.clipboardClearSeconds > 0 ? `Copied. The clipboard clears in ${settings.clipboardClearSeconds} seconds.` : "Copied.") : "Copy failed. Reveal the value and copy it manually.");
  }, [value, settings.clipboardClearSeconds]);

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <div role="textbox" aria-readonly="true" aria-label={label} tabIndex={0}
          className={cn("min-h-11 flex-1 min-w-0 rounded-lg border bg-background px-3 py-2.5 text-sm break-all select-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", mono && "font-mono whitespace-pre-wrap", !value && "text-muted-foreground")}>
          {!value ? emptyText : shown ? value : "•".repeat(Math.min(value.length, 40))}
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon" disabled={!value} onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-label={shown ? `Hide ${label}` : `Show ${label}`}>{shown ? <EyeOff /> : <Eye />}</Button>
          <Button type="button" variant="outline" size="icon" disabled={!value} onClick={copy} aria-label={`Copy ${label}`}>{status.startsWith("Copied") ? <Check className="text-emerald-500" /> : <Copy />}</Button>
          {onRegenerate && <Button type="button" variant="outline" size="icon" onClick={onRegenerate} aria-label={`Regenerate ${label}`}><RefreshCw /></Button>}
          {onClear && <Button type="button" variant="outline" size="icon" disabled={!value} onClick={() => { setStatus("Value removed from the screen."); onClear(); }} aria-label={`Remove ${label} from screen`}><Trash2 /></Button>}
        </div>
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" role="status" aria-live="polite">{status}</p>
    </div>
  );
}
