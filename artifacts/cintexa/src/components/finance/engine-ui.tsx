import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMinor, parseToMinor } from "@/lib/finance/api";

/** Shared building blocks for the accounting-engine screens (FX, Inventory, Payroll, Restatements). */

export const today = () => new Date().toISOString().slice(0, 10);

export const previousMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export const money = (minor: number | null | undefined, ccy = "GHS") =>
  minor == null ? "—" : formatMinor(minor, ccy);

/** Parse a user-typed amount into minor units or throw a readable error (surfaced by <Notice/>). */
export function toMinor(input: string, ccy = "GHS", label = "Amount"): number {
  const r = parseToMinor(input, ccy);
  if (!r.ok) throw new Error(`${label}: ${r.error}`);
  return r.minor;
}

export const rateText = (micro: number | null | undefined) =>
  micro == null ? "—" : String(Number((micro / 1_000_000).toFixed(6)));

export function Page({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ?? "min-w-[140px] flex-1"}>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Shows the server's own message (e.g. COGS_CONDITIONS_NOT_MET) instead of a generic failure. */
export function Notice({ error, ok }: { error?: unknown; ok?: string | null }) {
  if (error) return <p role="alert" className="text-sm text-rose-600">{(error as Error)?.message || "Request failed."}</p>;
  if (ok) return <p className="text-sm text-emerald-600">{ok}</p>;
  return null;
}

export function Badge2({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
  const c = { ok: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", bad: "bg-rose-100 text-rose-800", muted: "bg-muted text-muted-foreground" }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`whitespace-nowrap px-3 py-2 text-sm ${value === t.key ? "border-b-2 border-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h + i} className={`px-2 py-1.5 font-medium ${i > 0 ? "" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <p className="px-2 py-3 text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
}

export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-2 py-1.5 ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}>{children}</td>
);

/** One idempotency key per user attempt; call reset() after success so the next action gets a new key. */
export function useIdempotencyKey() {
  const make = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random());
  const [key, setKey] = useState(make);
  return { key, reset: () => setKey(make()) };
}
