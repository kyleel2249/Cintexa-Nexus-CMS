import { useState } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { dateOnly, money, num, relative } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, Select, Field, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, KpiCard, Modal, Tag } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { AccountPicker } from "@/components/sales/pickers";
import { Donut } from "@/components/sales/charts";

type Tab = "health" | "feedback" | "renewals" | "referrals" | "plans";

/** FormModal with an account picker: the picked account id is merged into the body. */
function AccountFormModal({ onClose, title, fields, initial, submit, success, invalidate, description }: { onClose: () => void; title: string; fields: FieldDef[]; initial?: Record<string, unknown>; submit: (body: Record<string, unknown>) => Promise<unknown>; success: string; invalidate: string[]; description?: string }) {
  const [acc, setAcc] = useState({ id: "", name: "" });
  return (
    <FormModal open onClose={onClose} title={title} description={description} fields={fields} initial={initial} success={success} invalidate={invalidate}
      extra={<Field label="Account" required><AccountPicker value={acc.id} onChange={(id, name) => setAcc({ id, name })} /></Field>}
      submit={async (b) => { if (!acc.id) throw new Error("Choose an account"); return submit({ ...b, account_id: Number(acc.id) }); }} />
  );
}

export default function RetentionPage() {
  const [tabRaw, setTab] = useUrlFilter("tab", "health");
  const tabs: { key: Tab; label: string }[] = [{ key: "health", label: "Account health" }, { key: "feedback", label: "Feedback & complaints" }, { key: "renewals", label: "Renewals" }, { key: "referrals", label: "Referrals" }, { key: "plans", label: "Account plans" }];
  const tab = (tabs.some((t) => t.key === tabRaw) ? tabRaw : "health") as Tab;
  return (
    <>
      <PageHeader title="Customer retention" description="Health is derived only from recorded orders, complaints and activities. Accounts without history show as unknown rather than being guessed." />
      <TabBar<Tab> tabs={tabs} value={tab} onChange={setTab} />
      {tab === "feedback" ? <FeedbackTab /> : tab === "renewals" ? <RenewalsTab /> : tab === "referrals" ? <ReferralsTab /> : tab === "plans" ? <PlansTab /> : <HealthTab />}
    </>
  );
}

const BAND_LABEL: Record<string, string> = { healthy: "Healthy", watch: "Watch", at_risk: "At risk", churned: "Churned", unknown: "Unknown" };

function HealthTab() {
  const [, nav] = useLocation();
  const q = useSalesQuery<{ bands: Record<string, number>; assessed: number; capped: boolean; atRisk: { account_id: number; name: string; score: number; reasons: string[] }[]; openComplaints: number; renewalsNext90Days: { n: number; amount: string }; note: string }>("/retention/overview");
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton rows={6} />;
  const d = q.data;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Accounts assessed" value={num(d.assessed)} hint={d.capped ? "First 500 shown" : undefined} />
        <KpiCard label="At risk" value={num(d.bands.at_risk ?? 0)} tone={d.bands.at_risk ? "danger" : undefined} />
        <KpiCard label="Open complaints" value={num(d.openComplaints)} tone={d.openComplaints ? "warning" : undefined} />
        <KpiCard label="Renewals in 90 days" value={num(d.renewalsNext90Days.n)} hint={money(d.renewalsNext90Days.amount)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Health bands">
          {d.assessed === 0 ? <EmptyState title="No accounts to assess" /> : <Donut slices={Object.entries(d.bands).filter(([, n]) => n > 0).map(([k, n]) => ({ label: BAND_LABEL[k] ?? k, value: n }))} />}
          <p className="mt-3 text-xs text-muted-foreground">{d.note}</p>
        </Panel>
        <Panel title="Accounts at risk" flush>
          <DataTable caption="Accounts at risk" rows={d.atRisk} rowKey={(a) => a.account_id} onRowClick={(a) => nav(`/sales/accounts/${a.account_id}`)} empty={<EmptyState title="No accounts at risk" description="Nothing in the recorded history indicates churn risk." />}
            columns={[{ key: "n", header: "Account", render: (a: { name: string }) => a.name }, { key: "s", header: "Score", align: "right", render: (a: { score: number }) => num(a.score) }, { key: "r", header: "Why", render: (a: { reasons: string[] }) => <span className="text-sm text-muted-foreground">{a.reasons.join("; ")}</span> }]} />
        </Panel>
      </div>
    </>
  );
}

interface Feedback { id: number; account_id: number; account_name: string; kind: string; rating: number | null; subject: string; body: string | null; status: string; resolution: string | null; created_at: string }
const FB_KINDS = [{ value: "survey", label: "Survey" }, { value: "complaint", label: "Complaint" }, { value: "feedback", label: "Feedback" }, { value: "service_request", label: "Service request" }];
const FB_STATUS = [{ value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }];

