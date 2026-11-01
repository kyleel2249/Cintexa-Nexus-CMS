import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "wouter";
import { Search, X, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TONE_CLASS, toneOf, labelOf, type Tone } from "@/lib/sales/labels";
import type { QueryState } from "@/lib/sales/hooks";
import type { SalesApiError } from "@/lib/sales/api";
import { useDebounced } from "@/lib/sales/hooks";
import { Term, Hint } from "./Hint";
import { exportPagePdf } from "@/lib/sales/page-pdf";

// ───────── layout ─────────
export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href}>
            <span className="mb-1 inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> {back.label}
            </span>
          </Link>
        )}
        <h2 className="truncate text-2xl font-semibold tracking-tight"><Term icon>{title}</Term></h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}<button type="button" onClick={() => exportPagePdf(title)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-secondary" title="Download what this page is showing (with its current filters) as a PDF" aria-label={`Download ${title} as PDF`}>PDF</button></div>
    </div>
  );
}

export function Panel({ title, description, actions, children, className, flush }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn("rounded-xl border bg-card text-card-foreground", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold">{typeof title === "string" ? <Term icon>{title}</Term> : title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status, label, tone }: { status: string | null | undefined; label?: string; tone?: Tone }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium", TONE_CLASS[tone ?? toneOf(status)])}><Term term={status ?? undefined}>{label ?? labelOf(status)}</Term></span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">{children}</span>;
}

