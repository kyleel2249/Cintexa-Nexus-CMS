import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, QueryBoundary, StatusBadge, ConfirmModal, Modal, Field, Input } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fin, ymd } from "@/lib/finance/api";
import { useFinanceMutation, useFinanceQuery } from "@/lib/finance/hooks";

interface Period { id: number; name: string; start_date: string; end_date: string; status: string }
interface Year { id: number; name: string; start_date: string; end_date: string; status: string; periods: Period[] }

export default function PeriodsPage() {
  const { can } = useFinance();
  const q = useFinanceQuery<{ items: Year[] }>("/fiscal-years");
  const admin = can("finance:admin");
  const [dlg, setDlg] = useState<{ kind: "status"; p: Period; to: string } | { kind: "close"; y: Year } | null>(null);
  const [newYear, setNewYear] = useState<string | null>(null);
  const refresh = { invalidate: ["/fiscal-years", "/periods", "/overview", "/trial-balance", "/dashboard", "/audit"] };
  const setStatus = useFinanceMutation((a: { p: Period; to: string; reason?: string }) => fin.post(`/periods/${a.p.id}/status`, { status: a.to, reason: a.reason }), { ...refresh, success: "Period updated", onSuccess: () => setDlg(null) });
  const close = useFinanceMutation((y: Year) => fin.post(`/fiscal-years/${y.id}/close`), { ...refresh, success: (r: any) => `Year closed. Net result ${r.net_result} transferred to Retained Earnings`, onSuccess: () => setDlg(null) });
  const addYear = useFinanceMutation((y: number) => fin.post("/fiscal-years", { start_year: y }), { ...refresh, success: "Fiscal year created", onSuccess: () => setNewYear(null) });
  const actions = (p: Period, yearClosed: boolean) => {
    if (!admin || yearClosed) return null;
    const b = (to: string, label: string) => <Button key={to} size="sm" variant="ghost" onClick={() => setDlg({ kind: "status", p, to })}>{label}</Button>;
    return p.status === "open" ? <>{b("soft_closed", "Soft close")}{b("hard_closed", "Hard close")}</> : p.status === "soft_closed" ? <>{b("hard_closed", "Hard close")}{b("open", "Reopen")}</> : b("open", "Reopen");
  };
  return (
    <>
      <PageHeader title="Accounting periods" description="Open: normal posting. Soft-closed: only users with the period-override permission can post. Hard-closed: nothing can be posted. Reopening needs a reason and is audited."
        actions={admin ? <Button size="sm" onClick={() => setNewYear(String(new Date().getFullYear() + 1))}>New fiscal year</Button> : undefined} />
      <QueryBoundary q={q}>{(d) => (<div className="space-y-4">{d.items.map((y) => (
        <Panel key={y.id} title={`${y.name} · ${ymd(y.start_date)} to ${ymd(y.end_date)}`} actions={<span className="flex items-center gap-2"><StatusBadge status={y.status} />{admin && y.status === "open" && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "close", y })}>Close year</Button>}</span>}>
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">{y.periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div><p className="text-sm font-medium">{p.name}</p><StatusBadge status={p.status} /></div><div className="flex flex-wrap justify-end">{actions(p, y.status === "closed")}</div>
            </div>))}</div>
        </Panel>))}</div>)}</QueryBoundary>
      {dlg?.kind === "status" && <ConfirmModal open onClose={() => setDlg(null)} onConfirm={(r) => void setStatus.run({ p: dlg.p, to: dlg.to, reason: r })} pending={setStatus.pending}
        title={`${dlg.to === "open" ? "Reopen" : dlg.to === "soft_closed" ? "Soft-close" : "Hard-close"} ${dlg.p.name}?`} message={dlg.to === "hard_closed" ? "No further postings will be possible. All journals in the period must already be posted." : undefined}
        confirmLabel="Confirm" reasonLabel="Reason" reasonRequired={dlg.to === "open"} />}
      {dlg?.kind === "close" && <ConfirmModal open onClose={() => setDlg(null)} onConfirm={() => void close.run(dlg.y)} pending={close.pending} danger title={`Close ${dlg.y.name}?`} confirmLabel="Close year"
        message="Revenue and expense balances are transferred to Retained Earnings with a posted closing journal, and every period in the year is hard-closed. This cannot be undone from the screen." />}
      <Modal open={newYear !== null} onClose={() => setNewYear(null)} title="New fiscal year" size="sm" footer={<><Button variant="outline" onClick={() => setNewYear(null)}>Cancel</Button><Button disabled={addYear.pending || !/^\d{4}$/.test(newYear ?? "")} onClick={() => void addYear.run(Number(newYear))}>Create</Button></>}>
        <Field label="Start year" hint="Twelve monthly periods are created from your organisation's fiscal-year start month."><Input inputMode="numeric" maxLength={4} value={newYear ?? ""} onChange={(e) => setNewYear(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
