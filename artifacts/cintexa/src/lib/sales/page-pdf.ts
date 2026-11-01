/** Exports what the current Sales page is showing (tables, key figures, filters, period) as a branded PDF. Works on every section and tab because it reads the rendered, saved data. */
import { Pdf, NAVY } from "./pdf";

const txt = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
export function exportPagePdf(title: string, root: ParentNode = document): { tables: number; rows: number } {
  const main = (root.querySelector?.("main") ?? root) as ParentNode;
  const pdf = new Pdf(title.toUpperCase(), new Date().toISOString().slice(0, 10), NAVY, "l", "Sales Management");
  const params = [...new URLSearchParams(location.search)].filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, " "), v] as [string, string]);
  const tab = main.querySelector('[role="tab"][aria-selected="true"]'); if (tab) params.unshift(["Section / tab", txt(tab)]);
  const search = main.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"]'); if (search?.value) params.push(["Search", search.value]);
  main.querySelectorAll<HTMLSelectElement>("select").forEach((s) => { const o = s.selectedOptions[0]; if (s.value && o) params.push([(s.getAttribute("aria-label") ?? "Filter").replace(/:.*/, ""), txt(o)]); });
  pdf.heading("Filters & period"); pdf.kv(params.length ? params : [["Filters", "None (all records)"]], 3);
  // key figures
  const kpis = [...main.querySelectorAll("[data-kpi], .kpi")].map((k) => [txt(k)] as string[]).filter((r) => r[0]);
  const figs: [string, string][] = []; main.querySelectorAll("dl").forEach((dl) => dl.querySelectorAll(":scope > div").forEach((d) => { const t = d.querySelector("dt"), v = d.querySelector("dd"); if (t && v) figs.push([txt(t), txt(v)]); }));
  if (figs.length) { pdf.heading("Details"); pdf.kv(figs.slice(0, 60)); }
  void kpis;
  let tables = 0, rows = 0;
  main.querySelectorAll("section, [data-pdf-section], .rounded-lg").forEach(() => undefined);
  main.querySelectorAll("table").forEach((t) => {
    const heads = [...t.querySelectorAll("thead th")].map(txt); const keep = heads.map((h) => h !== "");
    const body = [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map(txt).filter((_, i) => keep[i] ?? true)).filter((r) => r.some(Boolean));
    if (!body.length) return; const cap = t.querySelector("caption"); const panel = t.closest("[class*='rounded']")?.querySelector("h3");
    pdf.heading(cap ? txt(cap) : panel ? txt(panel) : `Table ${tables + 1}`); pdf.table(heads.filter((_, i) => keep[i]), body); tables++; rows += body.length;
  });
  main.querySelectorAll("ul.divide-y").forEach((ul) => { const items = [...ul.querySelectorAll(":scope > li")].map(txt).filter(Boolean); if (!items.length) return; const h = ul.closest("[class*='rounded']")?.querySelector("h3"); pdf.heading(h ? txt(h) : "List"); pdf.bullets(items.slice(0, 200)); rows += items.length; });
  if (!tables && !rows && !figs.length) pdf.text("This page has no records to export for the current filters.", { muted: true });
  pdf.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`);
  return { tables, rows };
}
