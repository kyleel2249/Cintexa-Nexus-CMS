import { useId } from "react";
import { cn } from "@/lib/utils";

const PALETTE = ["#e8b923", "#38bdf8", "#34d399", "#a78bfa", "#fb7185", "#f59e0b", "#94a3b8", "#22d3ee"];
export const chartColor = (i: number) => PALETTE[i % PALETTE.length]!;

export interface Point {
  label: string;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Accessible text alternative for every chart: screen readers get the values, sighted users get a tooltip title. */
function srTable(points: Point[], fmt: (n: number) => string) {
  return (
    <table className="sr-only">
      <tbody>{points.map((p, i) => <tr key={i}><th>{p.label}</th><td>{fmt(p.value)}</td></tr>)}</tbody>
    </table>
  );
}

export function LineChart({ data, height = 180, fmt = String, area = true, className }: { data: Point[]; height?: number; fmt?: (n: number) => string; area?: boolean; className?: string }) {
  const gid = useId().replace(/:/g, "");
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>;
  const W = 600, H = height, padL = 8, padR = 8, padT = 10, padB = 22;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const x = (i: number) => padL + (data.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (data.length - 1));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const step = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Line chart, ${data.length} points, maximum ${fmt(Math.max(...data.map((d) => d.value)))}`} preserveAspectRatio="none" style={{ height }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PALETTE[0]} stopOpacity="0.3" /><stop offset="100%" stopColor={PALETTE[0]} stopOpacity="0" /></linearGradient></defs>
        {[0, 0.5, 1].map((t) => <line key={t} x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="currentColor" strokeOpacity="0.1" />)}
        {area && <path d={`${line} L${x(data.length - 1)},${H - padB} L${x(0)},${H - padB} Z`} fill={`url(#${gid})`} />}
        <path d={line} fill="none" stroke={PALETTE[0]} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r="3" fill={PALETTE[0]}><title>{`${d.label}: ${fmt(d.value)}`}</title></circle>)}
        {data.map((d, i) => (i % step === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.55">{d.label}</text> : null))}
      </svg>
      {srTable(data, fmt)}
    </div>
  );
}

export function BarChart({ data, fmt = String, className, horizontal }: { data: Point[]; fmt?: (n: number) => string; className?: string; horizontal?: boolean }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  if (horizontal) {
    return (
      <div className={cn("space-y-2", className)} role="img" aria-label="Bar chart">
        {data.map((d, i) => (
          <div key={i}>
            <div className="mb-0.5 flex justify-between gap-2 text-xs"><span className="truncate">{d.label}</span><span className="tabular-nums text-muted-foreground">{fmt(d.value)}</span></div>
            <div className="h-2 rounded-full bg-secondary"><div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: chartColor(i) }} /></div>
          </div>
        ))}
      </div>
    );
  }
  const W = 600, H = 180, padB = 22, padT = 8, gap = 6;
  const bw = (W - gap * (data.length + 1)) / data.length;
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart, ${data.length} bars`} style={{ height: H }} preserveAspectRatio="none">
        {data.map((d, i) => {
          const h = (d.value / max) * (H - padB - padT);
          const bx = gap + i * (bw + gap);
          return <g key={i}><rect x={bx} y={H - padB - h} width={Math.max(bw, 1)} height={h} rx="2" fill={chartColor(0)}><title>{`${d.label}: ${fmt(d.value)}`}</title></rect>{data.length <= 12 && <text x={bx + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.55">{d.label.length > 8 ? `${d.label.slice(0, 7)}…` : d.label}</text>}</g>;
        })}
      </svg>
      {srTable(data, fmt)}
    </div>
  );
}

export function Funnel({ stages, fmt = String }: { stages: { label: string; value: number; sub?: string }[]; fmt?: (n: number) => string }) {
  if (stages.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No pipeline data</p>;
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-2" role="img" aria-label="Pipeline funnel">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs text-muted-foreground sm:w-36">{s.label}</span>
          <div className="relative h-7 flex-1 rounded bg-secondary/60">
            <div className="h-full rounded" style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 3 : 0)}%`, background: chartColor(i), opacity: 0.85 }} />
            <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium tabular-nums">{fmt(s.value)}{s.sub ? ` · ${s.sub}` : ""}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ slices, size = 140, fmt = String, centre }: { slices: Point[]; size?: number; fmt?: (n: number) => string; centre?: string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <p className="py-8 text-center text-sm text-muted-foreground">No data</p>;
  const r = 50, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Distribution chart">
        <g transform="rotate(-90 60 60)">
          {slices.map((s, i) => {
            const len = (s.value / total) * c;
            const el = <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={chartColor(i)} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}><title>{`${s.label}: ${fmt(s.value)}`}</title></circle>;
            offset += len;
            return el;
          })}
        </g>
        {centre && <text x="60" y="64" textAnchor="middle" fontSize="14" fontWeight="600" fill="currentColor">{centre}</text>}
      </svg>
      <ul className="space-y-1 text-xs">
        {slices.map((s, i) => <li key={i} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: chartColor(i) }} /><span>{s.label}</span><span className="tabular-nums text-muted-foreground">{fmt(s.value)}</span></li>)}
      </ul>
    </div>
  );
}

export function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  return <svg width={width} height={height} role="img" aria-label="Trend"><polyline points={pts} fill="none" stroke={PALETTE[0]} strokeWidth="1.5" /></svg>;
}
