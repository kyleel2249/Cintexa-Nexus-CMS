import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { labelFor } from "@/lib/sentinel-key/analysis";

export function ToggleRow({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background/50 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  );
}

export function RangeField({ id, label, value, min, max, onChange, suffix }: { id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value}
          onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
          className="h-8 w-20 rounded-md border bg-background px-2 text-right text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={(v) => onChange(v[0]!)} aria-label={label} />
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>{min}{suffix}</span><span>{max}{suffix}</span></div>
    </div>
  );
}

export function TextField({ id, label, value, onChange, placeholder, maxLength, hint, type = "text", autoComplete = "off" }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; hint?: string; type?: string; autoComplete?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <input id={id} type={type} value={value} placeholder={placeholder} maxLength={maxLength} autoComplete={autoComplete} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn"; title?: string; children: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div role={tone === "warn" ? "alert" : "note"} className={cn("flex gap-3 rounded-lg border p-3 text-sm", tone === "warn" ? "border-amber-500/40 bg-amber-500/10" : "border-primary/20 bg-primary/5")}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warn" ? "text-amber-500" : "text-primary")} aria-hidden />
      <div className="min-w-0 space-y-1">{title && <p className="font-medium">{title}</p>}<div className="text-muted-foreground">{children}</div></div>
    </div>
  );
}

const LEVEL_STYLE = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];
const LEVEL_TEXT = ["text-rose-500", "text-orange-500", "text-amber-500", "text-lime-500", "text-emerald-500"];

export function StrengthMeter({ bits, estimated = false }: { bits: number; estimated?: boolean }) {
  const { label, level } = labelFor(bits);
  return (
    <div className="space-y-1.5" role="img" aria-label={`Strength: ${label}, about ${Math.round(bits)} bits of entropy${estimated ? " (estimate)" : ""}`}>
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-500", i <= level && bits > 0 ? LEVEL_STYLE[level] : "bg-muted")} />)}
      </div>
      <div className="flex items-center justify-between text-xs"><span className={cn("font-semibold", LEVEL_TEXT[level])}>{bits > 0 ? label : "No value"}</span><span className="text-muted-foreground">{Math.round(bits)} bits{estimated ? " (estimate)" : ""}</span></div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-xl border bg-background/60 p-3"><div className="text-lg font-semibold break-words">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>;
}