export function KpiCard({ label, value, hint, href, tone, unavailable, loading }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone; unavailable?: string; loading?: boolean }) {
  const body = (
    <div className={cn("h-full rounded-xl border bg-card p-4 transition-colors", href && "cursor-pointer hover:border-primary/50")}>
      <p className="text-xs font-medium text-muted-foreground"><Term icon>{label}</Term></p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-secondary" />
      ) : unavailable ? (
        <p className="mt-2 text-sm text-muted-foreground" title={unavailable}>Not available</p>
      ) : (
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-rose-500", tone === "success" && "text-emerald-500", tone === "warning" && "text-amber-500")}>{value}</p>
      )}
      {(unavailable || hint) && <p className="mt-1 text-xs text-muted-foreground">{unavailable ?? hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary", className)} />;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-secondary" style={{ width: `${95 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: SalesApiError | Error; onRetry?: () => void }) {
  const e = error as SalesApiError;
  if (e.status === 403) return <PermissionDenied message={e.message} />;
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <p className="font-medium text-rose-500">Something went wrong</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{error.message}</p>
      {e.requestId && <p className="mt-1 text-[11px] text-muted-foreground">Reference: {e.requestId}</p>}
      {onRetry && <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function PermissionDenied({ message }: { message?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <p className="font-medium">You don't have access to this</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message ?? "Your sales role doesn't include this permission. Ask a Sales Administrator if you need it."}</p>
    </div>
  );
}

/** Renders loading / error / permission-denied states for a query and the content once data is there. */
export function QueryBoundary<T>({ q, children, skeletonRows }: { q: QueryState<T>; children: (data: T) => ReactNode; skeletonRows?: number }) {
  if (q.error && q.data === undefined) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.loading || q.data === undefined) return <Skeleton rows={skeletonRows} />;
  return <>{children(q.data)}</>;
}

export function TabBar<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors", value === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          <Term>{t.label}</Term>
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-secondary px-1.5 text-[11px]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max = 100, tone }: { value: number; max?: number; tone?: Tone }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", tone === "danger" ? "bg-rose-500" : tone === "warning" ? "bg-amber-500" : tone === "success" ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ───────── overlays ─────────
function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[data-autofocus],input:not([type=hidden]),select,textarea");
      (el ?? ref.current)?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open]);
  return ref;
}

const SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" } as const;

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: keyof typeof SIZES }) {
  const ref = useOverlay(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className={cn("relative flex max-h-[92vh] w-full flex-col rounded-t-xl border bg-card shadow-xl outline-none sm:rounded-xl", SIZES[size])}>
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h3 id={id} className="text-base font-semibold">{title}</h3>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = "max-w-2xl" }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useOverlay(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className={cn("relative flex h-full w-full flex-col border-l bg-card shadow-xl outline-none", width)}>
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h3 id={id} className="truncate text-base font-semibold">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger, pending, reasonLabel, reasonRequired }: { open: boolean; onClose: () => void; onConfirm: (reason?: string) => void; title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean; pending?: boolean; reasonLabel?: string; reasonRequired?: boolean }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const blocked = pending || (!!reasonLabel && !!reasonRequired && reason.trim().length === 0);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button variant={danger ? "destructive" : "default"} disabled={blocked} onClick={() => onConfirm(reasonLabel ? reason.trim() : undefined)}>{pending ? "Working…" : confirmLabel}</Button></>}>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {reasonLabel && (
        <Field label={reasonLabel} required={reasonRequired}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      )}
    </Modal>
  );
}

// ───────── form controls (native, accessible) ─────────
const controlCls = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60";

export function Field({ label, error, hint, required, children, className, explain }: { label?: string; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; explain?: ReactNode }) {
  return (
    <label className={cn("mb-3 block", className)}>
      {label && <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}{required && <span className="text-rose-500"> *</span>}<Hint term={label} text={explain} /></span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-[11px] text-rose-500">{error}</span>}
    </label>
  );
}

export function Input({ className, invalid, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...p} aria-invalid={invalid || undefined} className={cn(controlCls, invalid && "border-rose-500", className)} />;
}
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(controlCls, "resize-y", className)} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn(controlCls, "pr-8", className)}>{children}</select>;
}
export function Checkbox({ label, className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("mb-3 flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input type="checkbox" {...p} className="h-4 w-4 rounded border accent-[hsl(var(--primary))]" />
      {label}
    </label>
  );
}

/** Decimal-safe money input: keeps a string, never a float. Accepts digits and one decimal point. */
export function MoneyInput({ value, onChange, ...p }: { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <Input
      {...p}
      inputMode="decimal"
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/,/g, "");
        if (/^\d*\.?\d{0,4}$/.test(v)) onChange(v);
      }}
    />
  );
}

export function SearchBox({ value, onChange, placeholder = "Search…", delay = 300 }: { value: string; onChange: (v: string) => void; placeholder?: string; delay?: number }) {
  const [local, setLocal] = useState(value);
  const debounced = useDebounced(local, delay);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setLocal(value);
    }
  }, [value]);
  useEffect(() => {
    if (debounced !== last.current) {
      last.current = debounced;
      onChange(debounced);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input aria-label={placeholder} value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export function IconButton({ label, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} {...p} className={cn("rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50", className)}>{children}</button>;
}

// ───────── tables ─────────
export interface Column<R> {
  key: string;
  header: string;
  render: (row: R) => ReactNode;
  align?: "left" | "right";
  /** sortable server-side column key (sent as ?sort=) */
  sort?: string;
  /** hide below the md breakpoint */
  hideOnMobile?: boolean;
  className?: string;
}

export function DataTable<R>({ columns, rows, rowKey, onRowClick, sort, onSort, empty, caption }: { columns: Column<NoInfer<R>>[]; rows: R[]; rowKey: (r: R) => string | number; onRowClick?: (r: R) => void; sort?: string; onSort?: (s: string) => void; empty?: ReactNode; caption?: string }) {
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  const activeKey = sort?.replace(/^-/, "");
  const desc = sort?.startsWith("-");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={c.sort && activeKey === c.sort ? (desc ? "descending" : "ascending") : undefined} className={cn("whitespace-nowrap px-4 py-2 font-medium", c.align === "right" && "text-right", c.hideOnMobile && "hidden md:table-cell")}>
                {c.sort && onSort ? (
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onSort(activeKey === c.sort && !desc ? `-${c.sort}` : c.sort!)}>
                    <Term>{c.header}</Term>
                    {activeKey === c.sort && <span aria-hidden="true">{desc ? "↓" : "↑"}</span>}
                  </button>
                ) : (
                  <Term>{c.header}</Term>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === "Enter" ? onRowClick(r) : undefined) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn("border-b last:border-0", onRowClick && "cursor-pointer hover:bg-secondary/50 focus:bg-secondary/50 focus:outline-none")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-4 py-2.5 align-middle", c.align === "right" && "text-right tabular-nums", c.hideOnMobile && "hidden md:table-cell", c.className)}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total > 0 ? <p className="px-4 py-2 text-xs text-muted-foreground">{total} {total === 1 ? "record" : "records"}</p> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
      <span>{from}–{to} of {total}</span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></IconButton>
        <span className="px-2">Page {page} of {pages}</span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></IconButton>
      </div>
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{i.value === null || i.value === undefined || i.value === "" ? "—" : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
