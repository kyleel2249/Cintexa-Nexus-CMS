import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales, SALES_LOCAL_MODE } from "@/lib/sales/api";
import { backupLocalData, restoreLocalData, eraseLocalData, localStatus } from "@/lib/sales/local/runtime";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { dateTime, titleCase } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, Select, Input, Field, Textarea, Checkbox, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Modal, KpiCard, Tag } from "@/components/sales/ui";
import { ExportButton } from "@/components/sales/actions";

type Tab = "settings" | "integrations" | "audit" | "ai" | "data";
type Kind = "int" | "number" | "text" | "bool" | "select" | "money" | "tags" | "textarea" | "record";
interface Spec { path: string; label: string; kind: Kind; options?: { value: string; label: string }[]; hint?: string; min?: number; max?: number; step?: number }
interface Section { key: string; title: string; description: string; fields: Spec[] }

const opts = (xs: string[]) => xs.map((value) => ({ value, label: titleCase(value) }));

const SECTIONS: Section[] = [
  { key: "business", title: "Business", description: "Currency, locale and time zone drive every report range, date and money display.", fields: [
    { path: "currency", label: "Currency (ISO code)", kind: "text", hint: "e.g. USD, EUR, GHS" }, { path: "timezone", label: "Time zone (IANA)", kind: "text", hint: "e.g. Africa/Accra" }, { path: "locale", label: "Locale", kind: "text", hint: "e.g. en-US" },
    { path: "rounding", label: "Rounding", kind: "select", options: opts(["half_up", "half_even"]) }, { path: "weekStartsOn", label: "Week starts on", kind: "select", options: [{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }] }, { path: "fiscalYearStartMonth", label: "Fiscal year starts (month 1–12)", kind: "int", min: 1, max: 12 }] },
  { key: "numbering", title: "Numbering", description: "Prefixes for record numbers. Existing numbers are never rewritten.", fields: [
    { path: "leadPrefix", label: "Lead prefix", kind: "text" }, { path: "accountPrefix", label: "Account prefix", kind: "text" }, { path: "opportunityPrefix", label: "Opportunity prefix", kind: "text" }, { path: "quotationPrefix", label: "Quotation prefix", kind: "text" }, { path: "orderPrefix", label: "Order prefix", kind: "text" }, { path: "yearly", label: "Restart numbering every year", kind: "bool" }] },
  { key: "leads", title: "Leads & scoring", description: "Assignment, response SLA, duplicate detection and the scoring model (every score is explained on the lead).", fields: [
    { path: "assignment", label: "Default assignment", kind: "select", options: opts(["manual", "round_robin", "territory"]) }, { path: "responseSlaHours", label: "First-response SLA (hours)", kind: "number", min: 1, max: 720 }, { path: "followUpDays", label: "Default follow-up (days)", kind: "int", min: 0, max: 90 },
    { path: "dedupe.matchEmail", label: "Duplicate check: email", kind: "bool" }, { path: "dedupe.matchPhone", label: "Duplicate check: phone", kind: "bool" }, { path: "dedupe.matchCompany", label: "Duplicate check: company", kind: "bool" }, { path: "dedupe.nameSimilarity", label: "Name similarity (0.5–1)", kind: "number", min: 0.5, max: 1, step: 0.01 },
    { path: "scoring.hasEmail", label: "Points: has email", kind: "int", min: 0, max: 50 }, { path: "scoring.hasPhone", label: "Points: has phone", kind: "int", min: 0, max: 50 }, { path: "scoring.hasCompany", label: "Points: has company", kind: "int", min: 0, max: 50 }, { path: "scoring.hasJobTitle", label: "Points: has job title", kind: "int", min: 0, max: 50 },
    { path: "scoring.budgetKnown", label: "Points: budget known", kind: "int", min: 0, max: 50 }, { path: "scoring.highBudgetThreshold", label: "High-budget threshold", kind: "money" }, { path: "scoring.highBudget", label: "Points: high budget", kind: "int", min: 0, max: 50 },
    { path: "scoring.decisionMakerTitles", label: "Decision-maker titles", kind: "tags", hint: "Comma separated" }, { path: "scoring.decisionMaker", label: "Points: decision maker", kind: "int", min: 0, max: 50 }, { path: "scoring.consent", label: "Points: email consent", kind: "int", min: 0, max: 50 },
    { path: "scoring.recentContactDays", label: "Recent contact window (days)", kind: "int", min: 1, max: 90 }, { path: "scoring.recentContact", label: "Points: recent contact", kind: "int", min: 0, max: 50 }, { path: "scoring.staleDays", label: "Stale after (days)", kind: "int", min: 1, max: 365 }, { path: "scoring.stalePenalty", label: "Stale penalty", kind: "int", min: 0, max: 50 },
    { path: "scoring.sourceWeights", label: "Source points", kind: "record", min: 0, max: 50 }] },
  { key: "discounts", title: "Discounts & credit", description: "Discounts above a role's limit need approval from the next level. Limits must rise: representative ≤ manager ≤ director.", fields: [
    { path: "repMaxPercent", label: "Representative max discount %", kind: "number", min: 0, max: 100 }, { path: "managerMaxPercent", label: "Manager max discount %", kind: "number", min: 0, max: 100 }, { path: "directorMaxPercent", label: "Director max discount %", kind: "number", min: 0, max: 100 },
    { path: "minMarginPercent", label: "Minimum margin %", kind: "number", min: 0, max: 100 }, { path: "creditCheck", label: "Enforce account credit limits on orders", kind: "bool" }] },
  { key: "quotations", title: "Quotations", description: "Defaults for new quotations.", fields: [{ path: "validityDays", label: "Validity (days)", kind: "int", min: 1, max: 365 }, { path: "expiryReminderDays", label: "Expiry reminder (days before)", kind: "int", min: 0, max: 60 }, { path: "defaultTerms", label: "Default terms", kind: "textarea" }] },
  { key: "orders", title: "Orders", description: "When an order needs approval before it can be confirmed.", fields: [{ path: "approvalThreshold", label: "Approval threshold (order total)", kind: "money" }, { path: "requireApprovalBelowMargin", label: "Require approval when below minimum margin", kind: "bool" }] },
  { key: "pipeline", title: "Pipeline", description: "", fields: [{ path: "requireCloseDate", label: "Require an expected close date on open opportunities", kind: "bool" }] },
  { key: "retention", title: "Retention", description: "Thresholds behind account health. At-risk days cannot exceed inactive days.", fields: [
    { path: "inactiveDays", label: "Inactive after (days)", kind: "int", min: 1, max: 1825 }, { path: "atRiskDays", label: "At risk after (days)", kind: "int", min: 1, max: 1825 }, { path: "reorderLeadDays", label: "Reorder reminder lead (days)", kind: "int", min: 0, max: 120 }, { path: "complaintWeight", label: "Complaint weight", kind: "int", min: 0, max: 100 }] },
  { key: "commissions", title: "Commissions", description: "", fields: [{ path: "defaultBasis", label: "Default basis", kind: "select", options: opts(["booked", "invoiced", "collected"]) }, { path: "autoCalculate", label: "Calculate commission automatically", kind: "bool" }] },
  { key: "forecast", title: "Forecasting", description: "Statistical forecasts are suppressed below these data thresholds instead of guessing.", fields: [
    { path: "minimumClosedDeals", label: "Minimum closed deals", kind: "int", min: 1, max: 1000 }, { path: "seasonalityMinMonths", label: "Months of history for seasonality", kind: "int", min: 12, max: 120 }, { path: "bestCaseUplift", label: "Best-case uplift (0–5)", kind: "number", min: 0, max: 5, step: 0.1 }, { path: "worstCaseHaircut", label: "Worst-case haircut (0–1)", kind: "number", min: 0, max: 1, step: 0.05 }] },
  { key: "attribution", title: "Campaign attribution", description: "", fields: [{ path: "model", label: "Model", kind: "select", options: opts(["first_touch", "last_touch", "linear"]) }, { path: "windowDays", label: "Window (days)", kind: "int", min: 1, max: 730 }] },
  { key: "notifications", title: "Notifications", description: "In-app notifications only.", fields: [{ path: "enabled", label: "Enable notifications", kind: "bool" }, { path: "targetAtRisk", label: "Target at risk", kind: "bool" }, { path: "overdueFollowUps", label: "Overdue follow-ups", kind: "bool" }, { path: "expiringQuotations", label: "Expiring quotations", kind: "bool" }] },
  { key: "automation", title: "Automation limits", description: "Guard rails that stop runaway rules.", fields: [{ path: "enabled", label: "Enable automation", kind: "bool" }, { path: "maxDepth", label: "Max chained rules", kind: "int", min: 1, max: 5 }, { path: "maxRunsPerRecordPerDay", label: "Max runs per record per day", kind: "int", min: 1, max: 500 }, { path: "runLeaseSeconds", label: "Run lease (seconds)", kind: "int", min: 10, max: 3600 }] },
  { key: "integrations", title: "Integrations", description: "Switching an integration on does nothing unless a provider adapter is installed on the server; the Integrations tab shows the real state.", fields: [
    { path: "inventory.enabled", label: "Inventory: enabled", kind: "bool" }, { path: "inventory.provider", label: "Inventory: provider", kind: "text" }, { path: "finance.enabled", label: "Finance: enabled", kind: "bool" }, { path: "finance.provider", label: "Finance: provider", kind: "text" },
    { path: "email.enabled", label: "Email: enabled", kind: "bool" }, { path: "email.provider", label: "Email: provider", kind: "text" }, { path: "email.fromAddress", label: "Email: from address", kind: "text" }, { path: "whatsapp.enabled", label: "WhatsApp: enabled", kind: "bool" }, { path: "whatsapp.provider", label: "WhatsApp: provider", kind: "text" },
    { path: "calendar.enabled", label: "Calendar: enabled", kind: "bool" }, { path: "esignature.enabled", label: "E-signature: enabled", kind: "bool" },
    { path: "ai.enabled", label: "AI assist: enabled", kind: "bool" }, { path: "ai.allowExternalProvider", label: "AI: allow an external provider to receive CRM text", kind: "bool", hint: "Off keeps all text inside your own infrastructure." }] },
  { key: "archival", title: "Archival", description: "", fields: [{ path: "archiveClosedAfterDays", label: "Archive closed records after (days)", kind: "int", min: 30, max: 3650 }, { path: "purgeOutboxAfterDays", label: "Purge finished outbox rows after (days)", kind: "int", min: 7, max: 3650 }] },
];

