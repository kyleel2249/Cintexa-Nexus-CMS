import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { lookupTerm } from "@/lib/sales/glossary";

/** Small accessible popover: opens on hover, keyboard focus or tap; closes with Esc or an outside click. */
function Pop({ trigger, children, label }: { trigger: (p: { id: string; open: boolean; props: Record<string, unknown> }) => ReactNode; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const w = Math.min(288, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 > window.innerHeight - 120 ? Math.max(8, r.top - 6 - 110) : r.bottom + 6 });
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", esc); document.addEventListener("mousedown", away); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("keydown", esc); document.removeEventListener("mousedown", away); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
  const show = () => { place(); setOpen(true); };
  const props = { "aria-describedby": open ? id : undefined, "aria-label": label, onMouseEnter: show, onMouseLeave: () => setOpen(false), onFocus: show, onBlur: () => setOpen(false), onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); open ? setOpen(false) : show(); } };
  return (
    <span ref={ref} className="relative inline-flex align-baseline">
      {trigger({ id, open, props })}
      {open && pos && <span id={id} role="tooltip" style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.min(288, window.innerWidth - 16) }} className="z-[100] rounded-md border bg-popover p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg">{children}</span>}
    </span>
  );
}

function Body({ term, short, more }: { term?: string; short: string; more?: string }) {
  return <>{term && <strong className="mb-1 block text-[13px]">{term}</strong>}<span className="block">{short}</span>{more && <span className="mt-1 block text-muted-foreground">{more}</span>}</>;
}

/** An (i) button with an explanation. Pass `term` to use the glossary, or `text` for a custom clue. */
export function Hint({ term, text, more, className }: { term?: string; text?: ReactNode; more?: string; className?: string }) {
  const g = term ? lookupTerm(term) : null;
  if (!text && !g) return null;
  return (
    <Pop label={`What does ${g?.term ?? term ?? "this"} mean?`} trigger={({ props }) => <button type="button" {...props} className={cn("ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary", className)}><Info className="h-3 w-3" aria-hidden="true" /></button>}>
      {g ? <Body term={g.term} short={g.short} more={g.more} /> : <span className="block">{text}</span>}{!g ? null : null}{more && !g && <span className="mt-1 block text-muted-foreground">{more}</span>}
    </Pop>
  );
}

/** Text with a dotted underline when the glossary explains it (used inside badges, table headers, tabs and KPI labels). Plain text otherwise. */
export function Term({ children, term, icon, className }: { children: ReactNode; term?: string; icon?: boolean; className?: string }) {
  const key = term ?? (typeof children === "string" ? children : null);
  const g = lookupTerm(key);
  if (!g) return <>{children}</>;
  if (icon) return <>{children}<Hint term={g.term} /></>;
  return (
    <Pop label={`What does ${g.term} mean?`} trigger={({ props }) => <span tabIndex={0} {...props} className={cn("cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 focus:outline-none focus:ring-1 focus:ring-primary", className)}>{children}</span>}>
      <Body term={g.term} short={g.short} more={g.more} />
    </Pop>
  );
}
