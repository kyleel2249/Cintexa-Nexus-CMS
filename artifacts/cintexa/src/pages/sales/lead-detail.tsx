import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { dateTime, money, relative } from "@/lib/sales/format";
import { labelOf } from "@/lib/sales/labels";
import { TOUCH_CHANNELS } from "@/lib/sales/enums";
import { PageHeader, Panel, StatusBadge, QueryBoundary, DefinitionList, ConfirmModal, Modal, Field, Select,  ProgressBar, EmptyState } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { ActivityList, ActivityFormModal, type ActivityRow } from "@/components/sales/activity";
import { OwnerSelect, AccountPicker } from "@/components/sales/pickers";
import { LEAD_FIELDS } from "./leads";

interface Detail {
  lead: any; activities: ActivityRow[]; ownershipHistory: { id: number; from_owner_id: number | null; to_owner_id: number | null; changed_by: string; reason: string | null; at: string }[];
  duplicates: { id: number; number: string; first_name: string; last_name?: string; company?: string; reasons?: string[] }[]; touches: { kind: string; at: string; campaign: string }[]; transitions: string[];
}

const TOUCH_FIELDS: FieldDef[] = [
  { name: "channel", label: "Channel", type: "select", options: TOUCH_CHANNELS, required: true },
  { name: "subject", label: "Subject", required: true },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "outcome", label: "Outcome" },
  { name: "next_action", label: "Next action" },
  { name: "next_follow_up_at", label: "Next follow-up", type: "datetime" },
];

