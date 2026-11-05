export const CSI_NAV = [
  { key: "overview", label: "Executive Overview", href: "/corporate-strategy", section: "Overview" },
  { key: "profile", label: "Corporate Profile", href: "/corporate-strategy/profile", section: "Strategy" },
  { key: "objectives", label: "Strategic Objectives", href: "/corporate-strategy/objectives", section: "Strategy" },
  { key: "departments", label: "Departments", href: "/corporate-strategy/departments", section: "Organisation" },
  { key: "products", label: "Product Portfolio", href: "/corporate-strategy/products", section: "Products" },
  { key: "pricing", label: "Pricing", href: "/corporate-strategy/pricing", section: "Products" },
  { key: "budgets", label: "Budgets", href: "/corporate-strategy/budgets", section: "Finance planning" },
  { key: "allocation", label: "Resource Allocation", href: "/corporate-strategy/allocation", section: "Finance planning" },
  { key: "forecast", label: "Forecasts", href: "/corporate-strategy/forecast", section: "Finance planning" },
  { key: "risks", label: "Risk Register", href: "/corporate-strategy/risks", section: "Governance" },
  { key: "roadmap", label: "Ten-Year Roadmap", href: "/corporate-strategy/roadmap", section: "Governance" },
] as const;

export function activeCsiKey(path: string): string {
  const p = path.split("?")[0]!.replace(/\/$/, "");
  const hit = [...CSI_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => (i.href === "/corporate-strategy" ? p === "/corporate-strategy" : p === i.href || p.startsWith(i.href + "/")));
  return hit?.key ?? "";
}
