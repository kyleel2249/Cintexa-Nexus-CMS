import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useDebounced, useSalesMutation, useSalesQuery, useUrlFilter, useUrlParams } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, TOUCH_CHANNELS } from "@/lib/sales/enums";
import { dateOnly, money, num, percent } from "@/lib/sales/format";
import { labelOf } from "@/lib/sales/labels";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Panel, TabBar, FilterBar, SearchBox, Select, Input, Checkbox, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, KpiCard, Drawer, Modal, ConfirmModal, DefinitionList, Tag } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";

interface Campaign { id: number; name: string; owner_name: string | null; owner_id: number | null; objective: string | null; channel: string; status: string; budget: string | null; spend: string | null; currency: string; starts_on: string | null; ends_on: string | null; target_segment: string | null; utm_campaign: string | null; members: number; leads: number; opportunities: number }
type Tab = "campaigns" | "attribution";

const CAMPAIGN_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", required: true, wide: true }, { name: "channel", label: "Channel", type: "select", options: CAMPAIGN_CHANNELS, required: true }, { name: "utm_campaign", label: "UTM campaign tag", hint: "Letters, digits, dot, dash, underscore. Used to attribute leads." },
  { name: "budget", label: "Budget", type: "money" }, { name: "spend", label: "Spend to date", type: "money", hint: "Cost and ROI are only shown once spend is entered." }, { name: "starts_on", label: "Starts", type: "date" }, { name: "ends_on", label: "Ends", type: "date" },
  { name: "target_segment", label: "Target segment", wide: true }, { name: "objective", label: "Objective", type: "textarea", wide: true },
];

export default function CampaignsPage() {
  const { can } = useSales();
  const [tabRaw, setTab] = useUrlFilter("tab", "campaigns");
  const tab: Tab = tabRaw === "attribution" ? "attribution" : "campaigns";
  return (
    <>
      <PageHeader title="Sales campaigns" description="Attribution only credits revenue when recorded touches exist; anything else is reported as unattributed rather than guessed." />
      <TabBar<Tab> tabs={[{ key: "campaigns", label: "Campaigns" }, { key: "attribution", label: "Attribution" }]} value={tab} onChange={setTab} />
      {tab === "attribution" ? <Attribution /> : <CampaignList canWrite={can("campaigns:write")} />}
    </>
  );
}

