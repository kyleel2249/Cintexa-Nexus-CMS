import { useState } from "react";
import { Plus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlParams } from "@/lib/sales/hooks";
import { dateOnly, num } from "@/lib/sales/format";
import { labelOf } from "@/lib/sales/labels";
import { PageHeader, Panel, DataTable, StatusBadge, EmptyState, ErrorState, Skeleton, KpiCard, Drawer, ConfirmModal, DefinitionList, Tag } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";

interface Competitor { id: number; name: string; website: string | null; positioning: string | null; value_proposition: string | null; strengths: string | null; weaknesses: string | null; intel_count: number; opportunities: number }
interface Intel { id: number; kind: string; title: string; content: string; source: string; source_url: string | null; observed_on: string; confidence: string; verified: boolean; verified_by: string | null; created_by: string }

const FIELDS: FieldDef[] = [
  { name: "name", label: "Name", required: true }, { name: "website", label: "Website", type: "url", placeholder: "https://" },
  { name: "positioning", label: "Positioning", type: "textarea", wide: true }, { name: "value_proposition", label: "Value proposition", type: "textarea", wide: true },
  { name: "strengths", label: "Strengths", type: "textarea", wide: true }, { name: "weaknesses", label: "Weaknesses", type: "textarea", wide: true },
];
const KINDS = ["pricing", "product", "positioning", "objection", "observation", "win_loss"].map((value) => ({ value, label: labelOf(value) }));
const CONF = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];

