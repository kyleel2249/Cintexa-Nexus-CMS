/**
 * CINTEXA CCDI — application shell (Phase 2 foundation).
 *
 * Routes (all under /ccdi): "" Command Centre, users, integrations, settings are implemented.
 * Every other navigation item is a clearly labelled, non-operational placeholder for a later phase.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity, Bug, Building2, Cloud, Database, FileBarChart, Fingerprint, Globe, Network, Plug, Radar,
  ScanSearch, Server, Settings as SettingsIcon, Shield, ShieldAlert, Siren, Smartphone, Swords, Users, Bot,
  ClipboardCheck, Cpu, Code, Menu, type LucideIcon,
} from "lucide-react";
import CommandCentre from "./command-centre";
import { OrgProvider, Loading, Notice, selectClass, useOrg } from "./foundation/client";

const UsersAccess = lazy(() => import("./foundation/users-access"));
const Integrations = lazy(() => import("./foundation/integrations"));
const Settings = lazy(() => import("./foundation/settings"));

type NavItem = { slug: string; label: string; icon: LucideIcon; implemented: boolean };

const NAV: NavItem[] = [
  { slug: "", label: "Command Centre", icon: Radar, implemented: true },
  { slug: "assets", label: "Assets", icon: Server, implemented: false },
  { slug: "attack-surface", label: "Attack Surface", icon: Globe, implemented: false },
  { slug: "vulnerabilities", label: "Vulnerability Management", icon: Bug, implemented: false },
  { slug: "penetration-testing", label: "Penetration Testing", icon: Swords, implemented: false },
  { slug: "website-security", label: "Website Security", icon: ScanSearch, implemented: false },
  { slug: "network-security", label: "Network Security", icon: Network, implemented: false },
  { slug: "api-security", label: "API Security", icon: Code, implemented: false },
  { slug: "cloud-security", label: "Cloud Security", icon: Cloud, implemented: false },
  { slug: "mobile-security", label: "Mobile Security", icon: Smartphone, implemented: false },
  { slug: "database-security", label: "Database Security", icon: Database, implemented: false },
  { slug: "iot-security", label: "IoT and Industrial Security", icon: Cpu, implemented: false },
  { slug: "siem", label: "SIEM and Monitoring", icon: Activity, implemented: false },
  { slug: "threat-intelligence", label: "Threat Intelligence", icon: ShieldAlert, implemented: false },
  { slug: "incident-response", label: "Incident Response", icon: Siren, implemented: false },
  { slug: "forensics", label: "Digital Forensics", icon: Fingerprint, implemented: false },
  { slug: "compliance", label: "Compliance", icon: ClipboardCheck, implemented: false },
  { slug: "ai-agents", label: "AI Agents", icon: Bot, implemented: false },
  { slug: "reports", label: "Reports and Analytics", icon: FileBarChart, implemented: false },
  { slug: "integrations", label: "Integrations", icon: Plug, implemented: true },
  { slug: "users", label: "Users and Access", icon: Users, implemented: true },
  { slug: "settings", label: "Settings", icon: SettingsIcon, implemented: true },
];

function sectionOf(location: string): string {
  const rest = location.replace(/^\/ccdi\/?/, "").split("/")[0] ?? "";
  return rest;
}

function OrgSelector() {
  const { orgs, orgId, setOrgId, loading } = useOrg();
  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
      <label htmlFor="org-select" className="sr-only">Organisation</label>
      <select
        id="org-select"
        className={`${selectClass} max-w-56`}
        value={orgId ?? ""}
        disabled={loading || orgs.length === 0}
        onChange={(e) => setOrgId(e.target.value || null)}
      >
        {orgs.length === 0 && <option value="">{loading ? "Loading…" : "No organisations"}</option>}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}

function AccessBanner() {
  const { accessMode } = useOrg();
  if (accessMode !== "open") return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100" role="status">
      <strong>Open-access mode.</strong> Sign-in is disabled and permissions are not enforced. Administrative changes are still written to the audit log. Set <code>CCDI_ACCESS_MODE=enforced</code> on the API server to require sign-in and role permissions.
    </div>
  );
}

function ComingLater({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-14 text-center">
      <Icon className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-xl font-semibold">{item.label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This module is not available yet. The permissions, data structures and navigation for it are reserved, and it will be built in a later phase.
      </p>
    </div>
  );
}

function Body({ section }: { section: string }) {
  const item = NAV.find((n) => n.slug === section);
  if (!item) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h2 className="text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">There is no CCDI page at this address.</p>
        <Link href="/ccdi" className="mt-4 inline-block underline underline-offset-2">Back to the Command Centre</Link>
      </div>
    );
  }
  if (!item.implemented) return <ComingLater item={item} />;
  let content: ReactNode;
  switch (section) {
    case "": content = <CommandCentre />; break;
    case "users": content = <UsersAccess />; break;
    case "integrations": content = <Integrations />; break;
    default: content = <Settings />;
  }
  return (
    <Suspense fallback={<Loading />}>
      {section !== "" && <h1 className="mb-4 text-2xl font-semibold tracking-tight">{item.label}</h1>}
      {content}
    </Suspense>
  );
}

function Shell() {
  const [location] = useLocation();
  const section = sectionOf(location);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <AccessBanner />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-slate-950 px-4 py-2.5">
        <div className="flex items-center gap-2 text-slate-100">
          <Shield className="h-5 w-5 text-cyan-400" aria-hidden />
          <span className="font-semibold tracking-tight">CINTEXA <span className="text-primary">CCDI</span></span>
        </div>
        <OrgSelector />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav aria-label="CCDI modules" className="shrink-0 border-b border-border/60 bg-slate-950/60 lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <details className="group lg:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
              <Menu className="h-4 w-4" aria-hidden /> Modules
            </summary>
            <NavList section={section} />
          </details>
          <div className="hidden lg:block"><NavList section={section} /></div>
        </nav>

        <main className="min-w-0 flex-1 overflow-auto">
          {section === "" ? (
            <Body section="" />
          ) : (
            <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
              {section !== "" && NAV.find((n) => n.slug === section)?.implemented === false && (
                <Notice kind="info">Navigation preview. This module is not operational in the current phase.</Notice>
              )}
              <Body section={section} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function NavList({ section }: { section: string }) {
  return (
    <ul className="space-y-0.5 p-2">
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = n.slug === section;
        return (
          <li key={n.slug || "home"}>
            <Link
              href={n.slug ? `/ccdi/${n.slug}` : "/ccdi"}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                active ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
              {!n.implemented && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">soon</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function CcdiApp() {
  return (
    <OrgProvider>
      <Shell />
    </OrgProvider>
  );
}