function CampaignList({ canWrite }: { canWrite: boolean }) {
  const st = useListState(["status", "channel"]);
  const q = useList<Campaign>("/campaigns", st);
  const [params, setParams] = useUrlParams();
  const [creating, setCreating] = useState(false);
  const openId = params.get("id");
  return (
    <>
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search campaigns…" />
        <Select aria-label="Status" className="w-40" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{CAMPAIGN_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <Select aria-label="Channel" className="w-40" value={st.filters.channel ?? ""} onChange={(e) => st.setFilter("channel", e.target.value)}><option value="">Channel: all</option>{CAMPAIGN_CHANNELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New campaign</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={6} /> : (
          <><DataTable caption="Campaigns" rows={q.data.items} rowKey={(c) => c.id} onRowClick={(c) => setParams({ id: c.id }, { push: true })} empty={<EmptyState title={st.hasFilters ? "No campaigns match" : "No campaigns yet"} description="Create a campaign, add leads or accounts, and tag leads with its UTM value." />}
            columns={[{ key: "n", header: "Campaign", render: (c: Campaign) => <div><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.owner_name}</p></div> },
              { key: "c", header: "Channel", hideOnMobile: true, render: (c: Campaign) => labelOf(c.channel) }, { key: "s", header: "Status", render: (c: Campaign) => <StatusBadge status={c.status} /> },
              { key: "m", header: "Members", align: "right", hideOnMobile: true, render: (c: Campaign) => num(c.members) }, { key: "l", header: "Leads", align: "right", render: (c: Campaign) => num(c.leads) }, { key: "o", header: "Opps", align: "right", hideOnMobile: true, render: (c: Campaign) => num(c.opportunities) },
              { key: "b", header: "Budget", align: "right", hideOnMobile: true, render: (c: Campaign) => (c.budget ? money(c.budget, c.currency) : "—") }]} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New campaign" size="lg" success="Campaign created" invalidate={["/campaigns"]} fields={CAMPAIGN_FIELDS} initial={{ channel: "email" }} submit={(b) => sales.post("/campaigns", b, { idempotent: true })} />
      {openId && <CampaignDrawer id={Number(openId)} onClose={() => setParams({ id: null }, { push: true })} />}
    </>
  );
}

interface Detail { campaign: Campaign; stats: { members: number; sent: number; responded: number; converted: number; unsubscribed: number }; funnel: { leads: number; opportunities: number; won: number; won_amount: string }; attributedRevenue: string; attributionModel: string; spend: string | null; costPerLead: string | null; roiPercent: number | null; note?: string }
interface CMember { id: number; status: string; lead_id: number | null; account_id: number | null; first_name: string | null; last_name: string | null; lead_company: string | null; account_name: string | null }
const TRANSITIONS: Record<string, string[]> = { planned: ["active", "cancelled"], active: ["paused", "completed", "cancelled"], paused: ["active", "completed", "cancelled"], completed: [], cancelled: [] };

function CampaignDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { can, me } = useSales();
  const { toast } = useToast();
  const q = useSalesQuery<Detail>(`/campaigns/${id}`);
  const members = useSalesQuery<{ items: CMember[] }>(`/campaigns/${id}/members`);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [mailing, setMailing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [touch, setTouch] = useState<CMember | null>(null);
  const write = can("campaigns:write");
  const setStatus = useSalesMutation((status: string) => sales.patch(`/campaigns/${id}`, { status }), { invalidate: ["/campaigns"], success: "Status updated" });
  const memberStatus = useSalesMutation((a: { id: number; status: string }) => sales.post(`/campaigns/members/${a.id}/status`, { status: a.status }), { invalidate: [`/campaigns/${id}`], success: "Updated" });
  const remove = useSalesMutation(() => sales.del(`/campaigns/${id}`), { invalidate: ["/campaigns"], success: "Campaign deleted", onSuccess: onClose });
  const c = q.data?.campaign;
  return (
    <Drawer open onClose={onClose} title={c?.name ?? "Campaign"} subtitle={c ? <StatusBadge status={c.status} /> : undefined}>
      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data || !c ? <Skeleton rows={6} /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Leads" value={num(q.data.funnel.leads)} /><KpiCard label="Opportunities" value={num(q.data.funnel.opportunities)} />
            <KpiCard label="Won" value={num(q.data.funnel.won)} hint={money(q.data.funnel.won_amount, c.currency)} /><KpiCard label="Attributed revenue" value={money(q.data.attributedRevenue, c.currency)} hint={`${labelOf(q.data.attributionModel)} model`} />
            <KpiCard label="Spend" value={q.data.spend ? money(q.data.spend, c.currency) : "—"} unavailable={q.data.spend ? undefined : "Not entered"} />
            <KpiCard label="Cost per lead" value={q.data.costPerLead ? money(q.data.costPerLead, c.currency) : "—"} unavailable={q.data.costPerLead ? undefined : "Needs spend and leads"} />
            <KpiCard label="ROI" value={q.data.roiPercent === null ? "—" : `${num(q.data.roiPercent, 1)}%`} unavailable={q.data.roiPercent === null ? "Needs spend" : undefined} />
            <KpiCard label="Responded" value={num(q.data.stats.responded)} hint={`${num(q.data.stats.converted)} converted`} />
          </div>
          {q.data.note && <p className="text-sm text-muted-foreground">{q.data.note}</p>}
          <DefinitionList items={[{ label: "Channel", value: labelOf(c.channel) }, { label: "Owner", value: c.owner_name ?? "—" }, { label: "Dates", value: `${c.starts_on ? dateOnly(c.starts_on) : "—"} → ${c.ends_on ? dateOnly(c.ends_on) : "—"}` }, { label: "UTM tag", value: c.utm_campaign ?? "—" }, { label: "Segment", value: c.target_segment ?? "—" }, { label: "Objective", value: c.objective ?? "—" }]} />
          {write && <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
            {(TRANSITIONS[c.status] ?? []).map((s) => <Button key={s} size="sm" variant="outline" disabled={setStatus.pending} onClick={() => void setStatus.run(s)}>Mark {s}</Button>)}
            <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDeleting(true)}>Delete</Button>
          </div>}
          <Panel title="Members" actions={<span className="flex gap-2">{write && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add members</Button>}{can("campaigns:send") && <Button size="sm" onClick={() => setMailing(true)} disabled={!me?.features.emailEnabled} title={me?.features.emailEnabled ? undefined : "Connect an email provider in Sales Settings first"}>Send email</Button>}</span>} flush>
            {!members.data ? <Skeleton /> : (
              <DataTable caption="Campaign members" rows={members.data.items} rowKey={(m) => m.id} empty={<EmptyState title="No members" description="Add leads or accounts to target." />}
                columns={[{ key: "n", header: "Member", render: (m: CMember) => m.lead_id ? <span>{[m.first_name, m.last_name].filter(Boolean).join(" ")} <span className="text-xs text-muted-foreground">{m.lead_company}</span></span> : <span>{m.account_name} <Tag>Account</Tag></span> },
                  { key: "s", header: "Status", render: (m: CMember) => <StatusBadge status={m.status} /> },
                  { key: "x", header: "", render: (m: CMember) => write ? <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setTouch(m)}>Touch</Button>{m.status !== "converted" && <Select aria-label="Set status" value="" onChange={(e) => e.target.value && void memberStatus.run({ id: m.id, status: e.target.value })}><option value="">Mark…</option><option value="responded">Responded</option><option value="converted">Converted</option><option value="unsubscribed">Unsubscribed</option></Select>}</span> : null }]} />
            )}
          </Panel>
        </div>
      )}
      {editing && c && <FormModal open size="lg" onClose={() => setEditing(false)} title="Edit campaign" initial={c} nullEmpty success="Campaign saved" invalidate={["/campaigns"]} fields={CAMPAIGN_FIELDS} submit={(b) => sales.patch(`/campaigns/${id}`, b)} />}
      {adding && <AddMembers id={id} onClose={() => setAdding(false)} />}
      {mailing && <FormModal open size="lg" onClose={() => setMailing(false)} title="Send campaign email" description="Only targeted lead members with recorded email consent are queued. Members show as sent after the provider confirms delivery." submitLabel="Queue emails" success="Emails queued" invalidate={[`/campaigns/${id}`]}
        fields={[{ name: "subject", label: "Subject", required: true, wide: true }, { name: "message", label: "Message", type: "textarea", rows: 8, required: true, wide: true }]} submit={(b) => sales.post(`/campaigns/${id}/send-email`, b, { idempotent: true })}
        onDone={(r) => { const x = r as { queued: number; skippedNoConsent: number; skippedNoEmail: number }; if (x) toast({ title: `Queued ${x.queued} email(s)`, description: `Skipped ${x.skippedNoConsent} without consent and ${x.skippedNoEmail} without an address.` }); }} />}
      {touch && <FormModal open onClose={() => setTouch(null)} title="Record touch" description="Touches drive multi-touch attribution." success="Touch recorded" invalidate={[`/campaigns/${id}`, "/campaigns/attribution"]} initial={{ kind: "email" }}
        fields={[{ name: "kind", label: "Kind", type: "select", options: TOUCH_CHANNELS, required: true }, { name: "at", label: "When", type: "datetime" }]} submit={(b) => sales.post(`/campaigns/${id}/touches`, { ...b, ...(touch.lead_id ? { lead_id: touch.lead_id } : { account_id: touch.account_id }) })} />}
      <ConfirmModal open={deleting} onClose={() => setDeleting(false)} title="Delete campaign?" message="Membership and touches are removed; leads keep their data." confirmLabel="Delete" danger pending={remove.pending} onConfirm={() => void remove.run()} />
    </Drawer>
  );
}

