import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, CornerDownLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSalesOptional } from "@/context/SalesContext";
import { useDebounced, useSalesQuery } from "@/lib/sales/hooks";
import { NAV_ICONS } from "@/lib/sales/nav-icons";

interface Hit { type: string; id: number; title: string; subtitle: string; href: string }
interface Entry { key: string; title: string; subtitle?: string; href: string; group: string; icon?: React.ComponentType<{ className?: string }> }

const CMS_PAGES: { title: string; href: string }[] = [
  { title: "Dashboard", href: "/" }, { title: "Business Diagnostic", href: "/diagnostics" }, { title: "Website Intelligence", href: "/website-intelligence" }, { title: "Sites", href: "/sites" }, { title: "Pages", href: "/pages" },
  { title: "Posts", href: "/posts" }, { title: "Content Calendar", href: "/calendar" }, { title: "Content Pipeline", href: "/pipeline" }, { title: "Media Library", href: "/media" }, { title: "Subscribers", href: "/subscribers" },
  { title: "Users", href: "/users" }, { title: "Categories", href: "/categories" }, { title: "Menus", href: "/menus" }, { title: "Forms", href: "/forms" }, { title: "SEO", href: "/seo" }, { title: "AI Studio", href: "/ai" }, { title: "Plugins", href: "/plugins" }, { title: "Settings", href: "/settings" },
];

/** Cmd/Ctrl+K palette: jump to any CMS page or Sales section, and search sales records the signed-in role may see. */
export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, nav] = useLocation();
  const sales = useSalesOptional();
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const term = useDebounced(text.trim(), 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searching = open && sales?.access === "ready" && term.length >= 2;
  const q = useSalesQuery<{ items: Hit[] }>(searching ? "/search" : null, { q: term });

  useEffect(() => {
    if (open) { setText(""); setIndex(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const t = text.trim().toLowerCase();
    const pages: Entry[] = [
      ...(sales?.access === "ready" ? sales.nav.map((i) => ({ key: `s-${i.key}`, title: i.label, href: i.href, group: "Sales Management", icon: NAV_ICONS[i.icon] })) : []),
      ...CMS_PAGES.map((p) => ({ key: `c-${p.href}`, title: p.title, href: p.href, group: "Pages" })),
    ].filter((e) => !t || e.title.toLowerCase().includes(t)).slice(0, t ? 8 : 12);
    const records: Entry[] = (q.data?.items ?? []).map((h) => ({ key: `r-${h.type}-${h.id}`, title: h.title, subtitle: h.subtitle, href: h.href, group: h.type[0]!.toUpperCase() + h.type.slice(1) }));
    return [...records, ...pages];
  }, [text, sales, q.data]);

  useEffect(() => { setIndex(0); }, [text, q.data]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);

  if (!open) return null;
  const go = (e: Entry) => { onClose(); nav(e.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, entries.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && entries[index]) { e.preventDefault(); go(entries[index]!); }
  };
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border bg-popover shadow-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} role="combobox" aria-expanded="true" aria-controls="global-search-list" aria-activedescendant={entries[index] ? `gs-${index}` : undefined} placeholder="Search pages, leads, accounts, quotations, orders…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          {q.loading && searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching" />}
          <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">Esc</kbd>
        </div>
        <ul id="global-search-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {entries.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">{searching && q.loading ? "Searching…" : "No results"}</li>}
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? (lastGroup = e.group) : null;
            const Icon = e.icon;
            return (
              <li key={e.key} role="presentation">
                {header && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{header}</p>}
                <div id={`gs-${i}`} data-idx={i} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => go(e)} className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm", i === index ? "bg-primary/10 text-foreground" : "text-muted-foreground")}>
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-foreground">{e.title}</span>{e.subtitle && <span className="block truncate text-xs text-muted-foreground">{e.subtitle}</span>}</span>
                  {i === index && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
        {sales?.access === "ready" && term.length < 2 && <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Type 2 or more characters to search sales records you have access to.</p>}
        {q.error && searching && <p role="alert" className="border-t px-3 py-2 text-[11px] text-rose-500">{q.error.message}</p>}
      </div>
    </div>
  );
}
