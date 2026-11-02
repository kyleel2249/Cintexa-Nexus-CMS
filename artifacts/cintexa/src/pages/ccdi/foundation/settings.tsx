/** Settings: security settings and policies, audit-log viewer, account security (MFA). */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorState, Field, Loading, NeedsOrg, Notice, Panel, Tabs, errMessage, fmtDate, post, selectClass, useOrg, v1 } from "./client";

export default function Settings() {
  const [tab, setTab] = useState<"security" | "audit" | "account">("security");
  return (
    <div>
      <Tabs tabs={[{ id: "security", label: "Security settings" }, { id: "audit", label: "Audit log" }, { id: "account", label: "Account security" }]} value={tab} onChange={setTab} />
      {tab === "security" && <SecuritySettings />}
      {tab === "audit" && <AuditLog />}
      {tab === "account" && <AccountSecurity />}
    </div>
  );
}

type Setting = { key: string; value: Record<string, unknown>; version: number; updated_at: string };
type Policy = { policy_type: string; policy_key: string; title: string; definition: Record<string, unknown>; status: string; version: number; updated_at: string };

function SecuritySettings() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const sKey = ["ccdi", "v1", "settings", orgId];
  const pKey = ["ccdi", "v1", "policies", orgId];
  const settings = useQuery({ queryKey: sKey, enabled: !!orgId, queryFn: () => v1<{ settings: Setting[] }>(`/organizations/${orgId}/settings`) });
  const policies = useQuery({ queryKey: pKey, enabled: !!orgId, queryFn: () => v1<{ policies: Policy[] }>(`/organizations/${orgId}/policies`) });
  const [sForm, setSForm] = useState({ key: "", value: "{}" });
  const [pForm, setPForm] = useState({ type: "security", key: "", title: "", definition: "{}", status: "active" });
  const [formError, setFormError] = useState<string | null>(null);

  const parse = (raw: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch { /* handled below */ }
    setFormError("The value must be a valid JSON object.");
    return null;
  };

  const saveSetting = useMutation({
    mutationFn: (v: { key: string; value: Record<string, unknown> }) => post(`/organizations/${orgId}/settings/${encodeURIComponent(v.key)}`, { value: v.value }, "PUT"),
    onSuccess: () => { setSForm({ key: "", value: "{}" }); void qc.invalidateQueries({ queryKey: sKey }); },
  });
  const savePolicy = useMutation({
    mutationFn: (v: { definition: Record<string, unknown> }) =>
      post(`/organizations/${orgId}/policies/${pForm.type}/${encodeURIComponent(pForm.key)}`, { title: pForm.title, definition: v.definition, status: pForm.status }, "PUT"),
    onSuccess: () => { setPForm({ ...pForm, key: "", title: "", definition: "{}" }); void qc.invalidateQueries({ queryKey: pKey }); },
  });

  if (!orgId) return <NeedsOrg />;
  return (
    <div className="space-y-5">
      <Panel title="Organisation settings" description="Versioned key-value settings. Every change is written to the audit log.">
        <form
          className="grid gap-3 md:grid-cols-[1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            const value = parse(sForm.value);
            if (value) saveSetting.mutate({ key: sForm.key, value });
          }}
        >
          <Field label="Key" htmlFor="s-key" hint="Lowercase letters, digits, . _ -"><Input id="s-key" value={sForm.key} onChange={(e) => setSForm({ ...sForm, key: e.target.value })} required /></Field>
          <Field label="Value (JSON object)" htmlFor="s-val"><Input id="s-val" className="font-mono" value={sForm.value} onChange={(e) => setSForm({ ...sForm, value: e.target.value })} required /></Field>
          <div className="flex items-end"><Button type="submit" disabled={saveSetting.isPending || !sForm.key.trim()}>Save</Button></div>
        </form>
        {formError && <div className="mt-3"><Notice kind="error">{formError}</Notice></div>}
        {saveSetting.isError && <div className="mt-3"><Notice kind="error">{errMessage(saveSetting.error)}</Notice></div>}
        <div className="mt-4">
          {settings.isLoading && <Loading />}
          {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}
          {settings.data?.settings.length === 0 && <Empty title="No settings yet" />}
          <ul className="divide-y divide-border/40">
            {settings.data?.settings.map((s) => (
              <li key={s.key} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setSForm({ key: s.key, value: JSON.stringify(s.value) })}>{s.key}</button>
                  <span className="text-xs text-muted-foreground">v{s.version} · {fmtDate(s.updated_at)}</span>
                </div>
                <code className="block break-all text-xs text-muted-foreground">{JSON.stringify(s.value)}</code>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="Security policies" description="Security, access, retention and approval definitions. Definitions are stored and audited; enforcement belongs to later phases.">
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            const definition = parse(pForm.definition);
            if (definition) savePolicy.mutate({ definition });
          }}
        >
          <Field label="Type" htmlFor="p-type">
            <select id="p-type" className={selectClass} value={pForm.type} onChange={(e) => setPForm({ ...pForm, type: e.target.value })}>
              {["security", "access", "retention", "approval"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Key" htmlFor="p-key"><Input id="p-key" value={pForm.key} onChange={(e) => setPForm({ ...pForm, key: e.target.value })} required /></Field>
          <Field label="Title" htmlFor="p-title"><Input id="p-title" value={pForm.title} onChange={(e) => setPForm({ ...pForm, title: e.target.value })} required maxLength={200} /></Field>
          <Field label="Status" htmlFor="p-status">
            <select id="p-status" className={selectClass} value={pForm.status} onChange={(e) => setPForm({ ...pForm, status: e.target.value })}>
              {["draft", "active", "retired"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <div className="md:col-span-3"><Field label="Definition (JSON object)" htmlFor="p-def"><Input id="p-def" className="font-mono" value={pForm.definition} onChange={(e) => setPForm({ ...pForm, definition: e.target.value })} required /></Field></div>
          <div className="flex items-end"><Button type="submit" disabled={savePolicy.isPending || !pForm.key.trim() || !pForm.title.trim()}>Save policy</Button></div>
        </form>
        {savePolicy.isError && <div className="mt-3"><Notice kind="error">{errMessage(savePolicy.error)}</Notice></div>}
        <div className="mt-4">
          {policies.isLoading && <Loading />}
          {policies.isError && <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />}
          {policies.data?.policies.length === 0 && <Empty title="No policies yet" />}
          <ul className="divide-y divide-border/40">
            {policies.data?.policies.map((p) => (
              <li key={`${p.policy_type}:${p.policy_key}`} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.title} <Badge variant="outline">{p.policy_type}</Badge> <Badge variant="secondary">{p.status}</Badge></span>
                  <span className="text-xs text-muted-foreground">{p.policy_key} · v{p.version}</span>
                </div>
                <code className="block break-all text-xs text-muted-foreground">{JSON.stringify(p.definition)}</code>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}

type AuditEvent = { id: string; actor_ref: string | null; action: string; entity_type: string; entity_id: string | null; outcome: string | null; correlation_id: string | null; created_at: string; meta: Record<string, unknown> };

function AuditLog() {
  const { orgId, accessMode } = useOrg();
  const [filters, setFilters] = useState({ action: "", outcome: "" });
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.action) qs.set("action", filters.action);
  if (filters.outcome) qs.set("outcome", filters.outcome);
  const events = useQuery({ queryKey: ["ccdi", "v1", "audit", orgId, filters, offset], enabled: accessMode === "open" || !!orgId, queryFn: () => v1<{ events: AuditEvent[] }>(`/audit?${qs}`, { orgId }) });
  const verify = useMutation({ mutationFn: () => v1<{ valid: boolean; checked: number; note: string }>("/audit/verify") });

  if (accessMode === "enforced" && !orgId) return <NeedsOrg />;
  return (
    <Panel
      title="Audit log"
      description="Append-only and hash-chained. Entries cannot be edited or deleted. Secret values are redacted before storage."
      actions={<Button size="sm" variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>{verify.isPending ? "Verifying…" : "Verify integrity"}</Button>}
    >
      {verify.data && <div className="mb-3"><Notice kind={verify.data.valid ? "ok" : "error"}>{verify.data.valid ? "Chain intact" : "Chain broken"}: {verify.data.checked} hashed entries checked. {verify.data.note}</Notice></div>}
      {verify.isError && <div className="mb-3"><Notice kind="error">{errMessage(verify.error)}</Notice></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Action" htmlFor="a-action"><Input id="a-action" placeholder="e.g. credential.created" value={filters.action} onChange={(e) => { setOffset(0); setFilters({ ...filters, action: e.target.value }); }} /></Field>
        <Field label="Outcome" htmlFor="a-outcome">
          <select id="a-outcome" className={selectClass} value={filters.outcome} onChange={(e) => { setOffset(0); setFilters({ ...filters, outcome: e.target.value }); }}>
            <option value="">All</option><option>success</option><option>failure</option><option>denied</option>
          </select>
        </Field>
      </div>
      {events.isLoading && <Loading />}
      {events.isError && <ErrorState error={events.error} onRetry={() => void events.refetch()} />}
      {events.data?.events.length === 0 && <Empty title="No audit events" hint="Events appear here as administrative actions happen." />}
      {!!events.data?.events.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground"><tr><th className="py-2 pr-4">Time</th><th className="pr-4">Actor</th><th className="pr-4">Action</th><th className="pr-4">Resource</th><th>Outcome</th></tr></thead>
            <tbody>
              {events.data.events.map((e) => (
                <tr key={e.id} className="border-t border-border/40 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{fmtDate(e.created_at)}</td>
                  <td className="pr-4">{e.actor_ref ?? "—"}</td>
                  <td className="pr-4 font-medium">{e.action}</td>
                  <td className="pr-4 text-muted-foreground">{e.entity_type}{e.entity_id ? `:${e.entity_id.slice(0, 8)}` : ""}</td>
                  <td><Badge variant={e.outcome === "success" ? "secondary" : e.outcome ? "destructive" : "outline"}>{e.outcome ?? "legacy"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
        <span className="text-xs text-muted-foreground">Showing {offset + 1}–{offset + (events.data?.events.length ?? 0)}</span>
        <Button size="sm" variant="outline" disabled={(events.data?.events.length ?? 0) < limit} onClick={() => setOffset(offset + limit)}>Next</Button>
      </div>
    </Panel>
  );
}

function AccountSecurity() {
  const { accessMode } = useOrg();
  const qc = useQueryClient();
  const enabledQuery = accessMode === "enforced";
  const status = useQuery({ queryKey: ["ccdi", "v1", "mfa"], enabled: enabledQuery, queryFn: () => v1<{ totp: string; recoveryCodesRemaining: number }>("/mfa/status") });
  const events = useQuery({ queryKey: ["ccdi", "v1", "authevents"], enabled: enabledQuery, queryFn: () => v1<{ events: Array<{ event_type: string; outcome: string; created_at: string }> }>("/account/security") });
  const [code, setCode] = useState("");
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["ccdi", "v1", "mfa"] }); void qc.invalidateQueries({ queryKey: ["ccdi", "v1", "authevents"] }); };

  const start = useMutation({ mutationFn: () => post<{ secret: string; otpauthUri: string }>("/mfa/totp/enroll", {}), onSuccess: (r) => { setCodes(null); setEnrol(r); refresh(); } });
  const confirm = useMutation({ mutationFn: () => post<{ recoveryCodes: string[] }>("/mfa/totp/confirm", { code }), onSuccess: (r) => { setEnrol(null); setCode(""); setCodes(r.recoveryCodes); refresh(); } });
  const disable = useMutation({ mutationFn: () => post("/mfa/totp/disable", { code }), onSuccess: () => { setCode(""); refresh(); } });
  const regen = useMutation({ mutationFn: () => post<{ recoveryCodes: string[] }>("/mfa/recovery-codes/regenerate", { code }), onSuccess: (r) => { setCode(""); setCodes(r.recoveryCodes); refresh(); } });

  if (accessMode !== "enforced") {
    return (
      <Panel title="Account security">
        <Notice kind="info">Sign-in is disabled while CCDI runs in open-access mode, so there is no signed-in account to protect. Multi-factor authentication, recovery codes and login history become available when access is switched to enforced mode. The backend for them is already in place.</Notice>
      </Panel>
    );
  }
  const active = status.data?.totp === "active";
  return (
    <div className="space-y-5">
      <Panel title="Authenticator app (TOTP)" description="Codes are verified on the server. The secret is encrypted at rest.">
        {status.isLoading && <Loading />}
        {status.isError && <ErrorState error={status.error} onRetry={() => void status.refetch()} />}
        {status.data && <p className="mb-3 text-sm">Status: <Badge variant={active ? "secondary" : "outline"}>{status.data.totp}</Badge>{active && <span className="ml-2 text-muted-foreground">{status.data.recoveryCodesRemaining} recovery codes left</span>}</p>}
        {!active && !enrol && <Button onClick={() => start.mutate()} disabled={start.isPending}>Set up authenticator</Button>}
        {enrol && (
          <div className="space-y-3">
            <p className="text-sm">Add this key to your authenticator app, then enter the 6-digit code. It is shown only once.</p>
            <code className="block break-all rounded bg-muted px-3 py-2 text-sm">{enrol.secret}</code>
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); confirm.mutate(); }}>
              <Field label="6-digit code" htmlFor="mfa-code"><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required /></Field>
              <Button type="submit" disabled={confirm.isPending || code.length !== 6}>Activate</Button>
            </form>
          </div>
        )}
        {active && (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
            <Field label="Current 6-digit code" htmlFor="mfa-code2"><Input id="mfa-code2" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Button type="button" variant="outline" disabled={code.length !== 6 || regen.isPending} onClick={() => regen.mutate()}>New recovery codes</Button>
            <Button type="button" variant="outline" disabled={code.length !== 6 || disable.isPending} onClick={() => disable.mutate()}>Disable</Button>
          </form>
        )}
        {[start, confirm, disable, regen].map((m, i) => m.isError && <div key={i} className="mt-3"><Notice kind="error">{errMessage(m.error)}</Notice></div>)}
        {codes && (
          <div className="mt-4 space-y-2">
            <Notice kind="info">Save these recovery codes now. Each works once and they will not be shown again.</Notice>
            <pre className="rounded bg-muted p-3 text-sm">{codes.join("\n")}</pre>
            <Button size="sm" variant="outline" onClick={() => setCodes(null)}>I have saved them</Button>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">Passkeys (WebAuthn) are not implemented yet.</p>
      </Panel>
      <Panel title="Recent security activity">
        {events.isLoading && <Loading />}
        {events.data?.events.length === 0 && <Empty title="No activity recorded" />}
        <ul className="divide-y divide-border/40 text-sm">
          {events.data?.events.map((e, i) => <li key={i} className="flex justify-between py-2"><span>{e.event_type}</span><span className="text-muted-foreground">{e.outcome} · {fmtDate(e.created_at)}</span></li>)}
        </ul>
      </Panel>
    </div>
  );
}