function AddMembers({ id, onClose }: { id: number; onClose: () => void }) {
  const [text, setText] = useState("");
  const term = useDebounced(text, 250);
  const q = useSalesQuery<{ items: { id: number; first_name: string; last_name: string | null; company: string | null; email: string | null }[] }>("/leads", { q: term || undefined, pageSize: 20 });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const add = useSalesMutation(() => sales.post(`/campaigns/${id}/members`, { lead_ids: [...sel] }), { invalidate: [`/campaigns`], success: (r: { added: number; skipped: number }) => `Added ${r.added}${r.skipped ? `, skipped ${r.skipped} (already members or not visible to you)` : ""}`, onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Add leads to campaign" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!sel.size || add.pending} onClick={() => void add.run()}>Add {sel.size || ""} selected</Button></>}>
      <Input aria-label="Search leads" placeholder="Search leads…" value={text} onChange={(e) => setText(e.target.value)} />
      <ul className="mt-3 max-h-80 space-y-1 overflow-auto">
        {q.loading && !q.data && <li className="text-sm text-muted-foreground">Loading…</li>}
        {q.data?.items.length === 0 && <li className="text-sm text-muted-foreground">No leads found.</li>}
        {q.data?.items.map((l) => <li key={l.id}><Checkbox label={<span>{l.first_name} {l.last_name} <span className="text-xs text-muted-foreground">{l.company} {l.email}</span></span>} checked={sel.has(l.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} /></li>)}
      </ul>
      {add.error && <p role="alert" className="mt-2 text-sm text-rose-500">{add.error.message}</p>}
    </Modal>
  );
}

interface Attr { model: string; windowDays: number; rows: { campaign_id: number; name: string; revenue: string; spend: string | null; roiPercent: number | null; deals?: number }[]; unattributed: string; unattributedDeals: number; dealsConsidered: number; note: string }

function Attribution() {
  const q = useSalesQuery<Attr>("/campaigns/attribution");
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton rows={5} />;
  const d = q.data;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Model" value={labelOf(d.model)} hint={`${d.windowDays}-day window`} /><KpiCard label="Deals considered" value={num(d.dealsConsidered)} />
        <KpiCard label="Unattributed deals" value={num(d.unattributedDeals)} /><KpiCard label="Unattributed revenue" value={money(d.unattributed)} />
      </div>
      <Panel flush>
        <DataTable caption="Attributed revenue by campaign" rows={d.rows} rowKey={(r) => r.campaign_id} empty={<EmptyState title="Nothing attributed yet" description="Record touches on campaign members, or tag leads with a campaign UTM, before won deals can be credited." />}
          columns={[{ key: "n", header: "Campaign", render: (r: Attr["rows"][number]) => r.name }, { key: "r", header: "Revenue", align: "right", render: (r: Attr["rows"][number]) => money(r.revenue) }, { key: "s", header: "Spend", align: "right", hideOnMobile: true, render: (r: Attr["rows"][number]) => (r.spend ? money(r.spend) : "—") }, { key: "i", header: "ROI", align: "right", render: (r: Attr["rows"][number]) => (r.roiPercent === null ? "—" : percent(r.roiPercent)) }]} />
      </Panel>
      <p className="mt-3 text-sm text-muted-foreground">{d.note}</p>
    </>
  );
}
