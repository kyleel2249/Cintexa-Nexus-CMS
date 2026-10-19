import { useState } from "react";
import { Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter, useUrlParams } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { dateOnly, num } from "@/lib/sales/format";
import { labelOf } from "@/lib/sales/labels";
import { PageHeader, Panel, TabBar, FilterBar, SearchBox, Select, Checkbox, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Drawer, ConfirmModal, DataTable, ProgressBar, Tag } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";

const KINDS = ["article", "script", "discovery", "objection", "framework", "template", "negotiation", "closing", "onboarding", "training", "coaching", "pricing", "faq"].map((value) => ({ value, label: labelOf(value) }));
const FLOW: Record<string, string[]> = { draft: ["review", "archived"], review: ["draft", "published", "archived"], published: ["review", "archived"], archived: ["draft"] };
interface Article { id: number; title: string; kind: string; audience_role: string | null; product_id: number | null; industry: string | null; segment: string | null; stage_name: string | null; status: string; version: number; is_training: boolean; published_at: string | null; updated_at: string; excerpt: string; completed: boolean }
type Tab = "library" | "training";

export default function PlaybookPage() {
  const [tabRaw, setTab] = useUrlFilter("tab", "library");
  const tab: Tab = tabRaw === "training" ? "training" : "library";
  return (
    <>
      <PageHeader title="Sales playbook & training" description="Approved scripts, objection handling and training. Edits to published content return it to review unless you may publish." />
      <TabBar<Tab> tabs={[{ key: "library", label: "Library" }, { key: "training", label: "Training progress" }]} value={tab} onChange={setTab} />
      {tab === "training" ? <Training /> : <Library />}
    </>
  );
}

function useFields(): FieldDef[] {
  const products = useSalesQuery<{ items: { id: number; name: string }[] }>("/products", { pageSize: 200 });
  return [
    { name: "title", label: "Title", required: true, wide: true }, { name: "kind", label: "Kind", type: "select", options: KINDS, required: true },
    { name: "product_id", label: "Product", type: "select", options: (products.data?.items ?? []).map((p) => ({ value: String(p.id), label: p.name })) },
    { name: "industry", label: "Industry" }, { name: "segment", label: "Segment" }, { name: "stage_name", label: "Pipeline stage" }, { name: "audience_role", label: "Audience role" },
    { name: "is_training", label: "This is a training item people must complete", type: "checkbox", wide: true },
    { name: "body", label: "Content", type: "textarea", rows: 12, required: true, wide: true, hint: "Plain text. Line breaks are kept." },
  ];
}

function Library() {
  const { can } = useSales();
  const st = useListState(["kind", "training", "status"]);
  const q = useList<Article>("/playbook", st);
  const [params, setParams] = useUrlParams();
  const [creating, setCreating] = useState(false);
  const fields = useFields();
  const write = can("playbook:write");
  const openId = params.get("id");
  return (
    <>
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search the playbook…" />
        <Select aria-label="Kind" className="w-44" value={st.filters.kind ?? ""} onChange={(e) => st.setFilter("kind", e.target.value)}><option value="">Kind: all</option>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
        {write && <Select aria-label="Status" className="w-36" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Not archived</option>{["draft", "review", "published", "archived"].map((s) => <option key={s} value={s}>{labelOf(s)}</option>)}</Select>}
        <Checkbox className="mb-0" label="Training only" checked={st.filters.training === "true"} onChange={(e) => st.setFilter("training", e.target.checked ? "true" : "")} />
        {write && <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New article</Button>}
      </FilterBar>
      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={6} /> : q.data.items.length === 0 ? <EmptyState title={st.hasFilters || st.q ? "Nothing matches" : "The playbook is empty"} description="Published articles appear here for the whole team." /> : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {q.data.items.map((a) => (
              <li key={a.id}><button type="button" onClick={() => setParams({ id: a.id }, { push: true })} className="block h-full w-full rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50">
                <div className="mb-1 flex flex-wrap items-center gap-2"><p className="font-medium">{a.title}</p>{a.status !== "published" && <StatusBadge status={a.status} />}{a.is_training && <Tag>Training</Tag>}{a.is_training && a.completed && <CheckCircle2 aria-label="Completed" className="h-4 w-4 text-emerald-500" />}</div>
                <p className="text-xs text-muted-foreground">{labelOf(a.kind)}{a.stage_name ? ` · ${a.stage_name}` : ""}{a.industry ? ` · ${a.industry}` : ""} · v{a.version} · updated {dateOnly(a.updated_at)}</p>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{a.excerpt}</p>
              </button></li>
            ))}
          </ul>
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} />
        </>
      )}
      <FormModal open={creating} onClose={() => setCreating(false)} size="xl" title="New article" description="Saved as a draft. Move it to review, then publish." success="Draft created" invalidate={["/playbook", "/training"]} fields={fields} initial={{ kind: "article" }} submit={(b) => sales.post("/playbook", b, { idempotent: true })} />
      {openId && <ArticleDrawer id={Number(openId)} fields={fields} onClose={() => setParams({ id: null }, { push: true })} />}
    </>
  );
}