export default function CompetitorsPage() {
  const { can } = useSales();
  const q = useSalesQuery<{ items: Competitor[] }>("/competitors");
  const [params, setParams] = useUrlParams();
  const [creating, setCreating] = useState(false);
  const openId = params.get("id");
  return (
    <>
      <PageHeader title="Competitor intelligence" description="Every item shows who recorded it, its source and confidence, and whether a different person verified it. Unverified items are leads, not facts."
        actions={can("competitors:write") ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New competitor</Button> : undefined} />
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={5} /> : (
          <DataTable caption="Competitors" rows={q.data.items} rowKey={(c) => c.id} onRowClick={(c) => setParams({ id: c.id }, { push: true })} empty={<EmptyState title="No competitors tracked" description="Add competitors, then log sourced intelligence and link them to opportunities." />}
            columns={[{ key: "n", header: "Competitor", render: (c: Competitor) => <div><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground line-clamp-1">{c.positioning}</p></div> },
              { key: "i", header: "Intel items", align: "right", render: (c: Competitor) => num(c.intel_count) }, { key: "o", header: "Seen in deals", align: "right", hideOnMobile: true, render: (c: Competitor) => num(c.opportunities) }]} />
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New competitor" size="lg" success="Competitor added" invalidate={["/competitors"]} fields={FIELDS} submit={(b) => sales.post("/competitors", b, { idempotent: true })} />
      {openId && <CompetitorDrawer id={Number(openId)} onClose={() => setParams({ id: null }, { push: true })} />}
    </>
  );
}

function CompetitorDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useSales();
  const q = useSalesQuery<{ competitor: Competitor; intel: Intel[]; record: { present: number; won_against: number; lost_to: number }; note: string }>(`/competitors/${id}`);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delIntel, setDelIntel] = useState<Intel | null>(null);
  const verify = useSalesMutation((i: Intel) => sales.post(`/competitor-intel/${i.id}/verify`), { invalidate: [`/competitors`], success: "Verified" });
  const removeIntel = useSalesMutation((i: Intel) => sales.del(`/competitor-intel/${i.id}`), { invalidate: [`/competitors`], success: "Removed", onSuccess: () => setDelIntel(null) });
  const remove = useSalesMutation(() => sales.del(`/competitors/${id}`), { invalidate: ["/competitors"], success: "Competitor removed", onSuccess: onClose });
  const c = q.data?.competitor;
  const write = can("competitors:write");
  return (
    <Drawer open onClose={onClose} title={c?.name ?? "Competitor"} subtitle={c?.website ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={c.website} target="_blank" rel="noopener noreferrer">{c.website}<ExternalLink className="h-3 w-3" /></a> : undefined}>
      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data || !c ? <Skeleton rows={6} /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3"><KpiCard label="Present in deals" value={num(q.data.record.present)} /><KpiCard label="Won against" value={num(q.data.record.won_against)} /><KpiCard label="Lost to" value={num(q.data.record.lost_to)} /></div>
          <DefinitionList items={[{ label: "Positioning", value: c.positioning ?? "—" }, { label: "Value proposition", value: c.value_proposition ?? "—" }, { label: "Strengths", value: c.strengths ?? "—" }, { label: "Weaknesses", value: c.weaknesses ?? "—" }]} />
          {write && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button><Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDeleting(true)}>Remove</Button></div>}
          <Panel title="Intelligence" description={q.data.note} actions={write ? <Button size="sm" onClick={() => setAdding(true)}>Add intel</Button> : undefined}>
            {q.data.intel.length === 0 ? <EmptyState title="No intelligence yet" description="Record sourced observations: pricing changes, launches, win/loss feedback." /> : (
              <ul className="space-y-3">
                {q.data.intel.map((i) => (
                  <li key={i.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{i.title}</p><Tag>{labelOf(i.kind)}</Tag><StatusBadge status={i.verified ? "verified" : "unverified"} label={i.verified ? `Verified by ${i.verified_by}` : "Unverified"} tone={i.verified ? "success" : "warning"} /></div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{i.content}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Source: {i.source_url ? <a className="text-primary hover:underline" href={i.source_url} target="_blank" rel="noopener noreferrer">{i.source}</a> : i.source} · observed {dateOnly(i.observed_on)} · {i.confidence} confidence · recorded by {i.created_by}</p>
                    <div className="mt-2 flex gap-2">
                      {can("competitors:verify") && !i.verified && <Button size="sm" variant="outline" disabled={verify.pending} onClick={() => void verify.run(i)}>Verify</Button>}
                      {write && <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDelIntel(i)}>Remove</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {verify.error && <p role="alert" className="mt-2 text-sm text-rose-500">{verify.error.message}</p>}
          </Panel>
        </div>
      )}
      {editing && c && <FormModal open size="lg" onClose={() => setEditing(false)} title="Edit competitor" initial={c} nullEmpty success="Saved" invalidate={["/competitors"]} fields={FIELDS} submit={(b) => sales.patch(`/competitors/${id}`, b)} />}
      <FormModal open={adding} onClose={() => setAdding(false)} size="lg" title="Add intelligence" description="Record where it came from. It stays unverified until a different person confirms it." success="Intel recorded (unverified)" invalidate={["/competitors"]} initial={{ kind: "pricing", confidence: "low" }}
        fields={[{ name: "kind", label: "Kind", type: "select", options: KINDS, required: true }, { name: "confidence", label: "Confidence", type: "select", options: CONF, required: true }, { name: "title", label: "Title", required: true, wide: true }, { name: "content", label: "Details", type: "textarea", required: true, wide: true }, { name: "source", label: "Source", required: true, hint: "e.g. Customer call, public pricing page" }, { name: "source_url", label: "Source URL", type: "url" }, { name: "observed_on", label: "Observed on", type: "date", required: true }]}
        submit={(b) => sales.post(`/competitors/${id}/intel`, b, { idempotent: true })} />
      <ConfirmModal open={!!delIntel} onClose={() => setDelIntel(null)} title="Remove item?" message="It is archived and no longer shown." confirmLabel="Remove" danger pending={removeIntel.pending} onConfirm={() => delIntel && void removeIntel.run(delIntel)} />
      <ConfirmModal open={deleting} onClose={() => setDeleting(false)} title="Remove competitor?" message="Existing opportunity links are kept for history." confirmLabel="Remove" danger pending={remove.pending} onConfirm={() => void remove.run()} />
    </Drawer>
  );
}
