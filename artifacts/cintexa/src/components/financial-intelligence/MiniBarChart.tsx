/**
 * Lightweight CSS bar chart for FI modules — no WebGL dependency.
 * Values are minor units; labels are period strings.
 */
import { formatCurrency, minorToMajor } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

export interface BarPoint {
  label: string;
  value: number; // minor units
  kind?: "actual" | "forecast" | "baseline";
}

interface MiniBarChartProps {
  data: BarPoint[];
  currency?: string;
  className?: string;
  height?: number;
}

export function MiniBarChart({ data, currency = "GHS", className, height = 160 }: MiniBarChartProps) {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground">No series data yet.</p>;
  }
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-end gap-1.5 sm:gap-2" style={{ height }}>
        {data.map((d) => {
          const pct = Math.max(4, Math.round((Math.abs(d.value) / max) * 100));
          const tone =
            d.kind === "forecast"
              ? "bg-amber-500/70 hover:bg-amber-400/80"
              : d.value < 0
                ? "bg-red-500/70"
                : "bg-primary/80 hover:bg-primary";
          return (
            <div key={d.label} className="flex flex-1 flex-col items-center justify-end h-full gap-1 min-w-0">
              <span className="text-[10px] tabular-nums text-muted-foreground truncate w-full text-center">
                {formatCurrency(d.value, currency)}
              </span>
              <div
                className={cn("w-full max-w-[48px] mx-auto rounded-t-md transition-all", tone)}
                style={{ height: `${pct}%` }}
                title={`${d.label}: ${minorToMajor(d.value)} ${currency}`}
              />
              <span className="text-[10px] text-muted-foreground truncate w-full text-center">{d.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-primary/80" /> Actual
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-500/70" /> Forecast (estimate)
        </span>
      </div>
    </div>
  );
}
