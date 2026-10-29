import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TYPE_LABEL: Record<string, string> = { password: "Password", passphrase: "Passphrase", id: "ID", token: "API token", recovery: "Recovery codes" };
export const TYPES = Object.keys(TYPE_LABEL);

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <span className="text-muted-foreground">{total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
        <span aria-live="polite">Page {Math.min(page, pages)} of {pages}</span>
        <Button type="button" variant="outline" size="icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
      </div>
    </nav>
  );
}

export function Select({ id, label, value, onChange, children, className }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{children}</select>
    </div>
  );
}

export function Badge2({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  const cls = { ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500", warn: "border-amber-500/40 bg-amber-500/10 text-amber-500", bad: "border-rose-500/40 bg-rose-500/10 text-rose-500", muted: "border-border bg-muted text-muted-foreground" }[tone];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>{children}</span>;
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");
export const settingsText = (s: Record<string, unknown>) => Object.entries(s ?? {}).filter(([, v]) => v !== false && v !== "").map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`)).join(" · ");
export function useQueryParam(name: string): string | null { return new URLSearchParams(typeof location === "undefined" ? "" : location.search).get(name); }
