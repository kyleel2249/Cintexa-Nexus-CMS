import { useState } from "react";
import { PageHeader, Panel, DataTable, EmptyState, QueryBoundary, StatusBadge } from "@/components/sales/ui";
import { useFinance } from "@/context/FinanceContext";
import { fmtMoney, ymd } from "@/lib/finance/api";
import { useFinanceQuery } from "@/lib/finance/hooks";
import { JournalDrawer, type Journal } from "./journals";

export default function ApprovalsPage() {
  const { currency } = useFinance();
  const q = useFinanceQuery<{ items: Journal[]; total: number }>("/journals", { status: "draft", limit: 100 });
  const ready = useFinanceQuery<{ items: Journal[] }>("/journals", { status: "approved", limit: 100 });
  const [open, setOpen] = useState<number | null>(null);
  const cols = [
    { key: "r", header: "Reference", render: (j: Journal) => <span className="font-mono">{j.reference}</span> }, { key: "d", header: "Date", render: (j: Journal) => ymd(j.entry_date) },
    { key: "x", header: "Description", render: (j: Journal) => j.description }, { key: "c", header: "Prepared by", hideOnMobile: true, render: (j: Journal) => j.created_by_label ?? "—" },
    { key: "a", header: "Amount", align: "right" as const, render: (j: Journal) => fmtMoney(j.total, currency) }, { key: "s", header: "Status", render: (j: Journal) => <StatusBadge status={j.status} /> },
  ];
  return (
    <>
      <PageHeader title="Approval centre" description="Journals waiting for an independent decision. You cannot approve a journal you prepared yourself (separation of duties) unless the organisation policy allows it." />
      <Panel title="Awaiting approval" flush className="mb-4"><QueryBoundary q={q}>{(d) => <DataTable caption="Awaiting approval" rows={d.items} rowKey={(j) => j.id} onRowClick={(j) => setOpen(j.id)} columns={cols} empty={<EmptyState title="Nothing waiting for approval" />} />}</QueryBoundary></Panel>
      <Panel title="Approved, ready to post" flush><QueryBoundary q={ready}>{(d) => <DataTable caption="Approved journals" rows={d.items} rowKey={(j) => j.id} onRowClick={(j) => setOpen(j.id)} columns={cols} empty={<EmptyState title="No approved journals waiting to be posted" />} />}</QueryBoundary></Panel>
      {open !== null && <JournalDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