function getPath(o: any, path: string): unknown { return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o); }
function setPath(o: any, path: string, v: unknown): void {
  const ks = path.split(".");
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) { cur[ks[i]!] = cur[ks[i]!] ?? {}; cur = cur[ks[i]!]; }
  cur[ks[ks.length - 1]!] = v;
}

export default function SettingsPage() {
  const { can } = useSales();
  const [tabRaw, setTab] = useUrlFilter("tab", "settings");
  const tabs: { key: Tab; label: string }[] = [{ key: "settings", label: "Settings" }, { key: "integrations", label: "Integrations & queue" }, ...(can("audit:read") ? [{ key: "audit" as Tab, label: "Audit log" }] : []), ...(can("ai:use") ? [{ key: "ai" as Tab, label: "AI assist" }] : []), ...(SALES_LOCAL_MODE ? [{ key: "data" as Tab, label: "Data & backup" }] : [])];
  const tab = (tabs.some((t) => t.key === tabRaw) ? tabRaw : "settings") as Tab;
  return (
    <>
      <PageHeader title="Sales settings" description="Every change is validated, versioned and written to the audit log." />
      <TabBar<Tab> tabs={tabs} value={tab} onChange={setTab} />
      {tab === "integrations" ? <Integrations /> : tab === "audit" ? <Audit /> : tab === "ai" ? <AiStatus /> : tab === "data" ? <DataTab /> : <SettingsTab />}
    </>
  );
}

