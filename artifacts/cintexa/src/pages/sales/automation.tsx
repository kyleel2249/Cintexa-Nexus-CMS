import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { dateTime, titleCase } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, Select, Input, Textarea, Field, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Modal, ConfirmModal, Tag } from "@/components/sales/ui";
import { RowsEditor } from "@/components/sales/RowsEditor";

interface Meta { triggers: { key: string; entity: string; scheduled: boolean }[]; actions: { key: string; sensitive: boolean }[]; operators: string[]; updatableFields: Record<string, string[]>; enabled: boolean; limits: { maxDepth: number; maxRunsPerRecordPerDay: number }; messaging: { email: boolean; whatsapp: boolean }; notes: string[] }
interface Cond { field: string; op: string; value?: unknown }
interface Act { type: string; params: Record<string, unknown> }
interface Rule { id: number; name: string; description: string | null; trigger: string; status: string; version: number; requires_approval: boolean; approved_by: string | null; max_attempts: number; conditions: Cond[]; actions: Act[]; runs: number; problems: number; updated_at: string }
interface Run { id: number; rule_id: number; rule_name: string; rule_version: number; trigger: string; entity_type: string; entity_id: number; status: string; attempts: number; error: string | null; is_test: boolean; started_at: string | null }
type Tab = "rules" | "runs";

export default function AutomationPage() {
  const [tabRaw, setTab] = useUrlFilter("tab", "rules");
  const tab: Tab = tabRaw === "runs" ? "runs" : "rules";
  const meta = useSalesQuery<Meta>("/automation/meta");
  return (
    <>
      <PageHeader title="Sales automation" description="Rules run only for events inside your sales data. Messaging and integration actions need a connected provider, recorded consent, and activation by a second person." />
      {meta.data && !meta.data.enabled && <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">Automation is switched off in Sales Settings. Rules can be edited but will not run.</p>}
      <TabBar<Tab> tabs={[{ key: "rules", label: "Rules" }, { key: "runs", label: "Run history" }]} value={tab} onChange={setTab} />
      {tab === "runs" ? <Runs /> : <Rules meta={meta.data} />}
    </>
  );
}

function summary(r: Rule): string { return r.actions.map((a) => titleCase(a.type)).join(" → "); }

function Rules({ meta }: { meta?: Meta }) {
  const { can } = useSales();
  const q = useSalesQuery<{ items: Rule[] }>("/automation/rules");
  const [edit, setEdit] = useState<Rule | "new" | null>(null);
  const [test, setTest] = useState<{ rule: Rule; run: boolean } | null>(null);
  const [del, setDel] = useState<Rule | null>(null);
  const activate = useSalesMutation((r: Rule) => sales.post(`/automation/rules/${r.id}/activate`), { invalidate: ["/automation"], success: "Rule activated" });
  const pause = useSalesMutation((r: Rule) => sales.post(`/automation/rules/${r.id}/pause`), { invalidate: ["/automation"], success: "Rule paused" });
  const remove = useSalesMutation((r: Rule) => sales.del(`/automation/rules/${r.id}`), { invalidate: ["/automation"], success: "Rule archived", onSuccess: () => setDel(null) });
  const write = can("automation:write");
  const err = activate.error ?? pause.error;
  return (
    <>
      {write && <div className="mb-4 flex justify-end"><Button size="sm" onClick={() => setEdit("new")}><Plus className="mr-1.5 h-3.5 w-3.5" />New rule</Button></div>}
      {err && <p role="alert" className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{err.message}</p>}
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={5} /> : (
          <DataTable caption="Automation rules" rows={q.data.items} rowKey={(r) => r.id} empty={<EmptyState title="No automation rules" description="Create a rule such as “notify the owner when a lead is uncontacted”. New and edited rules start as drafts." />}
            columns={[{ key: "n", header: "Rule", render: (r: Rule) => <div><p className="font-medium">{r.name} <Tag>v{r.version}</Tag></p><p className="text-xs text-muted-foreground">When {titleCase(r.trigger)} · {summary(r)}</p></div> },
              { key: "s", header: "Status", render: (r: Rule) => <div className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.requires_approval && r.status !== "active" && <Tag>Needs 2nd person</Tag>}</div> },
              { key: "r", header: "Runs", align: "right", hideOnMobile: true, render: (r: Rule) => <span>{r.runs}{r.problems > 0 && <span className="ml-1 text-rose-500">({r.problems} failed)</span>}</span> },
              { key: "x", header: "", render: (r: Rule) => (
                <span className="flex flex-wrap justify-end gap-1">
                  {write && <Button size="sm" variant="ghost" onClick={() => setTest({ rule: r, run: false })}>Test</Button>}
                  {can("automation:run") && r.status === "active" && <Button size="sm" variant="ghost" onClick={() => setTest({ rule: r, run: true })}>Run</Button>}
                  {can("automation:activate") && (r.status === "active" ? <Button size="sm" variant="ghost" disabled={pause.pending} onClick={() => void pause.run(r)}>Pause</Button> : <Button size="sm" variant="ghost" disabled={activate.pending} onClick={() => void activate.run(r)}>Activate</Button>)}
                  {write && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>}
                  {write && <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDel(r)}>Delete</Button>}
                </span>) }]} />
        )}
      </Panel>
      {edit && meta && <RuleModal meta={meta} rule={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
      {test && <TestModal rule={test.rule} run={test.run} onClose={() => setTest(null)} />}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} title="Archive rule?" message="The rule stops running; its run history is kept." confirmLabel="Archive" danger pending={remove.pending} onConfirm={() => del && void remove.run(del)} />
    </>
  );
}

