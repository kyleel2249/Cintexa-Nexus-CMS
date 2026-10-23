import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { dateOnly, dateTime, money, relative } from "@/lib/sales/format";
import { PageHeader, Panel, StatusBadge, QueryBoundary, DefinitionList, ConfirmModal, Modal, Field, TabBar, EmptyState, Tag, DataTable, type Column } from "@/components/sales/ui";
import { FormModal } from "@/components/sales/forms";
import { ActivityFormModal } from "@/components/sales/activity";
import { OwnerSelect } from "@/components/sales/pickers";
import { ContactFormModal, type ContactRow } from "./contacts";
import { OpportunityFormModal } from "./pipeline";
import { ACCOUNT_FIELDS } from "./accounts";
import { RecordAssistant } from "@/components/sales/agents/RecordAssistant";

type Tab = "overview" | "contacts" | "deals" | "timeline" | "retention";

interface Detail {
  account: any; contacts: ContactRow[]; health: { band: string; score: number | null; signals: { signal: string; effect: number; detail: string }[]; reasons: string[] };
  opportunities?: { id: number; number: string; name: string; status: string; amount: string; currency: string; probability: string; expected_close_date: string }[];
  quotations?: { id: number; number: string; version: number; status: string; total: string; currency: string; validity_date: string }[];
  orders?: { id: number; number: string; status: string; total: string; currency: string; payment_status: string; booked_at: string | null }[];
  lifetime?: { currency: string; orders: number; booked: string; returned: string; lifetime_value: string; first_order_at: string; last_order_at: string }[];
  feedback?: { id: number; kind: string; rating: number | null; status: string; subject: string; created_at: string }[];
  plans?: { id: number; title: string; status: string; review_on: string | null }[];
  renewals?: { id: number; description: string; renewal_on: string; expected_amount: string | null; status: string }[];
  timeline: { kind: string; id: number; title: string; detail: string; at: string }[];
}

const KIND_HREF: Record<string, string> = { opportunity: "/sales/opportunities/", quotation: "/sales/quotations/", order: "/sales/orders/" };

