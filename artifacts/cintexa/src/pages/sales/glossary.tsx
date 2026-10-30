import { useMemo, useState } from "react";
import { PageHeader, Panel, SearchBox, EmptyState } from "@/components/sales/ui";
import { GLOSSARY, CATEGORIES, norm } from "@/lib/sales/glossary";

/** Searchable list of every term used in Sales Management, with plain-language meanings. */
export default function Glossary() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const rows = useMemo(() => {
    const n = norm(q);
    return GLOSSARY.filter((e) => (cat === "all" || e.category === cat) && (!n || norm(e.term).includes(n) || norm(e.short).includes(n) || (e.aliases ?? []).some((a) => norm(a).includes(n))));
  }, [q, cat]);
  return (
    <>
      <PageHeader title="Glossary & Help" description="What every word and label in Sales Management means. On any screen, look for the (i) icon or a dotted underline - hover, tap or tab to it for a short explanation." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1"><SearchBox value={q} onChange={setQ} placeholder="Search terms, e.g. weighted pipeline" /></div>
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="all">All categories ({GLOSSARY.length})</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c} ({GLOSSARY.filter((e) => e.category === c).length})</option>)}
        </select>
      </div>
      {rows.length === 0 ? <EmptyState title="No matching term" description="Try a shorter word." /> : (
        <Panel flush>
          <dl className="divide-y">
            {rows.map((e) => (
              <div key={e.category + e.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr]">
                <dt className="text-sm font-medium">{e.term}<span className="ml-2 text-[11px] font-normal text-muted-foreground">{e.category}</span></dt>
                <dd className="text-sm text-muted-foreground">{e.short}{e.more && <span className="mt-1 block text-xs">{e.more}</span>}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
    </>
  );
}
