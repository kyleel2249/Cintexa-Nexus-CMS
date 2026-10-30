import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity, LayoutDashboard, Globe, FileText, PenTool, Image as ImageIcon, Users, Tags,
  MenuSquare, FormInput, Search, Wand2, Settings, MonitorPlay, CalendarDays, Kanban,
  Puzzle, Mail, Target, History, Radar, Briefcase, ChevronDown, X, BrainCircuit, Bot, ShieldCheck, LockKeyhole, ScrollText, Tag, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "framer-motion";
import { SitePreview } from "@/components/site-preview";
import { CintexaLogo } from "@/components/SplashScreen";
import { useSalesOptional } from "@/context/SalesContext";
import { SALES_NAV, SALES_AI_NAV, SALES_GLOSSARY_NAV, showAiNav } from "@/lib/sales/nav";
import { lookupTerm } from "@/lib/sales/glossary";
import { useSalesQuery } from "@/lib/sales/hooks";
import { activeNavKey } from "@/lib/sales/nav";
import { NAV_ICONS } from "@/lib/sales/nav-icons";

const navGroups = [
  { title: "Overview", items: [{ name: "Dashboard", href: "/", icon: LayoutDashboard }] },
  { title: "Intelligence", items: [
    { name: "AI Agents", href: "/agents", icon: Bot },
    { name: "Command Centre", href: "/intelligence", icon: BrainCircuit },
    { name: "Business Diagnostic", href: "/diagnostics", icon: Activity },
    { name: "Diagnostic History", href: "/diagnostics?history=1", icon: History },
    { name: "Website Intelligence", href: "/website-intelligence", icon: Radar },
  ] },
  { title: "Content", items: [
    { name: "Sites", href: "/sites", icon: Globe }, { name: "Pages", href: "/pages", icon: FileText },
    { name: "Posts", href: "/posts", icon: PenTool }, { name: "Calendar", href: "/calendar", icon: CalendarDays },
    { name: "Pipeline", href: "/pipeline", icon: Kanban },
  ]},
  { title: "Media", items: [{ name: "Library", href: "/media", icon: ImageIcon }] },
  { title: "Audience", items: [{ name: "Subscribers", href: "/subscribers", icon: Mail }, { name: "Users", href: "/users", icon: Users }] },
  { title: "Taxonomy", items: [{ name: "Categories", href: "/categories", icon: Tags }, { name: "Menus", href: "/menus", icon: MenuSquare }, { name: "Forms", href: "/forms", icon: FormInput }] },
  { title: "System", items: [{ name: "SEO", href: "/seo", icon: Search }, { name: "AI Studio", href: "/ai", icon: Wand2 }, { name: "Sentinel Key", href: "/sentinel-key", icon: ShieldCheck }, { name: "Secure Vault", href: "/sentinel-key/vault", icon: LockKeyhole }, { name: "Generation History", href: "/sentinel-key/history", icon: ScrollText }, { name: "Alias Manager", href: "/sentinel-key/aliases", icon: Tag }, { name: "Plugins", href: "/plugins", icon: Puzzle }, { name: "Settings", href: "/settings", icon: Settings }] },
];

const SALES_OPEN_KEY = "cintexa-sales-nav-open";