export default function AccountDetailPage({ id }: { id: string }) {
  const { can } = useSales();
  const [, nav] = useLocation();
  const [tabRaw, setTab] = useUrlFilter("tab", "overview");
  const tab = (["overview", "contacts", "deals", "timeline", "retention"].includes(tabRaw) ? tabRaw : "overview") as Tab;
  const q = useSalesQuery<Detail>(`/accounts/${id}`);
  const [dlg, setDlg] = useState<null | "edit" | "assign" | "delete" | "contact" | "activity" | "opportunity">(null);
  const [assignTo, setAssignTo] = useState("");
  const inv = ["/accounts", "/contacts"];
  const assign = useSalesMutation(() => sales.post(`/accounts/${id}/assign`, { owner_id: Number(assignTo) }), { invalidate: inv, success: "Account reassigned", onSuccess: () => setDlg(null) });
  const del = useSalesMutation(() => sales.del(`/accounts/${id}`), { invalidate: inv, success: "Account archived", onSuccess: () => nav("/sales/accounts") });

  return (
    <QueryBoundary q={q}>
      {(d) => {
        const a = d.account;
        const tabs: { key: Tab; label: string; count?: number }[] = [
          { key: "overview", label: "Overview" }, { key: "contacts", label: "Contacts", count: d.contacts.length },
          ...(d.opportunities || d.quotations || d.orders ? [{ key: "deals" as Tab, label: "Deals & orders" }] : []), { key: "timeline", label: "Timeline" },
          ...(d.feedback || d.plans || d.renewals ? [{ key: "retention" as Tab, label: "Retention" }] : []),
        ];
        return (
          <>
            <PageHeader back={{ href: "/sales/accounts", label: "Accounts" }} title={a.name}
              description={<span className="flex flex-wrap items-center gap-2">{a.number}<StatusBadge status={a.status} /><StatusBadge status={d.health.band} label={`Health: ${d.health.band.replace("_", " ")}${d.health.score != null ? ` (${d.health.score})` : ""}`} />{(a.tags as string[]).map((t) => <Tag key={t}>{t}</Tag>)}</span>}
              actions={<>
                {can("contacts:write") && <Button size="sm" variant="outline" onClick={() => setDlg("contact")}>Add contact</Button>}
                {can("activities:write") && <Button size="sm" variant="outline" onClick={() => setDlg("activity")}>Log activity</Button>}
                {can("opportunities:write") && <Button size="sm" variant="outline" onClick={() => setDlg("opportunity")}>New opportunity</Button>}
                {can("accounts:assign") && <Button size="sm" variant="outline" onClick={() => setDlg("assign")}>Reassign</Button>}
                {can("accounts:write") && <Button size="sm" onClick={() => setDlg("edit")}>Edit</Button>}
              </>} />
            <TabBar tabs={tabs} value={tab} onChange={setTab} />
            {tab === "overview" && (
              <div className="grid gap-6 lg:grid-cols-3">
                <Panel title="Profile" className="lg:col-span-2">
                  <DefinitionList items={[
                    { label: "Type", value: a.kind }, { label: "Industry", value: a.industry }, { label: "Segment", value: a.segment }, { label: "Size", value: a.company_size },
                    { label: "Email", value: a.email }, { label: "Phone", value: a.phone }, { label: "Website", value: a.website }, { label: "Owner", value: a.owner?.display_name },
                    { label: "Address", value: [a.address_line, a.city, a.region, a.postal_code, a.country].filter(Boolean).join(", ") }, { label: "Currency", value: a.currency },
                    { label: "Payment terms", value: `${a.payment_terms_days} days` }, { label: "Credit limit", value: a.credit_limit ? money(a.credit_limit, a.currency) : null },
                    { label: "Last purchase", value: a.last_purchase_at ? `${dateOnly(a.last_purchase_at)} (${relative(a.last_purchase_at)})` : "Never" }, { label: "Expected reorder", value: a.expected_reorder_on ? dateOnly(a.expected_reorder_on) : null },
                    { label: "Consent", value: [a.consent_email && "Email", a.consent_whatsapp && "WhatsApp"].filter(Boolean).join(", ") || "None recorded" },
                  ]} />
                  {a.notes && <p className="mt-4 whitespace-pre-wrap border-t pt-3 text-sm">{a.notes}</p>}
                </Panel>
                <div className="space-y-6">
                  <Panel title="Lifetime value" description="Per currency · confirmed orders minus returns">
                    {!d.lifetime ? <p className="text-sm text-muted-foreground">You don't have access to order data.</p> : d.lifetime.length === 0 ? <p className="text-sm text-muted-foreground">No confirmed orders yet.</p> : d.lifetime.map((l) => (
                      <div key={l.currency} className="mb-2"><p className="text-xl font-semibold tabular-nums">{money(l.lifetime_value, l.currency)}</p><p className="text-xs text-muted-foreground">{l.orders} orders · first {dateOnly(l.first_order_at)} · latest {dateOnly(l.last_order_at)}</p></div>
                    ))}
                  </Panel>
                  <Panel title="Health signals" description="Rule-based; each reason is listed">
                    {d.health.signals.length === 0 ? <p className="text-sm text-muted-foreground">{d.health.reasons[0] ?? "Not enough history to assess."}</p> : <ul className="space-y-1 text-xs">{d.health.signals.map((s) => <li key={s.signal} className="flex justify-between gap-2"><span className="text-muted-foreground">{s.detail}</span><span className={s.effect < 0 ? "text-rose-500" : "text-emerald-500"}>{s.effect > 0 ? "+" : ""}{s.effect}</span></li>)}</ul>}
                  </Panel>
                </div>
              </div>
            )}
            {tab === "contacts" && <Panel flush>{d.contacts.length === 0 ? <EmptyState title="No contacts yet" description="Add the people you deal with at this account." /> : (
              <DataTable caption="Contacts" rows={d.contacts} rowKey={(c) => c.id} columns={[
                { key: "n", header: "Name", render: (c) => <span>{c.first_name} {c.last_name ?? ""} {c.is_primary && <Tag>Primary</Tag>}</span> },
                { key: "t", header: "Title", hideOnMobile: true, render: (c) => c.job_title ?? "—" }, { key: "e", header: "Email", render: (c) => c.email ?? "—" }, { key: "p", header: "Phone", hideOnMobile: true, render: (c) => c.phone ?? "—" }, { key: "r", header: "Role", hideOnMobile: true, render: (c) => <StatusBadge status={c.role} /> },
              ] as Column<ContactRow>[]} />)}</Panel>}
            {tab === "deals" && (
              <div className="space-y-6">
                {d.opportunities && <Panel title="Opportunities" flush>{d.opportunities.length === 0 ? <EmptyState title="No opportunities" /> : <DataTable caption="Opportunities" rows={d.opportunities} rowKey={(o) => o.id} onRowClick={(o) => nav(`/sales/opportunities/${o.id}`)} columns={[{ key: "n", header: "Opportunity", render: (o) => <span>{o.name} <span className="text-xs text-muted-foreground">{o.number}</span></span> }, { key: "s", header: "Status", render: (o) => <StatusBadge status={o.status} /> }, { key: "a", header: "Amount", align: "right", render: (o) => money(o.amount, o.currency) }, { key: "c", header: "Close", hideOnMobile: true, render: (o) => dateOnly(o.expected_close_date) }]} />}</Panel>}
                {d.quotations && <Panel title="Quotations" flush>{d.quotations.length === 0 ? <EmptyState title="No quotations" /> : <DataTable caption="Quotations" rows={d.quotations} rowKey={(o) => o.id} onRowClick={(o) => nav(`/sales/quotations/${o.id}`)} columns={[{ key: "n", header: "Number", render: (o) => `${o.number} v${o.version}` }, { key: "s", header: "Status", render: (o) => <StatusBadge status={o.status} /> }, { key: "a", header: "Total", align: "right", render: (o) => money(o.total, o.currency) }, { key: "v", header: "Valid until", hideOnMobile: true, render: (o) => dateOnly(o.validity_date) }]} />}</Panel>}
                {d.orders && <Panel title="Orders" flush>{d.orders.length === 0 ? <EmptyState title="No orders" /> : <DataTable caption="Orders" rows={d.orders} rowKey={(o) => o.id} onRowClick={(o) => nav(`/sales/orders/${o.id}`)} columns={[{ key: "n", header: "Order", render: (o) => o.number }, { key: "s", header: "Status", render: (o) => <StatusBadge status={o.status} /> }, { key: "p", header: "Payment", hideOnMobile: true, render: (o) => <StatusBadge status={o.payment_status} /> }, { key: "a", header: "Total", align: "right", render: (o) => money(o.total, o.currency) }]} />}</Panel>}
              </div>
            )}
            {tab === "timeline" && <Panel>{d.timeline.length === 0 ? <EmptyState title="Nothing has happened yet" /> : (
              <ol className="relative ml-2 space-y-4 border-l pl-5">{d.timeline.map((t) => (
                <li key={`${t.kind}-${t.id}`}><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><p className="text-sm font-medium">{KIND_HREF[t.kind] ? <a className="text-primary hover:underline" href={`${KIND_HREF[t.kind]}${t.id}`}>{t.title}</a> : t.title}</p><p className="text-xs text-muted-foreground">{t.kind} · {t.detail} · {dateTime(t.at)}</p></li>
              ))}</ol>)}</Panel>}
            {tab === "retention" && (
              <div className="grid gap-6 lg:grid-cols-3">
                <Panel title="Feedback & complaints">{!d.feedback?.length ? <p className="text-sm text-muted-foreground">None recorded.</p> : <ul className="space-y-2 text-sm">{d.feedback.map((f) => <li key={f.id} className="flex justify-between gap-2"><span className="truncate">{f.subject}</span><StatusBadge status={f.status} /></li>)}</ul>}</Panel>
                <Panel title="Account plans">{!d.plans?.length ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="space-y-2 text-sm">{d.plans.map((p) => <li key={p.id} className="flex justify-between gap-2"><span className="truncate">{p.title}</span><StatusBadge status={p.status} /></li>)}</ul>}</Panel>
                <Panel title="Renewals">{!d.renewals?.length ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="space-y-2 text-sm">{d.renewals.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="truncate">{r.description} · {dateOnly(r.renewal_on)}</span><StatusBadge status={r.status} /></li>)}</ul>}</Panel>
              </div>
            )}
            {can("accounts:delete") && <div className="mt-8"><Button variant="ghost" size="sm" className="text-rose-500" onClick={() => setDlg("delete")}>Archive account…</Button></div>}

            <div className="mt-6"><RecordAssistant type="account" id={Number(id)} /></div>
            <FormModal open={dlg === "edit"} onClose={() => setDlg(null)} title="Edit account" size="lg" fields={ACCOUNT_FIELDS} initial={a} nullEmpty submit={(b) => sales.patch(`/accounts/${id}`, b)} success="Account updated" invalidate={inv} />
            {dlg === "contact" && <ContactFormModal open onClose={() => setDlg(null)} accountId={Number(id)} accountName={a.name} />}
            <ActivityFormModal open={dlg === "activity"} onClose={() => setDlg(null)} link={{ account_id: Number(id) }} />
            {dlg === "opportunity" && <OpportunityFormModal open onClose={() => setDlg(null)} accountId={Number(id)} accountName={a.name} />}
            <Modal open={dlg === "assign"} onClose={() => setDlg(null)} title="Reassign account" size="sm" footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={!assignTo || assign.pending} onClick={() => void assign.run()}>Reassign</Button></>}>
              <Field label="New owner"><OwnerSelect value={assignTo} onChange={setAssignTo} allowAll={false} label="Owner" className="w-full" /></Field>
            </Modal>
            <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} title="Archive this account?" message="Accounts with open opportunities or orders can't be archived. Archiving is audited." confirmLabel="Archive" danger pending={del.pending} onConfirm={() => void del.run()} />
          </>
        );
      }}
    </QueryBoundary>
  );
}
