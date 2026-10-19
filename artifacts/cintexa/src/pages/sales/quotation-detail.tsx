import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales, openHtmlInNewTab } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery } from "@/lib/sales/hooks";
import { dateOnly, dateTime, money, percent } from "@/lib/sales/format";
import { PageHeader, Panel, StatusBadge, QueryBoundary, DefinitionList, ConfirmModal, Modal, Field, Input, Select, Textarea, DataTable, Tag } from "@/components/sales/ui";
import { LinesEditor, draftToBody, linesToDraft, type LineDraft } from "@/components/sales/LinesEditor";
import { FormModal } from "@/components/sales/forms";

interface Detail {
  quotation: any; lines: { id: number; position: number; product_id: number | null; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string; net: string; total: string; sku?: string; unit_cost?: string }[];
  account: { id: number; name: string; number: string }; versions: { id: number; version: number; status: string; total: string; created_at: string }[];
  approvals: { id: number; requested_by: string; decided_by: string | null; decision: string; reasons: { code: string; message: string }[]; comment: string | null; requested_at: string; decided_at: string | null }[];
  order: { id: number; number: string } | null; pastValidity: boolean; editable: boolean;
}

type Dlg = null | "lines" | "send" | "approve" | "reject-approval" | "accept" | "reject" | "cancel" | "convert" | "meta";

