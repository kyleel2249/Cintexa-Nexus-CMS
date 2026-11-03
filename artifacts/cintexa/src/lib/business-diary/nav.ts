export interface BdNavItem {
  key: string;
  label: string;
  href: string;
  section: string;
}

export const BD_NAV: BdNavItem[] = [
  { key: "overview", label: "Dashboard", href: "/business-diary", section: "Overview" },
  { key: "email", label: "Email-to-Diary", href: "/business-diary/email-to-diary", section: "Overview" },
  { key: "entries", label: "Diary entries", href: "/business-diary/entries", section: "Records" },
  { key: "pitches", label: "Sales pitches", href: "/business-diary/pitches", section: "Records" },
  { key: "feedback", label: "Customer feedback", href: "/business-diary/feedback", section: "Records" },
  { key: "followups", label: "Follow-ups", href: "/business-diary/follow-ups", section: "Records" },
  { key: "decisions", label: "Decisions", href: "/business-diary/decisions", section: "Governance" },
  { key: "cases", label: "Case studies", href: "/business-diary/case-studies", section: "Knowledge" },
  { key: "insights", label: "Intelligence", href: "/business-diary/insights", section: "Intelligence" },
];

export function activeBdKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...BD_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => (i.href === "/business-diary" ? p === "/business-diary" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