function parseValue(s: string, op: string): unknown {
  if (op === "is_set" || op === "is_empty") return undefined;
  if (op === "in") return s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.trim() !== "" && /^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s);
  return s;
}
const showValue = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v));

interface CondDraft { field: string; op: string; value: string }
interface ActDraft { type: string; a: string; b: string }

/** First/second param slots per action type, mapped to the params the server validates. */
const ACTION_UI: Record<string, { a?: { key: string; label: string; kind?: "text" | "number" | "select"; options?: string[] }; b?: { key: string; label: string; kind?: "text" | "number" | "select"; options?: string[] } }> = {
  create_task: { a: { key: "subject", label: "Task subject" }, b: { key: "dueInDays", label: "Due in days", kind: "number" } },
  create_reminder: { a: { key: "subject", label: "Reminder text" }, b: { key: "dueInDays", label: "Due in days", kind: "number" } },
  assign: { a: { key: "to", label: "Assign to", kind: "select", options: ["round_robin", "territory"] } },
  notify: { a: { key: "title", label: "Title" }, b: { key: "body", label: "Message" } },
  update_field: { a: { key: "field", label: "Field" }, b: { key: "value", label: "New value" } },
  add_tag: { a: { key: "tag", label: "Tag" } },
  send_message: { a: { key: "channel", label: "Channel", kind: "select", options: ["email", "whatsapp"] }, b: { key: "template", label: "Message template" } },
  call_integration: { a: { key: "name", label: "Integration name" } },
  generate_report: { a: { key: "report", label: "Report key" } },
  escalate: { a: { key: "to", label: "Escalate to", kind: "select", options: ["manager", "director"] } },
  request_approval: {},
};

function toDraft(a: Act): ActDraft {
  const ui = ACTION_UI[a.type] ?? {};
  return { type: a.type, a: ui.a ? showValue(a.params[ui.a.key]) : "", b: ui.b ? showValue(a.params[ui.b.key]) : "" };
}
function fromDraft(d: ActDraft): Act {
  const ui = ACTION_UI[d.type] ?? {};
  const params: Record<string, unknown> = {};
  const set = (slot: NonNullable<typeof ui.a>, raw: string) => {
    if (raw === "") return;
    params[slot.key] = slot.kind === "number" ? Number(raw) : slot.key === "to" && /^\d+$/.test(raw) ? Number(raw) : slot.key === "value" ? parseValue(raw, "eq") : raw;
  };
  if (ui.a) set(ui.a, d.a);
  if (ui.b) set(ui.b, d.b);
  return { type: d.type, params };
}