export default function LeadDetailPage({ id }: { id: string }) {
  const { can } = useSales();
  const [, nav] = useLocation();
  const q = useSalesQuery<Detail>(`/leads/${id}`);
  const inv = ["/leads", "/dashboard", "/activities"];
  const [dlg, setDlg] = useState<null | "edit" | "touch" | "status" | "assign" | "convert" | "merge" | "delete" | "activity" | "disqualify">(null);
  const [nextStatus, setNextStatus] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [mergeId, setMergeId] = useState<number | null>(null);
  const status = useSalesMutation((p: { status: string; reason?: string }) => sales.post(`/leads/${id}/status`, p), { invalidate: inv, success: "Status updated", onSuccess: () => { setDlg(null); } });
  const claim = useSalesMutation(() => sales.post(`/leads/${id}/claim`, {}), { invalidate: inv, success: "Lead claimed" });
  const rescore = useSalesMutation(() => sales.post(`/leads/${id}/rescore`, {}), { invalidate: [`/leads/${id}`], success: "Score recalculated" });
  const assign = useSalesMutation(() => sales.post(`/leads/${id}/assign`, { owner_id: Number(assignTo) }), { invalidate: inv, success: "Lead reassigned", onSuccess: () => setDlg(null) });
  const merge = useSalesMutation(() => sales.post(`/leads/${id}/merge`, { duplicate_id: mergeId }), { invalidate: inv, success: "Leads merged", onSuccess: () => setDlg(null) });
  const del = useSalesMutation(() => sales.del(`/leads/${id}`), { invalidate: inv, success: "Lead deleted", onSuccess: () => nav("/sales/leads") });

  return (
    <QueryBoundary q={q}>
      {(d) => {
        const l = d.lead;
        const closed = l.status === "converted";
        const nextOptions = d.transitions.filter((t) => t !== "disqualified");
        return (
          <>
            <PageHeader
              back={{ href: "/sales/leads", label: "Leads" }}
              title={[l.first_name, l.last_name].filter(Boolean).join(" ")}
              description={<span className="flex flex-wrap items-center gap-2">{l.number}<StatusBadge status={l.status} /><StatusBadge status={l.priority} />{l.company && <span>· {l.company}</span>}</span>}
              actions={
                <>
                  {can("leads:write") && !closed && l.status !== "disqualified" && <Button size="sm" variant="outline" onClick={() => setDlg("touch")}>Log contact</Button>}
                  {can("leads:write") && !closed && nextOptions.length > 0 && <Button size="sm" variant="outline" onClick={() => { setNextStatus(nextOptions[0]!); setDlg("status"); }}>Change status</Button>}
                  {can("leads:write") && l.status === "qualified" && <Button size="sm" onClick={() => setDlg("convert")}>Convert</Button>}
                  {can("leads:write") && !closed && !l.owner_id && <Button size="sm" variant="outline" disabled={claim.pending} onClick={() => void claim.run()}>Claim</Button>}
                  {can("leads:assign") && !closed && <Button size="sm" variant="outline" onClick={() => setDlg("assign")}>Assign</Button>}
                  {can("leads:write") && !closed && <Button size="sm" variant="outline" onClick={() => setDlg("edit")}>Edit</Button>}
                </>
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel title="Details">
                  <DefinitionList items={[
                    { label: "Email", value: l.email }, { label: "Phone", value: l.phone }, { label: "Job title", value: l.job_title }, { label: "Industry", value: l.industry },
                    { label: "Country", value: l.country }, { label: "Source", value: labelOf(l.source) }, { label: "Estimated value", value: l.estimated_value ? money(l.estimated_value) : null },
                    { label: "Budget", value: l.budget ? money(l.budget) : null }, { label: "Product interest", value: l.product_interest }, { label: "Owner", value: l.owner?.display_name ?? "Unassigned" },
                    { label: "Next action", value: l.next_action }, { label: "Next follow-up", value: l.next_follow_up_at ? dateTime(l.next_follow_up_at) : null },
                    { label: "Last contact", value: l.last_contact_at ? relative(l.last_contact_at) : "Never contacted" },
                    { label: "Consent", value: [l.consent_email && "Email", l.consent_whatsapp && "WhatsApp"].filter(Boolean).join(", ") || "None recorded" },
                    { label: "Disqualification reason", value: l.disqualification_reason },
                  ]} />
                  {l.notes && <p className="mt-4 whitespace-pre-wrap border-t pt-3 text-sm">{l.notes}</p>}
                  {closed && <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">Converted {dateTime(l.converted_at)}. {l.converted_account_id && <Link className="text-primary hover:underline" href={`/sales/accounts/${l.converted_account_id}`}>Open account</Link>}{l.converted_opportunity_id && <> · <Link className="text-primary hover:underline" href={`/sales/opportunities/${l.converted_opportunity_id}`}>Open opportunity</Link></>}</p>}
                </Panel>
                <Panel title="Activity" actions={can("activities:write") && !closed ? <Button size="sm" variant="outline" onClick={() => setDlg("activity")}>Add activity</Button> : undefined}>
                  <ActivityList items={d.activities} empty="No activity yet — log a call or schedule a follow-up." />
                </Panel>
              </div>
              <div className="space-y-6">
                <Panel title={`Score: ${l.score}/100`} description="Calculated from the factors below; nothing is estimated by AI." actions={can("leads:write") && !closed ? <Button size="sm" variant="ghost" disabled={rescore.pending} onClick={() => void rescore.run()}>Recalculate</Button> : undefined}>
                  <ProgressBar value={l.score} />
                  <ul className="mt-3 space-y-1 text-xs">{(l.score_breakdown ?? []).map((b: { factor: string; points: number; detail: string }) => <li key={b.factor} className="flex justify-between gap-2"><span className="text-muted-foreground">{b.detail}</span><span className={b.points < 0 ? "text-rose-500" : "text-emerald-500"}>{b.points > 0 ? "+" : ""}{b.points}</span></li>)}</ul>
                </Panel>
                {d.duplicates.length > 0 && (
                  <Panel title="Possible duplicates">
                    <ul className="space-y-2 text-sm">{d.duplicates.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate"><Link className="text-primary hover:underline" href={`/sales/leads/${x.id}`}>{x.number}</Link> {x.first_name} {x.last_name ?? ""}{x.reasons?.length ? <span className="text-xs text-muted-foreground"> ({x.reasons.join(", ")})</span> : null}</span>
                        {can("leads:merge") && !closed && <Button size="sm" variant="outline" onClick={() => { setMergeId(x.id); setDlg("merge"); }}>Merge</Button>}</li>
                    ))}</ul>
                  </Panel>
                )}
                {d.touches.length > 0 && <Panel title="Campaign touches"><ul className="space-y-1 text-xs">{d.touches.map((t, i) => <li key={i} className="flex justify-between"><span>{t.campaign} · {t.kind}</span><span className="text-muted-foreground">{relative(t.at)}</span></li>)}</ul></Panel>}
                <Panel title="Ownership history">{d.ownershipHistory.length === 0 ? <EmptyState title="No changes" /> : <ul className="space-y-1 text-xs">{d.ownershipHistory.map((h) => <li key={h.id}><span className="text-muted-foreground">{relative(h.at)}</span> · {h.changed_by}{h.reason ? ` — ${h.reason}` : ""}</li>)}</ul>}</Panel>
                {can("leads:delete") && <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => setDlg("delete")}>Delete lead…</Button>}
              </div>
            </div>

            <FormModal open={dlg === "edit"} onClose={() => setDlg(null)} title="Edit lead" size="lg" fields={LEAD_FIELDS} initial={l} nullEmpty submit={(b) => sales.patch(`/leads/${id}`, b)} success="Lead updated" invalidate={["/leads"]} />
            <FormModal open={dlg === "touch"} onClose={() => setDlg(null)} title="Log contact" fields={TOUCH_FIELDS} initial={{ channel: "call" }} submit={(b) => sales.post(`/leads/${id}/touch`, b)} success="Contact logged" invalidate={inv} />
            <ActivityFormModal open={dlg === "activity"} onClose={() => setDlg(null)} link={{ lead_id: Number(id) }} />
            <Modal open={dlg === "status"} onClose={() => setDlg(null)} title="Change status" size="sm" footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={status.pending} onClick={() => void status.run({ status: nextStatus })}>Update</Button></>}>
              <Field label="New status"><Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>{nextOptions.map((s) => <option key={s} value={s}>{labelOf(s)}</option>)}</Select></Field>
              {can("leads:write") && d.transitions.includes("disqualified") && <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => setDlg("disqualify")}>Disqualify instead…</Button>}
            </Modal>
            <ConfirmModal open={dlg === "disqualify"} onClose={() => setDlg(null)} title="Disqualify lead" message="Open follow-ups for this lead will be cancelled." confirmLabel="Disqualify" danger reasonLabel="Reason" reasonRequired pending={status.pending} onConfirm={(reason) => void status.run({ status: "disqualified", reason })} />
            <Modal open={dlg === "assign"} onClose={() => setDlg(null)} title="Assign lead" size="sm" footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button disabled={!assignTo || assign.pending} onClick={() => void assign.run()}>Assign</Button></>}>
              <Field label="New owner"><OwnerSelect value={assignTo} onChange={setAssignTo} allowAll={false} label="Owner" className="w-full" /></Field>
            </Modal>
            <ConfirmModal open={dlg === "merge"} onClose={() => setDlg(null)} title="Merge duplicate" message="The duplicate's activities and campaign membership move to this lead; empty fields are filled from it. The duplicate is archived, not deleted." confirmLabel="Merge" pending={merge.pending} onConfirm={() => void merge.run()} />
            <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} title="Delete this lead?" message="The lead is archived and disappears from lists. This is recorded in the audit log." confirmLabel="Delete" danger pending={del.pending} onConfirm={() => void del.run()} />
            <ConvertModal open={dlg === "convert"} onClose={() => setDlg(null)} lead={l} />
          </>
        );
      }}
    </QueryBoundary>
  );
}

function ConvertModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead: any }) {
  const [, nav] = useLocation();
  const [accountId, setAccountId] = useState("");
  const [accountName, setAccountName] = useState("");
  const fields: FieldDef[] = [
    { name: "account_name", label: "New account name", hint: "Leave empty to use the company / lead name. Or pick an existing account below.", wide: true, when: () => !accountId },
    { name: "create_opportunity", label: "Create an opportunity", type: "checkbox" },
    { name: "opportunity_name", label: "Opportunity name", when: (v) => v.create_opportunity === true },
    { name: "opportunity_amount", label: "Amount", type: "money", when: (v) => v.create_opportunity === true },
    { name: "expected_close_date", label: "Expected close", type: "date", when: (v) => v.create_opportunity === true },
  ];
  return (
    <FormModal
      open={open} onClose={onClose} title="Convert lead" description="Creates (or links) the account, a primary contact, and optionally an opportunity. A lead converts once." fields={fields}
      initial={{ create_opportunity: true, opportunity_amount: lead.estimated_value ?? "", account_name: lead.company ?? "" }} submitLabel="Convert" success="Lead converted" invalidate={["/leads", "/accounts", "/opportunities", "/dashboard"]}
      extra={<Field label="…or link to an existing account"><AccountPicker value={accountId} onChange={(i, n) => { setAccountId(i); setAccountName(n); }} initialName={accountName} /></Field>}
      submit={(b) => sales.post(`/leads/${lead.id}/convert`, { ...b, ...(accountId ? { account_id: Number(accountId) } : {}) }, { idempotent: true })}
      onDone={(r) => nav(`/sales/accounts/${(r as { accountId: number }).accountId}`)}
      errorExtra={(err, retry) => err.code === "possible_duplicate_account" ? (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium text-amber-500">A very similar account exists</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{((err.details as { candidates?: { id: number; name: string; number?: string }[] })?.candidates ?? []).map((c) => <li key={c.id}>{c.name} {c.number ?? ""} <button type="button" className="text-primary hover:underline" onClick={() => { setAccountId(String(c.id)); setAccountName(c.name); }}>use this account</button></li>)}</ul>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => retry({ allow_duplicate_account: true })}>Create a new account anyway</Button>
        </div>
      ) : null}
    />
  );
}