function readOpen(): boolean | null {
  try {
    const v = localStorage.getItem(SALES_OPEN_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

function NavLink({ href, label, Icon, active, onNavigate, extra, clue }: { clue?: string; href: string; label: string; Icon: React.ComponentType<{ className?: string }>; active: boolean; onNavigate?: () => void; extra?: React.ReactNode }) {
  return (
    <Link href={href} onClick={onNavigate}>
      <div title={clue} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 px-2 py-2 rounded-md transition-colors cursor-pointer group", active ? "bg-primary text-primary-foreground font-medium shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
        <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
        <span className="text-sm truncate">{label}</span>{extra}
      </div>
    </Link>
  );
}

/** Sales Management group: always shown; narrows to the sections the signed-in member's role may open. */
function SalesGroup({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  const s = useSalesOptional();
  const onSales = location === "/sales" || location.startsWith("/sales/");
  const [stored, setStored] = useState<boolean | null>(() => readOpen());
  const open = onSales ? true : stored ?? false;
  // Always visible so the module is discoverable. Once the member profile loads the list narrows to the sections their role may open;
  // before that (or when sign-in / the API is unavailable) every section is listed and each page explains what is missing.
  const items = s && s.access === "ready" && s.nav.length > 0 ? s.nav : SALES_NAV;
  const activeKey = activeNavKey(location.split("?")[0]!);
  const ready = Boolean(s && s.access === "ready");
  // AI Command Centre: pinned under the 22 sections. Shown when the role may use it (or while the profile is still loading / unavailable, like the other sections).
  const showAi = !ready || (s ? showAiNav(s.perms) : true);
  const pending = useSalesQuery<{ total: number }>(ready && s?.can("approvals:read") ? "/approvals" : null, { status: "PENDING", page_size: 1 });
  const AiIcon = NAV_ICONS[SALES_AI_NAV.icon];
  const toggle = () => {
    const next = !open;
    setStored(next);
    try { localStorage.setItem(SALES_OPEN_KEY, next ? "1" : "0"); } catch { /* storage unavailable: state is in memory only */ }
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls="sales-nav" className="flex w-full items-center gap-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
        <Briefcase className="h-3.5 w-3.5" /><span>Sales Management</span><ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open && (
        <nav id="sales-nav" aria-label="Sales Management" className="space-y-1">
          {items.map((i) => <NavLink key={i.key} clue={lookupTerm(i.label)?.short} href={i.href} label={i.label} Icon={NAV_ICONS[i.icon]} active={activeKey === i.key} onNavigate={onNavigate} />)}
          {showAi && (
            <div className="mt-2 border-t border-border/50 pt-2">
              <NavLink href={SALES_GLOSSARY_NAV.href} label={SALES_GLOSSARY_NAV.label} Icon={BookOpen} active={activeKey === SALES_GLOSSARY_NAV.key} onNavigate={onNavigate} clue="What every term and label in Sales Management means" />
              <NavLink clue={lookupTerm(SALES_AI_NAV.label)?.short} href={SALES_AI_NAV.href} label={SALES_AI_NAV.label} Icon={AiIcon} active={activeKey === SALES_AI_NAV.key} onNavigate={onNavigate}
                extra={pending.data && pending.data.total > 0 ? <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-500" title="Approvals waiting for a decision">{pending.data.total}</span> : <span className="ml-auto rounded bg-violet-500/15 px-1 text-[9px] font-semibold uppercase text-violet-500">AI</span>} />
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
        {navGroups.slice(0, 1).map((group) => <Group key={group.title} group={group} location={location} onNavigate={onNavigate} />)}
        <SalesGroup location={location} onNavigate={onNavigate} />
        {navGroups.slice(1).map((group) => <Group key={group.title} group={group} location={location} onNavigate={onNavigate} />)}
      </div>
      <div className="px-4 py-4 border-t border-border/50"><button onClick={() => setPreviewOpen(true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors group"><MonitorPlay className="w-4 h-4 text-muted-foreground group-hover:text-foreground"/><span className="text-sm">Preview Site</span><span className="ml-auto text-[9px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-semibold">LIVE</span></button></div>
      <AnimatePresence>{previewOpen && <SitePreview onClose={() => setPreviewOpen(false)} />}</AnimatePresence>
    </>
  );
}

function Group({ group, location, onNavigate }: { group: (typeof navGroups)[number]; location: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">{group.title}</h4>
      <nav className="space-y-1">
        {group.items.map((item) => {
          const active = item.href === "/sentinel-key" ? location === item.href || (location.startsWith("/sentinel-key/") && !/^\/sentinel-key\/(vault|history|aliases)/.test(location)) : location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return <NavLink key={item.name} href={item.href} label={item.name} Icon={item.icon} active={active} onNavigate={onNavigate} extra={item.href === "/diagnostics" ? <Target className="ml-auto w-3 h-3 opacity-70" /> : undefined} />;
        })}
      </nav>
    </div>
  );
}

/** Fixed sidebar on large screens; a slide-in drawer (opened from the top bar) on small screens. */
export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const [location] = useLocation();
  useEffect(() => { onClose?.(); }, [location]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, onClose]);
  return (
    <>
      <aside className="hidden lg:flex w-64 h-screen border-r bg-card flex-col fixed left-0 top-0 z-40">
        <div className="h-16 flex items-center px-6 border-b"><CintexaLogo size={32} showWordmark /></div>
        <SidebarBody />
      </aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r bg-card shadow-xl">
            <div className="h-16 flex items-center justify-between px-6 border-b"><CintexaLogo size={32} showWordmark /><button type="button" aria-label="Close navigation" className="rounded p-1 hover:bg-secondary" onClick={onClose}><X className="h-5 w-5" /></button></div>
            <SidebarBody onNavigate={onClose} />
          </aside>
        </div>
      )}
    </>
  );
}