function RuleModal({ meta, rule, onClose }: { meta: Meta; rule?: Rule; onClose: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [desc, setDesc] = useState(rule?.description ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? meta.triggers[0]?.key ?? "");
  const [conds, setConds] = useState<CondDraft[]>((rule?.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: showValue(c.value) })));
  const [acts, setActs] = useState<ActDraft[]>((rule?.actions ?? [{ type: "notify", params: {} }]).map(toDraft));
  const [attempts, setAttempts] = useState(String(rule?.max_attempts ?? 3));
  const entity = meta.triggers.find((t) => t.key === trigger)?.entity ?? "";
  const fields = meta.updatableFields[entity] ?? [];
  const body = useMemo(() => ({ name: name.trim(), description: desc.trim() || undefined, trigger, conditions: conds.map((c) => ({ field: c.field.trim(), op: c.op, ...(parseValue(c.value, c.op) !== undefined ? { value: parseValue(c.value, c.op) } : {}) })), actions: acts.map(fromDraft), max_attempts: Number(attempts) || 3 }), [name, desc, trigger, conds, acts, attempts]);
  const save = useSalesMutation(() => (rule ? sales.patch(`/automation/rules/${rule.id}`, body) : sales.post("/automation/rules", body, { idempotent: true })), { invalidate: ["/automation"], success: rule ? "Saved as a new draft version. Re-activate it to use it." : "Rule created as a draft", onSuccess: onClose });
  const sensitive = acts.some((a) => meta.actions.find((x) => x.key === a.type)?.sensitive);
  const issues = save.error?.issues ?? [];
  return (
    <Modal open onClose={onClose} size="xl" title={rule ? `Edit ${rule.name}` : "New automation rule"} description="Changes create a new version and return the rule to draft."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || name.trim().length < 3 || acts.length === 0} onClick={() => void save.run()}>{save.pending ? "Saving…" : "Save draft"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="When this happens"><Select value={trigger} onChange={(e) => { setTrigger(e.target.value); }}>{meta.triggers.map((t) => <option key={t.key} value={t.key}>{titleCase(t.key)}{t.scheduled ? " (daily check)" : ""}</option>)}</Select></Field>
        <Field label="Retry attempts"><Input type="number" min={1} max={10} value={attempts} onChange={(e) => setAttempts(e.target.value)} /></Field>
      </div>
      <p className="mb-2 mt-5 text-sm font-medium">Only if (optional)</p>
      <RowsEditor rows={conds} onChange={setConds} blank={() => ({ field: "", op: "eq", value: "" })} addLabel="Add condition" emptyText="Runs for every matching event." render={(c, up) => (<>
        <Input aria-label="Field" placeholder="field e.g. score" value={c.field} onChange={(e) => up({ field: e.target.value })} />
        <Select aria-label="Operator" value={c.op} onChange={(e) => up({ op: e.target.value })}>{meta.operators.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</Select>
        {c.op !== "is_set" && c.op !== "is_empty" && <Input aria-label="Value" placeholder={c.op === "in" ? "a, b, c" : "value"} value={c.value} onChange={(e) => up({ value: e.target.value })} />}</>)} />
      <p className="mb-2 mt-5 text-sm font-medium">Do this</p>
      <RowsEditor rows={acts} onChange={setActs} blank={() => ({ type: "notify", a: "", b: "" })} addLabel="Add action" render={(a, up) => {
        const ui = ACTION_UI[a.type] ?? {};
        const slot = (s: NonNullable<typeof ui.a>, k: "a" | "b") => s.kind === "select" || (a.type === "update_field" && s.key === "field") ? (
          <Select aria-label={s.label} value={a[k]} onChange={(e) => up({ [k]: e.target.value } as Partial<ActDraft>)}><option value="">{s.label}…</option>{(s.options ?? fields).map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</Select>
        ) : <Input aria-label={s.label} placeholder={s.label} type={s.kind === "number" ? "number" : "text"} value={a[k]} onChange={(e) => up({ [k]: e.target.value } as Partial<ActDraft>)} />;
        return (<>
          <Select aria-label="Action" value={a.type} onChange={(e) => up({ type: e.target.value, a: "", b: "" })}>{meta.actions.map((x) => <option key={x.key} value={x.key}>{titleCase(x.key)}{x.sensitive ? " *" : ""}</option>)}</Select>
          {ui.a && slot(ui.a, "a")}{ui.b && slot(ui.b, "b")}</>);
      }} />
      {a_note(sensitive, meta)}
      {save.error && <div role="alert" className="mt-3 text-sm text-rose-500"><p>{save.error.message}</p>{issues.length > 0 && <ul className="list-disc pl-5">{issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}</div>}
    </Modal>
  );
}
function a_note(sensitive: boolean, meta: Meta) {
  return (
    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
      {sensitive && <p>* This rule can message customers, call integrations or request approvals, so a different person must activate it.</p>}
      <p>Email {meta.messaging.email ? "is connected" : "is not connected"} · WhatsApp {meta.messaging.whatsapp ? "is connected" : "is not connected"}. Messages go only to recipients with recorded consent.</p>
    </div>
  );
}

function TestModal({ rule, run, onClose }: { rule: Rule; run: boolean; onClose: () => void }) {
  const [id, setId] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const m = useSalesMutation(() => sales.post(`/automation/rules/${rule.id}/${run ? "run" : "test"}`, { entity_id: Number(id) }), { invalidate: ["/automation"], success: run ? "Run queued" : undefined, onSuccess: (r) => setResult(r) });
  return (
    <Modal open onClose={onClose} size="lg" title={run ? `Run “${rule.name}” now` : `Test “${rule.name}”`} description={run ? "Runs the active rule once for one record, honouring its conditions." : "A dry run: shows what the rule would do for a record without changing anything."}
      footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!/^\d+$/.test(id) || m.pending} onClick={() => { setResult(null); void m.run(); }}>{run ? "Run" : "Test"}</Button></>}>
      <Field label={`${titleCase(rule.trigger.split(".")[0] ?? "record")} ID`} required><Input inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} /></Field>
      {m.error && <p role="alert" className="mt-2 text-sm text-rose-500">{m.error.message}</p>}
      <ResultView result={result} />
    </Modal>
  );
}
function ResultView({ result }: { result: any }) {
  if (!result) return null;
  return (
    <div className="mt-4 space-y-2 text-sm">
      {typeof result.matches === "boolean" && <p><StatusBadge status={result.matches ? "success" : "skipped"} label={result.matches ? "Conditions met" : "Conditions not met"} /></p>}
      {result.conditions?.map((c: any, i: number) => <p key={i} className="text-muted-foreground">{c.passed ? "✓" : "✗"} {c.field} {c.op} {showValue(c.value)}</p>)}
      {result.plan?.map((p: any, i: number) => <pre key={i} className="overflow-auto rounded bg-secondary p-2 text-xs">{p.action}: {JSON.stringify(p.params)}</pre>)}
      {result.note && <p className="text-muted-foreground">{result.note}</p>}
    </div>
  );
}