function FeedbackTab() {
  const { can } = useSales();
  const st = useListState(["kind", "status"]);
  const q = useList<Feedback>("/feedback", st);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Feedback | null>(null);
  const write = can("retention:write");
  return (
    <>
      <FilterBar>
        <Select aria-label="Kind" className="w-44" value={st.filters.kind ?? ""} onChange={(e) => st.setFilter("kind", e.target.value)}><option value="">Kind: all</option>{FB_KINDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <Select aria-label="Status" className="w-40" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{FB_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        {write && <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Record feedback</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={6} /> : (
          <><DataTable caption="Feedback" rows={q.data.items} rowKey={(f) => f.id} onRowClick={write ? (f) => setEdit(f) : undefined} empty={<EmptyState title="No feedback recorded" description="Record surveys, complaints and service requests against an account." />}
            columns={[{ key: "s", header: "Subject", render: (f: Feedback) => <div><p className="font-medium">{f.subject}</p><p className="text-xs text-muted-foreground">{f.account_name}</p></div> },
              { key: "k", header: "Kind", render: (f: Feedback) => <Tag>{FB_KINDS.find((k) => k.value === f.kind)?.label ?? f.kind}</Tag> }, { key: "r", header: "Rating", hideOnMobile: true, align: "right", render: (f: Feedback) => (f.rating ? `${f.rating}/10` : "—") },
              { key: "t", header: "Status", render: (f: Feedback) => <StatusBadge status={f.status} /> }, { key: "d", header: "Received", hideOnMobile: true, render: (f: Feedback) => relative(f.created_at) }]} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      {creating && <AccountFormModal onClose={() => setCreating(false)} title="Record feedback" success="Feedback recorded" invalidate={["/feedback", "/retention"]}
        fields={[{ name: "kind", label: "Kind", type: "select", options: FB_KINDS, required: true }, { name: "rating", label: "Rating (1–10)", type: "number", min: 1, max: 10, hint: "Required for surveys." }, { name: "subject", label: "Subject", required: true, wide: true }, { name: "body", label: "Details", type: "textarea", wide: true }]}
        submit={(b) => sales.post("/feedback", b, { idempotent: true })} />}
      {edit && <FormModal open onClose={() => setEdit(null)} title={edit.subject} description={edit.body ?? undefined} initial={edit} success="Feedback updated" invalidate={["/feedback", "/retention"]}
        fields={[{ name: "status", label: "Status", type: "select", options: FB_STATUS, required: true }, { name: "resolution", label: "Resolution", type: "textarea", wide: true, hint: "Required to resolve or close." }]}
        submit={(b) => sales.patch(`/feedback/${edit.id}`, b)} />}
    </>
  );
}

interface Renewal { id: number; account_id: number; account_name: string; description: string; renewal_on: string; expected_amount: string | null; status: string; days_until: number }

function RenewalsTab() {
  const { can } = useSales();
  const [status, setStatus] = useUrlFilter("status", "upcoming");
  const q = useSalesQuery<{ items: Renewal[] }>("/renewals", { status });
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<Renewal | null>(null);
  const write = can("retention:write");
  const resolve = useSalesMutation((a: { id: number; outcome: string }) => sales.post(`/renewals/${a.id}/resolve`, { outcome: a.outcome }), { invalidate: ["/renewals", "/retention"], success: (r: { note?: string }) => r?.note ?? "Renewal updated", onSuccess: () => setResolving(null) });
  return (
    <>
      <FilterBar>
        <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>{["upcoming", "renewed", "lost", "cancelled"].map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}</Select>
        {write && <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Track renewal</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Renewals" rows={q.data.items} rowKey={(r) => r.id} empty={<EmptyState title="No renewals" description="Track contract or subscription renewals to follow up before they lapse." />}
            columns={[{ key: "a", header: "Renewal", render: (r: Renewal) => <div><p className="font-medium">{r.description}</p><p className="text-xs text-muted-foreground">{r.account_name}</p></div> },
              { key: "d", header: "Due", render: (r: Renewal) => <span>{dateOnly(r.renewal_on)}{r.status === "upcoming" && <span className={`block text-xs ${r.days_until < 0 ? "text-rose-500" : "text-muted-foreground"}`}>{r.days_until < 0 ? `${-r.days_until} days overdue` : `in ${r.days_until} days`}</span>}</span> },
              { key: "m", header: "Expected", align: "right", hideOnMobile: true, render: (r: Renewal) => (r.expected_amount ? money(r.expected_amount) : "—") }, { key: "s", header: "Status", render: (r: Renewal) => <StatusBadge status={r.status} /> },
              { key: "x", header: "", render: (r: Renewal) => write && r.status === "upcoming" ? <Button size="sm" variant="ghost" onClick={() => setResolving(r)}>Resolve</Button> : null }]} />
        )}
      </Panel>
      {creating && <AccountFormModal onClose={() => setCreating(false)} title="Track renewal" success="Renewal tracked" invalidate={["/renewals", "/retention"]}
        fields={[{ name: "description", label: "What renews", required: true, wide: true }, { name: "renewal_on", label: "Renewal date", type: "date", required: true }, { name: "expected_amount", label: "Expected amount", type: "money" }]} submit={(b) => sales.post("/renewals", b, { idempotent: true })} />}
      <Modal open={!!resolving} onClose={() => setResolving(null)} title="Resolve renewal" description="This records the outcome only. It does not create an order or invoice; create an order to record renewed revenue.">
        <div className="flex flex-wrap gap-2">{["renewed", "lost", "cancelled"].map((o) => <Button key={o} variant={o === "renewed" ? "default" : "outline"} disabled={resolve.pending} onClick={() => resolving && void resolve.run({ id: resolving.id, outcome: o })}>Mark {o}</Button>)}</div>
        {resolve.error && <p role="alert" className="mt-2 text-sm text-rose-500">{resolve.error.message}</p>}
      </Modal>
    </>
  );
}

interface Referral { id: number; referrer_name: string; lead_first_name: string | null; lead_last_name: string | null; status: string; notes: string | null; created_at: string }
const REF_STATUS = ["received", "qualified", "won", "lost"];

function ReferralsTab() {
  const { can } = useSales();
  const q = useSalesQuery<{ items: Referral[] }>("/referrals");
  const [creating, setCreating] = useState(false);
  const write = can("retention:write");
  const set = useSalesMutation((a: { id: number; status: string }) => sales.patch(`/referrals/${a.id}`, { status: a.status }), { invalidate: ["/referrals"], success: "Referral updated" });
  return (
    <>
      {write && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Record referral</Button></div>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Referrals" rows={q.data.items} rowKey={(r) => r.id} empty={<EmptyState title="No referrals" description="Record when an existing customer refers a new lead or account." />}
            columns={[{ key: "r", header: "Referred by", render: (r: Referral) => r.referrer_name }, { key: "l", header: "Lead", hideOnMobile: true, render: (r: Referral) => [r.lead_first_name, r.lead_last_name].filter(Boolean).join(" ") || "—" }, { key: "n", header: "Notes", hideOnMobile: true, render: (r: Referral) => r.notes ?? "—" },
              { key: "s", header: "Status", render: (r: Referral) => write ? <Select aria-label="Referral status" value={r.status} onChange={(e) => void set.run({ id: r.id, status: e.target.value })}>{REF_STATUS.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}</Select> : <StatusBadge status={r.status} /> }]} />
        )}
      </Panel>
      {creating && <AccountFormModal onClose={() => setCreating(false)} title="Record referral" description="Pick the referring customer account." success="Referral recorded" invalidate={["/referrals"]}
        fields={[{ name: "notes", label: "Notes", type: "textarea", wide: true }]} submit={(b) => sales.post("/referrals", { notes: b.notes, referrer_account_id: b.account_id }, { idempotent: true })} />}
    </>
  );
}

interface AccountPlan { id: number; account_id: number; account_name: string; title: string; objectives: string | null; stakeholders: string | null; growth_opportunities: string | null; risks: string | null; actions: string | null; review_on: string | null; status: string }
const PLAN_STATUS = [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "completed", label: "Completed" }, { value: "archived", label: "Archived" }];
const PLAN_FIELDS: FieldDef[] = [
  { name: "title", label: "Title", required: true, wide: true }, { name: "status", label: "Status", type: "select", options: PLAN_STATUS, required: true }, { name: "review_on", label: "Next review", type: "date" },
  { name: "objectives", label: "Objectives", type: "textarea", wide: true }, { name: "stakeholders", label: "Stakeholders", type: "textarea", wide: true }, { name: "growth_opportunities", label: "Growth opportunities", type: "textarea", wide: true },
  { name: "risks", label: "Risks", type: "textarea", wide: true }, { name: "actions", label: "Actions", type: "textarea", wide: true },
];

function PlansTab() {
  const { can } = useSales();
  const q = useSalesQuery<{ items: AccountPlan[] }>("/account-plans");
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<AccountPlan | null>(null);
  const write = can("retention:write");
  return (
    <>
      {write && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New account plan</Button></div>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Account plans" rows={q.data.items} rowKey={(p) => p.id} onRowClick={write ? (p) => setEdit(p) : undefined} empty={<EmptyState title="No account plans" description="Capture objectives, stakeholders, risks and next actions for strategic accounts." />}
            columns={[{ key: "t", header: "Plan", render: (p: AccountPlan) => <div><p className="font-medium">{p.title}</p><p className="text-xs text-muted-foreground">{p.account_name}</p></div> }, { key: "s", header: "Status", render: (p: AccountPlan) => <StatusBadge status={p.status} /> }, { key: "r", header: "Review", hideOnMobile: true, render: (p: AccountPlan) => (p.review_on ? dateOnly(p.review_on) : "—") }]} />
        )}
      </Panel>
      {creating && <AccountFormModal onClose={() => setCreating(false)} title="New account plan" success="Plan created" invalidate={["/account-plans"]} initial={{ status: "active" }} fields={PLAN_FIELDS} submit={(b) => sales.post("/account-plans", b, { idempotent: true })} />}
      {edit && <FormModal open size="lg" onClose={() => setEdit(null)} title={edit.title} initial={edit} nullEmpty success="Plan saved" invalidate={["/account-plans"]} fields={PLAN_FIELDS} submit={(b) => sales.patch(`/account-plans/${edit.id}`, b)} />}
    </>
  );
}