export default function QuotationDetailPage({ id }: { id: string }) {
  const { can, me } = useSales();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const q = useSalesQuery<Detail>(`/quotations/${id}`);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [shared, setShared] = useState<string | null>(null);
  const inv = [`/quotations`, "/dashboard", "/orders"];
  const act = (path: string, success: string, body?: unknown, after?: (r: any) => void) => useSalesMutation(() => sales.post(`/quotations/${id}/${path}`, body ?? {}), { invalidate: inv, success, onSuccess: (r) => { setDlg(null); after?.(r); } });
  const submit = act("submit", "Submitted");
  const revise = act("revise", "New version created", {}, (r) => r?.id && nav(`/sales/quotations/${r.id}`));
  const showPrint = async () => { try { const r = await sales.text(`/quotations/${id}/print`); openHtmlInNewTab(r.text); } catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); } };

  return (
    <QueryBoundary q={q}>
      {(d) => {
        const x = d.quotation;
        const st = x.status as string;
        const showCost = !!me?.canSeeCost && x.margin_percent != null;
        return (
          <>
            <PageHeader back={{ href: "/sales/quotations", label: "Quotations" }} title={`${x.number} · v${x.version}`}
              description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={st} /><Link className="text-primary hover:underline" href={`/sales/accounts/${d.account.id}`}>{d.account.name}</Link>{d.pastValidity && <Tag>Past validity</Tag>}{x.requires_approval && <Tag>Needs approval</Tag>}</span>}
              actions={<>
                <Button size="sm" variant="outline" onClick={() => void showPrint()}>Preview / print</Button>
                {can("quotations:write") && d.editable && <Button size="sm" variant="outline" onClick={() => setDlg("lines")}>Edit lines</Button>}
                {can("quotations:write") && d.editable && <Button size="sm" variant="outline" onClick={() => setDlg("meta")}>Terms & dates</Button>}
                {can("quotations:write") && d.editable && <Button size="sm" disabled={submit.pending} onClick={() => void submit.run()}>{x.requires_approval ? "Submit for approval" : "Submit"}</Button>}
                {can("quotations:approve") && st === "pending_approval" && <><Button size="sm" onClick={() => setDlg("approve")}>Approve</Button><Button size="sm" variant="outline" onClick={() => setDlg("reject-approval")}>Reject</Button></>}
                {can("quotations:send") && ["approved", "sent", "viewed"].includes(st) && <Button size="sm" onClick={() => setDlg("send")}>{st === "approved" ? "Send to customer" : "New customer link"}</Button>}
                {can("quotations:send") && ["sent", "viewed"].includes(st) && <Button size="sm" variant="outline" onClick={() => setDlg("accept")}>Record acceptance</Button>}
                {can("quotations:write") && ["sent", "viewed"].includes(st) && <Button size="sm" variant="outline" onClick={() => setDlg("reject")}>Record rejection</Button>}
                {can("quotations:write") && !["accepted", "cancelled", "superseded"].includes(st) && <Button size="sm" variant="ghost" onClick={() => setDlg("cancel")}>Cancel</Button>}
                {can("quotations:write") && !d.editable && !["superseded", "cancelled"].includes(st) && <Button size="sm" variant="outline" disabled={revise.pending} onClick={() => void revise.run()}>Revise (new version)</Button>}
                {can("orders:write") && st === "accepted" && !d.order && <Button size="sm" onClick={() => setDlg("convert")}>Convert to order</Button>}
              </>} />
            {d.order && <p className="mb-4 rounded-md border bg-secondary/40 px-3 py-2 text-sm">Converted to order <Link className="text-primary hover:underline" href={`/sales/orders/${d.order.id}`}>{d.order.number}</Link>.</p>}
            {submit.error && <p role="alert" className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{submit.error.message}</p>}
            {x.approval_reasons?.length > 0 && ["draft", "pending_approval"].includes(st) && <Panel className="mb-4" title="Approval needed because"><ul className="list-disc pl-5 text-sm">{(x.approval_reasons as { message: string }[]).map((r, i) => <li key={i}>{r.message}</li>)}</ul></Panel>}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Panel title="Lines" flush>
                  <DataTable caption="Quotation lines" rows={d.lines} rowKey={(l) => l.id} columns={[
                    { key: "d", header: "Item", render: (l) => <div><p>{l.description}</p>{l.sku && <p className="text-xs text-muted-foreground">{l.sku}</p>}</div> },
                    { key: "q", header: "Qty", align: "right", render: (l) => Number(l.quantity) },
                    { key: "p", header: "Unit price", align: "right", hideOnMobile: true, render: (l) => money(l.unit_price, x.currency) },
                    { key: "x", header: "Disc.", align: "right", hideOnMobile: true, render: (l) => (Number(l.discount_percent) ? percent(Number(l.discount_percent)) : "—") },
                    { key: "t", header: "Total", align: "right", render: (l) => money(l.total, x.currency) },
                  ]} />
                  <dl className="space-y-1 border-t px-4 py-3 text-sm">
                    <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(x.subtotal, x.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Discount</dt><dd className="tabular-nums">−{money(x.discount_total, x.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{money(x.tax_total, x.currency)}</dd></div>
                    <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(x.total, x.currency)}</dd></div>
                    {showCost && <div className="flex justify-between text-xs text-muted-foreground"><dt>Margin</dt><dd>{percent(Number(x.margin_percent))}</dd></div>}
                  </dl>
                </Panel>
                {(x.terms || x.delivery_terms || x.notes) && <Panel title="Terms & notes">{x.terms && <p className="whitespace-pre-wrap text-sm">{x.terms}</p>}{x.delivery_terms && <p className="mt-2 whitespace-pre-wrap text-sm">Delivery: {x.delivery_terms}</p>}{x.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">Internal: {x.notes}</p>}</Panel>}
              </div>
              <div className="space-y-6">
                <Panel title="Details"><DefinitionList items={[{ label: "Valid until", value: dateOnly(x.validity_date) }, { label: "Payment terms", value: `${x.payment_terms_days} days` }, { label: "Sent", value: x.sent_at ? `${dateTime(x.sent_at)} (${x.sent_via === "manual_link" ? "link shared manually" : x.sent_via})` : null }, { label: "Customer opened", value: x.viewed_at ? dateTime(x.viewed_at) : null }, { label: "Accepted", value: x.accepted_at ? `${dateTime(x.accepted_at)} by ${x.accepted_by_name}` : null }, { label: "Acceptance evidence", value: x.acceptance_evidence }, { label: "Rejected", value: x.rejected_at ? `${dateTime(x.rejected_at)} — ${x.rejected_reason ?? ""}` : null }]} /></Panel>
                <Panel title="Versions"><ul className="space-y-1 text-sm">{d.versions.map((v) => <li key={v.id} className="flex items-center justify-between gap-2">{v.id === Number(id) ? <span className="font-medium">v{v.version} (this)</span> : <Link className="text-primary hover:underline" href={`/sales/quotations/${v.id}`}>v{v.version}</Link>}<span className="flex items-center gap-2"><StatusBadge status={v.status} /><span className="tabular-nums text-xs">{money(v.total, x.currency)}</span></span></li>)}</ul></Panel>
                {d.approvals.length > 0 && <Panel title="Approvals"><ul className="space-y-2 text-xs">{d.approvals.map((a) => <li key={a.id}><StatusBadge status={a.decision} /> <span className="text-muted-foreground">requested by {a.requested_by} · {dateTime(a.requested_at)}{a.decided_by ? ` · decided by ${a.decided_by}` : ""}</span>{a.comment && <p className="mt-0.5">{a.comment}</p>}</li>)}</ul></Panel>}
              </div>
            </div>

            {dlg === "lines" && <LinesModal id={id} initial={linesToDraft(d.lines)} onClose={() => setDlg(null)} />}
            <FormModal open={dlg === "meta"} onClose={() => setDlg(null)} title="Terms & dates" initial={x} nullEmpty success="Saved" invalidate={[`/quotations/${id}`]} submit={(b) => sales.patch(`/quotations/${id}`, b)}
              fields={[{ name: "validity_date", label: "Valid until", type: "date", required: true }, { name: "payment_terms_days", label: "Payment terms (days)", type: "number", min: 0, max: 365, required: true }, { name: "terms", label: "Terms", type: "textarea" }, { name: "delivery_terms", label: "Delivery terms", type: "textarea" }, { name: "notes", label: "Internal notes", type: "textarea" }]} />
            {dlg === "send" && <SendModal id={id} onClose={() => setDlg(null)} onLink={setShared} />}
            <CommentModal open={dlg === "approve"} onClose={() => setDlg(null)} title="Approve quotation" path={`/quotations/${id}/approve`} label="Comment (optional)" confirm="Approve" success="Approved" inv={inv} />
            <CommentModal open={dlg === "reject-approval"} onClose={() => setDlg(null)} title="Reject approval request" path={`/quotations/${id}/reject-approval`} label="Why is it rejected?" required confirm="Reject" success="Returned to the owner" inv={inv} field="comment" />
            <CommentModal open={dlg === "reject"} onClose={() => setDlg(null)} title="Record customer rejection" path={`/quotations/${id}/reject`} label="Reason the customer gave" required confirm="Record" success="Rejection recorded" inv={inv} field="reason" />
            <CommentModal open={dlg === "cancel"} onClose={() => setDlg(null)} title="Cancel quotation" path={`/quotations/${id}/cancel`} label="Reason (optional)" confirm="Cancel quotation" success="Cancelled" inv={inv} field="reason" danger />
            {dlg === "accept" && <AcceptModal id={id} onClose={() => setDlg(null)} />}
            {dlg === "convert" && <ConvertModal id={id} onClose={() => setDlg(null)} />}
            <Modal open={!!shared} onClose={() => setShared(null)} title="Customer link" size="md" footer={<Button onClick={() => setShared(null)}>Done</Button>}>
              <p className="mb-2 text-sm text-muted-foreground">This link is shown once. Copy it and share it with the customer yourself — nothing has been emailed.</p>
              <Input readOnly value={shared ?? ""} onFocus={(e) => e.currentTarget.select()} />
              <Button className="mt-3" size="sm" variant="outline" onClick={() => shared && void navigator.clipboard?.writeText(shared)}>Copy link</Button>
            </Modal>
          </>
        );
      }}
    </QueryBoundary>
  );
}

function LinesModal({ id, initial, onClose }: { id: string; initial: LineDraft[]; onClose: () => void }) {
  const [rows, setRows] = useState(initial);
  const [err, setErr] = useState("");
  const save = useSalesMutation(() => { const b = draftToBody(rows); if (b.error) throw new Error(b.error); return sales.patch(`/quotations/${id}`, { lines: b.lines }); }, { invalidate: [`/quotations/${id}`], success: "Lines saved (prices recalculated)", silentError: true, onError: (e) => setErr(e.message), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Edit lines" size="xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending} onClick={() => { setErr(""); void save.run(); }}>Save lines</Button></>}>
      {err && <p role="alert" className="mb-3 text-sm text-rose-500">{err}</p>}
      <LinesEditor rows={rows} onChange={setRows} />
    </Modal>
  );
}

function SendModal({ id, onClose, onLink }: { id: string; onClose: () => void; onLink: (l: string) => void }) {
  const [channel, setChannel] = useState<"link" | "email">("link");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const send = useSalesMutation(() => sales.post<{ link?: string; note: string; queued?: boolean }>(`/quotations/${id}/send`, { channel, ...(to ? { to } : {}), ...(message ? { message } : {}) }), {
    invalidate: [`/quotations/${id}`], success: undefined,
    onSuccess: (r) => { const o = r as { link?: string; note: string }; if (o.link) { onLink(`${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${o.link}`); onClose(); } else setResult(o.note); },
  });
  return (
    <Modal open onClose={onClose} title="Send quotation" size="md" footer={<><Button variant="outline" onClick={onClose}>Close</Button>{!result && <Button disabled={send.pending} onClick={() => void send.run()}>{channel === "link" ? "Create link" : "Queue email"}</Button>}</>}>
      {result ? <p className="text-sm">{result}</p> : (
        <>
          <Field label="How will you send it?"><Select value={channel} onChange={(e) => setChannel(e.target.value as "link" | "email")}><option value="link">Create a private link (I will share it myself)</option><option value="email">Email it (needs a connected email provider and customer consent)</option></Select></Field>
          {channel === "email" && <><Field label="Recipient email" hint="Defaults to the quotation's contact"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field><Field label="Message"><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field></>}
          {send.error && <p role="alert" className="text-sm text-rose-500">{send.error.message}</p>}
        </>
      )}
    </Modal>
  );
}

function CommentModal({ open, onClose, title, path, label, required, confirm, success, inv, field = "comment", danger }: { open: boolean; onClose: () => void; title: string; path: string; label: string; required?: boolean; confirm: string; success: string; inv: string[]; field?: string; danger?: boolean }) {
  const m = useSalesMutation((reason: string) => sales.post(path, reason ? { [field]: reason } : {}), { invalidate: inv, success, onSuccess: onClose });
  return <ConfirmModal open={open} onClose={onClose} title={title} confirmLabel={confirm} danger={danger} pending={m.pending} reasonLabel={label} reasonRequired={required} onConfirm={(r) => void m.run(r ?? "")} />;
}

function AcceptModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [evidence, setEvidence] = useState("");
  const m = useSalesMutation(() => sales.post(`/quotations/${id}/accept-manual`, { accepted_by_name: name, evidence }), { invalidate: ["/quotations", "/dashboard"], success: "Acceptance recorded", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Record customer acceptance" size="sm" description="Use when the customer accepted outside the link (email, signed copy, call). It is labelled manual and unverified." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={name.trim().length < 2 || evidence.trim().length < 3 || m.pending} onClick={() => void m.run()}>Record</Button></>}>
      <Field label="Accepted by" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Evidence" required hint="e.g. email of 12 Oct from jane@customer.com"><Textarea rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
    </Modal>
  );
}

function ConvertModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [, nav] = useLocation();
  return (
    <FormModal open onClose={onClose} title="Convert to order" description="Creates a draft sales order from the accepted lines. This can be done once." submitLabel="Create order" success="Order created" invalidate={["/quotations", "/orders"]}
      fields={[{ name: "requested_delivery_on", label: "Requested delivery", type: "date" }, { name: "billing_address", label: "Billing address", wide: true }, { name: "shipping_address", label: "Shipping address", wide: true }, { name: "notes", label: "Notes", type: "textarea" }]}
      submit={(b) => sales.post(`/quotations/${id}/convert`, b, { idempotent: true })} onDone={(r) => nav(`/sales/orders/${(r as { id: number }).id}`)} />
  );
}