const RUN_STATUS = ["running", "success", "failed", "skipped", "retrying", "dead"];

function Runs() {
  const { can } = useSales();
  const st = useListState(["status", "rule_id"]);
  const q = useList<Run>("/automation/runs", st);
  const retry = useSalesMutation((r: Run) => sales.post(`/automation/runs/${r.id}/retry`), { invalidate: ["/automation/runs"], success: "Retry queued" });
  return (
    <>
      <FilterBar>
        <Select aria-label="Status" className="w-40" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{RUN_STATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={6} /> : (
          <><DataTable caption="Automation runs" rows={q.data.items} rowKey={(r) => r.id} empty={<EmptyState title="No runs yet" description="Runs appear when an active rule fires." />}
            columns={[{ key: "r", header: "Rule", render: (r: Run) => <div><p className="font-medium">{r.rule_name} <Tag>v{r.rule_version}</Tag>{r.is_test && <Tag>Test</Tag>}</p><p className="text-xs text-muted-foreground">{titleCase(r.entity_type)} #{r.entity_id}</p></div> },
              { key: "s", header: "Status", render: (r: Run) => <StatusBadge status={r.status} /> }, { key: "a", header: "Attempts", align: "right", hideOnMobile: true, render: (r: Run) => r.attempts },
              { key: "e", header: "Error", hideOnMobile: true, render: (r: Run) => <span className="text-xs text-rose-500">{r.error ?? ""}</span> }, { key: "t", header: "Started", hideOnMobile: true, render: (r: Run) => (r.started_at ? dateTime(r.started_at) : "—") },
              { key: "x", header: "", render: (r: Run) => can("automation:run") && (r.status === "failed" || r.status === "dead") ? <Button size="sm" variant="ghost" disabled={retry.pending} onClick={() => void retry.run(r)}>Retry</Button> : null }]} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
    </>
  );
}