interface ArticleDetail { article: Article & { body: string; product_name: string | null }; completion: { article_version: number; completed_at: string } | null; versions?: { version: number; title: string; saved_by: string; saved_at: string }[]; completionOutdated: boolean }

function ArticleDrawer({ id, fields, onClose }: { id: number; fields: FieldDef[]; onClose: () => void }) {
  const { can } = useSales();
  const q = useSalesQuery<ArticleDetail>(`/playbook/${id}`);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const status = useSalesMutation((s: string) => sales.post(`/playbook/${id}/status`, { status: s }), { invalidate: ["/playbook", "/training"], success: "Status updated", onSuccess: () => setArchiving(false) });
  const complete = useSalesMutation(() => sales.post(`/playbook/${id}/complete`), { invalidate: ["/playbook", "/training"], success: "Marked as completed" });
  const a = q.data?.article;
  const write = can("playbook:write");
  return (
    <Drawer open onClose={onClose} title={a?.title ?? "Article"} subtitle={a ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status={a.status} /><span>{labelOf(a.kind)} · v{a.version}</span></span> : undefined}>
      {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data || !a ? <Skeleton rows={8} /> : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{[a.product_name, a.industry, a.segment, a.stage_name, a.audience_role].filter(Boolean).join(" · ")}</p>
          <article className="whitespace-pre-wrap break-words text-sm leading-relaxed">{a.body}</article>
          {a.is_training && a.status === "published" && (
            <div className="rounded-md border p-3 text-sm">
              {q.data.completion && !q.data.completionOutdated ? <p className="flex items-center gap-2 text-emerald-500"><CheckCircle2 className="h-4 w-4" />Completed on {dateOnly(q.data.completion.completed_at)}</p> : <>
                {q.data.completion && q.data.completionOutdated && <p className="mb-2 text-amber-500">This item changed since you completed it (v{q.data.completion.article_version}). Please review and complete again.</p>}
                <Button size="sm" disabled={complete.pending} onClick={() => void complete.run()}>Mark as completed</Button></>}
              {complete.error && <p role="alert" className="mt-2 text-rose-500">{complete.error.message}</p>}
            </div>
          )}
          {write && <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={a.status === "archived"}>Edit</Button>
            {(FLOW[a.status] ?? []).filter((s) => s !== "published" || can("playbook:publish")).map((s) => s === "archived" ? <Button key={s} size="sm" variant="ghost" className="text-rose-500" onClick={() => setArchiving(true)}>Archive</Button> : <Button key={s} size="sm" variant={s === "published" ? "default" : "outline"} disabled={status.pending} onClick={() => void status.run(s)}>{s === "published" ? "Publish" : s === "review" ? "Send to review" : "Back to draft"}</Button>)}
            {status.error && <p role="alert" className="w-full text-sm text-rose-500">{status.error.message}</p>}
          </div>}
          {q.data.versions && q.data.versions.length > 0 && <Panel title="Version history"><ul className="space-y-1 text-sm">{q.data.versions.map((v) => <li key={v.version} className="flex justify-between"><span>v{v.version} · {v.title}</span><span className="text-muted-foreground">{v.saved_by} · {dateOnly(v.saved_at)}</span></li>)}</ul></Panel>}
        </div>
      )}
      {editing && a && <FormModal open size="xl" onClose={() => setEditing(false)} title="Edit article" initial={a} nullEmpty success="Saved" invalidate={["/playbook"]} fields={fields} submit={(b) => sales.patch(`/playbook/${id}`, b)} />}
      <ConfirmModal open={archiving} onClose={() => setArchiving(false)} title="Archive article?" message="Archived articles are hidden from everyone. You can restore it to draft later." confirmLabel="Archive" danger pending={status.pending} onConfirm={() => void status.run("archived")} />
    </Drawer>
  );
}

function Training() {
  const q = useSalesQuery<{ totalCourses: number; items: { member_id: number; display_name: string; completed: number; total: number; percent: number | null }[] }>("/training/progress");
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton />;
  return (
    <Panel title={`${num(q.data.totalCourses)} published training item${q.data.totalCourses === 1 ? "" : "s"}`} flush>
      <DataTable caption="Training progress" rows={q.data.items} rowKey={(r) => r.member_id} empty={<EmptyState title="No one to show" />} columns={[
        { key: "n", header: "Person", render: (r: { display_name: string }) => r.display_name },
        { key: "p", header: "Progress", render: (r: { percent: number | null; completed: number; total: number }) => r.percent === null ? <span className="text-muted-foreground">No training published</span> : <div className="flex items-center gap-2"><div className="w-32"><ProgressBar value={r.percent} tone={r.percent >= 100 ? "success" : undefined} /></div><span className="text-xs text-muted-foreground">{r.completed}/{r.total}</span></div> },
      ]} />
    </Panel>
  );
}