interface SettingsData { settings: Record<string, any>; versions: { key: string; version: number; updated_by: string | null; updated_at: string }[]; sections: string[]; providers: Record<string, boolean> }

function SettingsTab() {
  const { can, reload } = useSales();
  const q = useSalesQuery<SettingsData>("/settings");
  const [key, setKey] = useUrlFilter("section", "business");
  const [history, setHistory] = useState(false);
  const section = SECTIONS.find((s) => s.key === key) ?? SECTIONS[0]!;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton rows={8} />;
  const ver = q.data.versions.find((v) => v.key === section.key);
  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col">
        {SECTIONS.map((s) => <button key={s.key} type="button" onClick={() => setKey(s.key)} aria-current={s.key === section.key ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors ${s.key === section.key ? "bg-primary/10 font-medium text-primary" : "hover:bg-secondary"}`}>{s.title}</button>)}
      </nav>
      <Panel title={section.title} description={section.description} actions={<Button size="sm" variant="ghost" onClick={() => setHistory(true)}>History{ver ? ` (v${ver.version})` : ""}</Button>}>
        <SectionForm key={section.key + (ver?.version ?? 0)} section={section} value={q.data.settings[section.key]} editable={can("settings:write")} onSaved={() => { void q.refetch(); reload(); }} />
        {ver && <p className="mt-4 text-xs text-muted-foreground">Last changed by {ver.updated_by ?? "—"} on {dateTime(ver.updated_at)}</p>}
      </Panel>
      {history && <HistoryModal section={section} onClose={() => setHistory(false)} />}
    </div>
  );
}

function SectionForm({ section, value, editable, onSaved }: { section: Section; value: any; editable: boolean; onSaved: () => void }) {
  const init = useMemo(() => {
    const m: Record<string, string> = {};
    const add = (path: string, v: unknown) => { m[path] = Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v); };
    for (const f of section.fields) {
      if (f.kind === "record") for (const [k, v] of Object.entries((getPath(value, f.path) as Record<string, unknown>) ?? {})) add(`${f.path}.${k}`, v);
      else add(f.path, getPath(value, f.path));
    }
    return m;
  }, [section, value]);
  const [vals, setVals] = useState(init);
  useEffect(() => setVals(init), [init]);
  const dirty = JSON.stringify(vals) !== JSON.stringify(init);
  const [warnings, setWarnings] = useState<string[]>([]);
  const save = useSalesMutation(() => {
    const out = structuredClone(value ?? {});
    for (const f of section.fields) {
      const conv = (path: string, kind: Kind) => {
        const raw = vals[path] ?? "";
        if (kind === "int" || kind === "number") return Number(raw);
        if (kind === "bool") return raw === "true";
        if (kind === "tags") return raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
        if (kind === "select" && (path === "weekStartsOn")) return Number(raw);
        return raw;
      };
      if (f.kind === "record") for (const k of Object.keys((getPath(value, f.path) as object) ?? {})) setPath(out, `${f.path}.${k}`, Number(vals[`${f.path}.${k}`]));
      else setPath(out, f.path, conv(f.path, f.kind));
    }
    return sales.put<{ warnings: string[] }>(`/settings/${section.key}`, out);
  }, { invalidate: ["/settings", "/me"], success: "Settings saved", onSuccess: (r) => { setWarnings(r?.warnings ?? []); onSaved(); } });
  const set = (path: string, v: string) => setVals((s) => ({ ...s, [path]: v }));
  const render = (f: Spec, path: string, label = f.label) => {
    const v = vals[path] ?? "";
    const id = `set-${path}`;
    if (f.kind === "bool") return <Checkbox key={path} label={label} disabled={!editable} checked={v === "true"} onChange={(e) => set(path, String(e.target.checked))} />;
    return (
      <Field key={path} label={label} hint={f.hint} className={f.kind === "textarea" || f.kind === "tags" ? "sm:col-span-2" : undefined}>
        {f.kind === "select" ? <Select id={id} disabled={!editable} value={v} onChange={(e) => set(path, e.target.value)}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          : f.kind === "textarea" ? <Textarea id={id} rows={4} disabled={!editable} value={v} onChange={(e) => set(path, e.target.value)} />
          : <Input id={id} disabled={!editable} type={f.kind === "int" || f.kind === "number" ? "number" : "text"} min={f.min} max={f.max} step={f.step ?? (f.kind === "int" ? 1 : "any")} value={v} onChange={(e) => set(path, e.target.value)} />}
      </Field>
    );
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (editable) void save.run(); }}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {section.fields.map((f) => f.kind === "record"
          ? <div key={f.path} className="sm:col-span-2"><p className="mb-2 text-sm font-medium">{f.label}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.keys((getPath(value, f.path) as object) ?? {}).map((k) => render({ ...f, kind: "int" }, `${f.path}.${k}`, titleCase(k)))}</div></div>
          : render(f, f.path))}
      </div>
      {warnings.map((w) => <p key={w} className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{w}</p>)}
      {save.error && <div role="alert" className="mt-3 text-sm text-rose-500"><p>{save.error.message}</p>{save.error.issues.length > 0 && <ul className="list-disc pl-5">{save.error.issues.map((i, k) => <li key={k}>{i.path ? `${i.path}: ` : ""}{i.message}</li>)}</ul>}</div>}
      {editable ? <div className="mt-5 flex gap-2"><Button type="submit" disabled={!dirty || save.pending}>{save.pending ? "Saving…" : "Save changes"}</Button><Button type="button" variant="outline" disabled={!dirty} onClick={() => setVals(init)}>Reset</Button></div> : <p className="mt-4 text-sm text-muted-foreground">You can view these settings but not change them.</p>}
    </form>
  );
}

function HistoryModal({ section, onClose }: { section: Section; onClose: () => void }) {
  const q = useSalesQuery<{ items: { version: number; value: unknown; changed_by: string | null; changed_at: string }[] }>(`/settings/${section.key}/history`);
  return (
    <Modal open onClose={onClose} size="lg" title={`${section.title}: history`} description="Earlier versions are read-only. To go back, re-enter the values.">
      {!q.data ? <Skeleton /> : q.data.items.length === 0 ? <EmptyState title="Still on the defaults" description="No changes have been saved for this section." /> : (
        <ul className="max-h-96 space-y-2 overflow-auto">{q.data.items.map((h) => <li key={h.version} className="rounded-md border p-2 text-sm"><p className="font-medium">v{h.version} · {h.changed_by ?? "—"} · {dateTime(h.changed_at)}</p><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(h.value, null, 1)}</pre></li>)}</ul>
      )}
    </Modal>
  );
}

const STATE_LABEL: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  connected: { label: "Connected", tone: "success" }, enabled_but_no_provider: { label: "Enabled, but no provider installed", tone: "warning" }, installed_but_disabled: { label: "Provider installed, switched off", tone: "neutral" }, not_connected: { label: "Not connected", tone: "neutral" }, off: { label: "Off", tone: "neutral" }, not_available: { label: "Not available", tone: "neutral" },
};

interface Outbox { id: number; kind: string; provider: string; entity_type: string | null; entity_id: string | null; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null }

function Integrations() {
  const { can } = useSales();
  const q = useSalesQuery<{ items: { key: string; state: string; provider: string | null; queue: Record<string, number>; lastError: string | null }[]; ai: { state: string; external: boolean | null; allowExternalProvider: boolean }; calendar: { state: string; note: string }; esignature: { state: string; note: string } }>("/integrations/status");
  const st = useListState(["status"]);
  const ob = useList<Outbox>("/outbox", st);
  const [manual, setManual] = useState<Outbox | null>(null);
  const [note, setNote] = useState("");
  const retry = useSalesMutation((o: Outbox) => sales.post(`/outbox/${o.id}/retry`), { invalidate: ["/outbox", "/integrations"], success: "Retry queued" });
  const mark = useSalesMutation((o: Outbox) => sales.post(`/outbox/${o.id}/mark-manual`, { note: note.trim() }), { invalidate: ["/outbox", "/integrations"], success: "Recorded as handled manually", onSuccess: () => { setManual(null); setNote(""); } });
  const write = can("settings:write");
  const badge = (s: string) => { const x = STATE_LABEL[s] ?? { label: titleCase(s), tone: "neutral" as const }; return <StatusBadge status={s} label={x.label} tone={x.tone} />; };
  return (
    <div className="space-y-4">
      <Panel title="Connections" description="An integration only counts as connected when it is switched on and a provider adapter is installed on the server. Nothing is simulated.">
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <ul className="divide-y">
            {q.data.items.map((i) => <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div><p className="font-medium">{titleCase(i.key)}{i.provider ? <span className="ml-2 text-xs text-muted-foreground">{i.provider}</span> : null}</p>{i.lastError && <p className="text-xs text-rose-500">Last error: {i.lastError}</p>}{Object.keys(i.queue).length > 0 && <p className="text-xs text-muted-foreground">Queue: {Object.entries(i.queue).map(([k, n]) => `${n} ${k}`).join(", ")}</p>}</div>{badge(i.state)}</li>)}
            <li className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div><p className="font-medium">AI assist</p><p className="text-xs text-muted-foreground">{q.data.ai.allowExternalProvider ? "External providers are allowed" : "Text stays inside your infrastructure"}</p></div>{badge(q.data.ai.state)}</li>
            <li className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div><p className="font-medium">Calendar</p><p className="text-xs text-muted-foreground">{q.data.calendar.note}</p></div>{badge(q.data.calendar.state)}</li>
            <li className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div><p className="font-medium">E-signature</p><p className="text-xs text-muted-foreground">{q.data.esignature.note}</p></div>{badge(q.data.esignature.state)}</li>
          </ul>
        )}
      </Panel>
      <Panel title="Outbound queue" description="Messages and syncs waiting for a provider. Items stay here, visibly, until a provider confirms them." flush>
        <div className="border-b p-3"><Select aria-label="Status" className="w-44" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{["pending", "unconfigured", "sent", "failed", "dead", "manual"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></div>
        {ob.error && !ob.data ? <ErrorState error={ob.error} onRetry={() => void ob.refetch()} /> : !ob.data ? <Skeleton /> : (
          <><DataTable caption="Outbound queue" rows={ob.data.items} rowKey={(o) => o.id} empty={<EmptyState title="Queue is empty" />}
            columns={[{ key: "k", header: "Item", render: (o: Outbox) => <div><p className="font-medium">{o.kind}</p><p className="text-xs text-muted-foreground">{o.provider}{o.entity_type ? ` · ${o.entity_type} #${o.entity_id}` : ""}</p></div> }, { key: "s", header: "Status", render: (o: Outbox) => <StatusBadge status={o.status} /> },
              { key: "e", header: "Detail", hideOnMobile: true, render: (o: Outbox) => <span className="text-xs text-muted-foreground">{o.last_error ?? ""}</span> }, { key: "c", header: "Created", hideOnMobile: true, render: (o: Outbox) => dateTime(o.created_at) },
              { key: "x", header: "", render: (o: Outbox) => write && ["failed", "dead", "unconfigured"].includes(o.status) ? <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" disabled={retry.pending} onClick={() => void retry.run(o)}>Retry</Button><Button size="sm" variant="ghost" onClick={() => setManual(o)}>Handled manually</Button></span> : null }]} />
            <Pagination page={ob.data.page} pageSize={ob.data.pageSize} total={ob.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      <Modal open={!!manual} onClose={() => setManual(null)} title="Mark as handled manually" description="Sales did not contact the external system. This only records that someone dealt with it outside the app."
        footer={<><Button variant="outline" onClick={() => setManual(null)}>Cancel</Button><Button disabled={note.trim().length < 5 || mark.pending} onClick={() => manual && void mark.run(manual)}>Record</Button></>}>
        <Field label="What was done?" required><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        {mark.error && <p role="alert" className="mt-2 text-sm text-rose-500">{mark.error.message}</p>}
      </Modal>
    </div>
  );
}

interface AuditRow { id: string; at: string; actor_label: string; action: string; entity_type: string | null; entity_id: string | null; summary: string; before: unknown; after: unknown; request_id: string | null }

function Audit() {
  const st = useListState(["action", "entity_type", "actor", "from", "to"]);
  const q = useList<AuditRow>("/audit-log", st);
  const [open, setOpen] = useState<AuditRow | null>(null);
  return (
    <>
      <FilterBar>
        <Input aria-label="Action prefix" className="w-44" placeholder="Action e.g. lead." value={st.filters.action ?? ""} onChange={(e) => st.setFilter("action", e.target.value)} />
        <Input aria-label="Actor" className="w-44" placeholder="Actor" value={st.filters.actor ?? ""} onChange={(e) => st.setFilter("actor", e.target.value)} />
        <Input aria-label="From" type="date" className="w-40" value={st.filters.from ?? ""} onChange={(e) => st.setFilter("from", e.target.value)} />
        <Input aria-label="To" type="date" className="w-40" value={st.filters.to ?? ""} onChange={(e) => st.setFilter("to", e.target.value)} />
        <div className="ml-auto"><ExportButton path="/audit-log" query={{ ...st.filters, format: "csv" }} /></div>
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Audit log" rows={q.data.items} rowKey={(r) => r.id} onRowClick={(r) => setOpen(r)} empty={<EmptyState title="No audit events match" />}
            columns={[{ key: "t", header: "When", render: (r: AuditRow) => dateTime(r.at) }, { key: "a", header: "Who", hideOnMobile: true, render: (r: AuditRow) => r.actor_label }, { key: "c", header: "Action", render: (r: AuditRow) => <Tag>{r.action}</Tag> }, { key: "s", header: "Summary", render: (r: AuditRow) => <span className="text-sm">{r.summary}</span> }]} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      <Modal open={!!open} onClose={() => setOpen(null)} size="lg" title={open?.action ?? ""} description={open ? `${open.actor_label} · ${dateTime(open.at)}${open.request_id ? ` · request ${open.request_id}` : ""}` : undefined}>
        {open && <><p className="text-sm">{open.summary}</p>
          {open.before != null && <><h4 className="mb-1 mt-3 text-sm font-semibold">Before</h4><pre className="max-h-48 overflow-auto rounded bg-secondary p-2 text-xs">{JSON.stringify(open.before, null, 1)}</pre></>}
          {open.after != null && <><h4 className="mb-1 mt-3 text-sm font-semibold">After</h4><pre className="max-h-48 overflow-auto rounded bg-secondary p-2 text-xs">{JSON.stringify(open.after, null, 1)}</pre></>}</>}
      </Modal>
    </>
  );
}

function AiStatus() {
  const q = useSalesQuery<{ available: boolean; enabled: boolean; providerInstalled: boolean; external: boolean | null; blockedByPolicy: boolean; usedLastHour: number; hourlyLimit: number; features: string[]; note: string }>("/ai/status");
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Available" value={d.available ? "Yes" : "No"} tone={d.available ? "success" : "warning"} /><KpiCard label="Switched on" value={d.enabled ? "Yes" : "No"} />
        <KpiCard label="Provider installed" value={d.providerInstalled ? "Yes" : "No"} /><KpiCard label="Used this hour" value={`${d.usedLastHour}/${d.hourlyLimit}`} />
      </div>
      <Panel title="How AI assist behaves">
        <p className="text-sm">{d.note}</p>
        {d.blockedByPolicy && <p className="mt-2 text-sm text-amber-500">The configured provider is external and external providers are not allowed in Settings → Integrations, so AI is blocked.</p>}
        {d.features.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">{d.features.map((f) => <Tag key={f}>{titleCase(f)}</Tag>)}</ul>}
        <p className="mt-3 text-xs text-muted-foreground">AI output is always a suggestion for a person to review. It never changes records, sends messages or sets amounts on its own.</p>
      </Panel>
    </div>
  );
}

/** Sales data lives in this browser (on-device PostgreSQL). Backup, restore and erase it here. */
function DataTab() {
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"backup" | "restore" | "erase" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmErase, setConfirmErase] = useState("");
  useEffect(() => {
    void localStatus().then((s) => setPersistent(s.persistent));
  }, []);

  async function backup() {
    setBusy("backup");
    setMessage(null);
    try {
      const { blob, filename } = await backupLocalData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage({ ok: true, text: `Backup downloaded as ${filename}.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "The backup could not be created." });
    } finally {
      setBusy(null);
    }
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    if (!window.confirm("Restoring replaces ALL Sales data on this device with the backup. Continue?")) return;
    setBusy("restore");
    setMessage(null);
    try {
      await restoreLocalData(file);
    } catch (e) {
      setBusy(null);
      setMessage({ ok: false, text: e instanceof Error ? e.message : "The backup could not be restored." });
    }
  }

  async function erase() {
    setBusy("erase");
    try {
      await eraseLocalData();
    } catch (e) {
      setBusy(null);
      setMessage({ ok: false, text: e instanceof Error ? e.message : "The data could not be erased." });
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Where your Sales data lives" description="Sales runs entirely in this browser on an on-device PostgreSQL database. Nothing is sent to a server.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{persistent === null ? "Checking storage…" : persistent ? "Stored in this browser profile (IndexedDB) and kept between visits." : "Your browser blocked persistent storage, so data is kept in memory for this tab only. Back up before closing it."}</li>
          <li>Clearing site data, or using another browser or device, starts an empty workspace. Download a backup regularly.</li>
          <li>Customer quotation links and public lead forms open only in this same browser profile, because the data is not on a server. To collect leads from the public, connect the API (set VITE_SALES_API_MODE=remote).</li>
          <li>E-mail, WhatsApp, payment and accounting are not connected; those actions stay queued as pending and are never reported as sent.</li>
        </ul>
      </Panel>
      <Panel title="Backup and restore">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void backup()} disabled={busy !== null}>{busy === "backup" ? "Preparing…" : "Download backup"}</Button>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <span className="rounded-md border px-3 py-2 hover:bg-secondary">{busy === "restore" ? "Restoring…" : "Restore from backup…"}</span>
            <input type="file" accept=".tar,application/x-tar" className="sr-only" disabled={busy !== null} onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
        {message && <p role={message.ok ? "status" : "alert"} className={`mt-3 text-sm ${message.ok ? "text-emerald-500" : "text-rose-500"}`}>{message.text}</p>}
      </Panel>
      <Panel title="Erase everything" description="Permanently deletes every Sales record on this device. This cannot be undone.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label='Type "ERASE" to confirm'><Input value={confirmErase} onChange={(e) => setConfirmErase(e.target.value)} placeholder="ERASE" /></Field>
          <Button variant="outline" className="text-rose-500" disabled={confirmErase !== "ERASE" || busy !== null} onClick={() => void erase()}>{busy === "erase" ? "Erasing…" : "Erase all Sales data"}</Button>
        </div>
      </Panel>
    </div>
  );
}
