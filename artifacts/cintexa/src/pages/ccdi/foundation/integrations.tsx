/** Integrations: registrations, credential vault (write-only values) and AI provider configuration. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorState, Field, Loading, NeedsOrg, Notice, Panel, Tabs, errMessage, fmtDate, post, selectClass, useOrg, v1 } from "./client";

type Credential = { id: string; name: string; kind: string; provider: string; storage: string; masked_hint: string | null; status: string; last_rotated_at: string | null; created_at: string };
type Integration = { id: string; category: string; integration_key: string; name: string; credential_id: string | null; status: string; health_checked_at: string | null; health_detail: string | null };
type AiProvider = { id: string; provider: string; name: string; base_url: string | null; default_model: string | null; credential_id: string | null; is_default: boolean; status: string; monthly_token_limit: string | null; monthly_cost_limit_usd: string | null; tokens_used_month: string; health_checked_at: string | null; health_detail: string | null };

const KINDS = ["ai_provider", "security_tool", "cloud", "siem", "email", "messaging", "payment", "github", "threat_intel", "other"];
const CATEGORIES = ["github", "ai_provider", "email", "whatsapp", "payment", "security_tool", "cloud", "siem", "threat_intel", "other"];
const AI = ["openai", "anthropic", "gemini", "openrouter", "custom"];

export default function Integrations() {
  const [tab, setTab] = useState<"integrations" | "credentials" | "ai">("integrations");
  return (
    <div>
      <Notice kind="info">Registration and configuration only. Nothing here is marked connected until a real connection test succeeds.</Notice>
      <div className="mt-4" />
      <Tabs tabs={[{ id: "integrations", label: "Integrations" }, { id: "credentials", label: "Credentials" }, { id: "ai", label: "AI providers" }]} value={tab} onChange={setTab} />
      {tab === "integrations" && <IntegrationList />}
      {tab === "credentials" && <Credentials />}
      {tab === "ai" && <AiProviders />}
    </div>
  );
}

function useCredentials(orgId: string | null) {
  return useQuery({ queryKey: ["ccdi", "v1", "credentials", orgId], enabled: !!orgId, queryFn: () => v1<{ credentials: Credential[]; vault: { configured: boolean } }>(`/organizations/${orgId}/credentials`) });
}

function CredentialSelect({ id, value, onChange, list }: { id: string; value: string; onChange: (v: string) => void; list: Credential[] }) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {list.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.name} ({c.masked_hint})</option>)}
    </select>
  );
}

function IntegrationList() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const key = ["ccdi", "v1", "integrations", orgId];
  const list = useQuery({ queryKey: key, enabled: !!orgId, queryFn: () => v1<{ integrations: Integration[] }>(`/organizations/${orgId}/integrations`) });
  const creds = useCredentials(orgId);
  const [f, setF] = useState({ category: "github", name: "", credentialId: "" });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const create = useMutation({ mutationFn: () => post(`/organizations/${orgId}/integrations`, { category: f.category, name: f.name, credentialId: f.credentialId || undefined }), onSuccess: () => { setF({ ...f, name: "" }); refresh(); } });
  const test = useMutation({ mutationFn: (id: string) => post(`/organizations/${orgId}/integrations/${id}/test`, {}), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (v: { id: string; disabled: boolean }) => post(`/organizations/${orgId}/integrations/${v.id}`, { disabled: v.disabled }, "PATCH"), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => v1(`/organizations/${orgId}/integrations/${id}`, { method: "DELETE" }), onSuccess: refresh });

  if (!orgId) return <NeedsOrg />;
  return (
    <div className="space-y-5">
      <Panel title="Register integration">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Category" htmlFor="i-cat"><select id="i-cat" className={selectClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Name" htmlFor="i-name"><Input id="i-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Credential" htmlFor="i-cred"><CredentialSelect id="i-cred" value={f.credentialId} onChange={(v) => setF({ ...f, credentialId: v })} list={creds.data?.credentials ?? []} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={create.isPending || !f.name.trim()}>Register</Button></div>
        </form>
        {create.isError && <div className="mt-3"><Notice kind="error">{errMessage(create.error)}</Notice></div>}
      </Panel>
      <Panel title="Registered integrations">
        {list.isLoading && <Loading />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data?.integrations.length === 0 && <Empty title="No integrations registered" />}
        <ul className="divide-y divide-border/40">
          {list.data?.integrations.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.name} <Badge variant="outline">{i.category}</Badge> <Badge variant="secondary">{i.status}</Badge></div>
                <p className="text-xs text-muted-foreground">{i.health_detail ?? "Not checked yet."}{i.health_checked_at ? ` (${fmtDate(i.health_checked_at)})` : ""}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => test.mutate(i.id)} disabled={test.isPending}>Check config</Button>
                <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: i.id, disabled: i.status !== "disabled" })}>{i.status === "disabled" ? "Enable" : "Disable"}</Button>
                <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Delete ${i.name}?`)) remove.mutate(i.id); }}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        {[test, toggle, remove].map((m, n) => m.isError && <div key={n} className="mt-3"><Notice kind="error">{errMessage(m.error)}</Notice></div>)}
      </Panel>
    </div>
  );
}

function Credentials() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const list = useCredentials(orgId);
  const [f, setF] = useState({ name: "", kind: "ai_provider", provider: "", storage: "vault", value: "", externalRef: "" });
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["ccdi", "v1", "credentials", orgId] });

  const create = useMutation({
    mutationFn: () => post(`/organizations/${orgId}/credentials`, { name: f.name, kind: f.kind, provider: f.provider, storage: f.storage, ...(f.storage === "vault" ? { value: f.value } : { externalRef: f.externalRef }) }),
    // The secret is cleared from component state the moment the request settles.
    onSettled: () => setF((s) => ({ ...s, value: "" })),
    onSuccess: () => { setF({ name: "", kind: f.kind, provider: "", storage: f.storage, value: "", externalRef: "" }); refresh(); },
  });
  const rotate = useMutation({
    mutationFn: (id: string) => post(`/organizations/${orgId}/credentials/${id}/rotate`, { value: rotateValue }),
    onSettled: () => setRotateValue(""),
    onSuccess: () => { setRotating(null); refresh(); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/organizations/${orgId}/credentials/${id}/revoke`, {}), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => v1(`/organizations/${orgId}/credentials/${id}`, { method: "DELETE" }), onSuccess: refresh });

  if (!orgId) return <NeedsOrg />;
  const vaultOff = list.data && !list.data.vault.configured;
  return (
    <div className="space-y-5">
      {vaultOff && <Notice kind="error">The credential vault is not configured on the server (CCDI_MASTER_KEYS). Vault storage is unavailable; you can still reference environment variables.</Notice>}
      <Panel title="Add credential" description="The value is sent once, encrypted on the server and never shown again. Only a masked hint is displayed.">
        <form className="grid gap-3 md:grid-cols-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name" htmlFor="c-name"><Input id="c-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Kind" htmlFor="c-kind"><select id="c-kind" className={selectClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Provider" htmlFor="c-prov" hint="e.g. openai, github"><Input id="c-prov" value={f.provider} maxLength={60} onChange={(e) => setF({ ...f, provider: e.target.value })} required /></Field>
          <Field label="Storage" htmlFor="c-storage"><select id="c-storage" className={selectClass} value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })}><option value="vault">Encrypted vault</option><option value="env">Environment variable</option></select></Field>
          {f.storage === "vault" ? (
            <Field label="Secret value" htmlFor="c-val"><Input id="c-val" type="password" autoComplete="new-password" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required minLength={8} /></Field>
          ) : (
            <Field label="Variable name" htmlFor="c-env" hint="Must start with CCDI_"><Input id="c-env" value={f.externalRef} onChange={(e) => setF({ ...f, externalRef: e.target.value.toUpperCase() })} pattern="CCDI_[A-Z0-9_]+" required /></Field>
          )}
          <div className="flex items-end"><Button type="submit" disabled={create.isPending || (f.storage === "vault" && !!vaultOff)}>Save credential</Button></div>
        </form>
        {create.isError && <div className="mt-3"><Notice kind="error">{errMessage(create.error)}</Notice></div>}
      </Panel>
      <Panel title="Stored credentials">
        {list.isLoading && <Loading />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data?.credentials.length === 0 && <Empty title="No credentials stored" />}
        <ul className="divide-y divide-border/40">
          {list.data?.credentials.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{c.name} <Badge variant="outline">{c.kind}</Badge> <Badge variant={c.status === "active" ? "secondary" : "destructive"}>{c.status}</Badge></div>
                  <p className="text-xs text-muted-foreground">{c.provider} · <span className="font-mono">{c.masked_hint}</span> · {c.last_rotated_at ? `rotated ${fmtDate(c.last_rotated_at)}` : `added ${fmtDate(c.created_at)}`}</p>
                </div>
                <div className="flex gap-2">
                  {c.storage === "vault" && <Button size="sm" variant="outline" onClick={() => { rotate.reset(); setRotateValue(""); setRotating(rotating === c.id ? null : c.id); }}>Rotate</Button>}
                  {c.status === "active" && <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Revoke ${c.name}? Its stored value is wiped.`)) revoke.mutate(c.id); }}>Revoke</Button>}
                  <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }}>Delete</Button>
                </div>
              </div>
              {rotating === c.id && (
                <form className="mt-3 flex flex-wrap items-end gap-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); rotate.mutate(c.id); }}>
                  <Field label="New secret value" htmlFor={`rot-${c.id}`}><Input id={`rot-${c.id}`} type="password" autoComplete="new-password" minLength={8} value={rotateValue} onChange={(e) => setRotateValue(e.target.value)} required /></Field>
                  <Button type="submit" disabled={rotate.isPending}>Save new value</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {[rotate, revoke, remove].map((m, n) => m.isError && <div key={n} className="mt-3"><Notice kind="error">{errMessage(m.error)}</Notice></div>)}
      </Panel>
    </div>
  );
}

function AiProviders() {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const key = ["ccdi", "v1", "ai", orgId];
  const list = useQuery({ queryKey: key, enabled: !!orgId, queryFn: () => v1<{ providers: AiProvider[] }>(`/organizations/${orgId}/ai-providers`) });
  const creds = useCredentials(orgId);
  const [f, setF] = useState({ provider: "openai", name: "", baseUrl: "", defaultModel: "", credentialId: "", tokens: "", cost: "", isDefault: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const create = useMutation({
    mutationFn: () => post(`/organizations/${orgId}/ai-providers`, { provider: f.provider, name: f.name, baseUrl: f.provider === "custom" ? f.baseUrl : undefined, defaultModel: f.defaultModel || undefined, credentialId: f.credentialId || undefined, monthlyTokenLimit: num(f.tokens), monthlyCostLimitUsd: num(f.cost), isDefault: f.isDefault }),
    onSuccess: () => { setF({ ...f, name: "", baseUrl: "", defaultModel: "" }); refresh(); },
  });
  const test = useMutation({ mutationFn: (id: string) => post(`/organizations/${orgId}/ai-providers/${id}/test`, {}), onSuccess: refresh });
  const makeDefault = useMutation({ mutationFn: (id: string) => post(`/organizations/${orgId}/ai-providers/${id}`, { isDefault: true }, "PATCH"), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => v1(`/organizations/${orgId}/ai-providers/${id}`, { method: "DELETE" }), onSuccess: refresh });

  if (!orgId) return <NeedsOrg />;
  return (
    <div className="space-y-5">
      <Panel title="Register AI provider" description="Provider configuration and cost limits only. No AI agents run in this phase.">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Provider" htmlFor="a-prov"><select id="a-prov" className={selectClass} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>{AI.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Name" htmlFor="a-name"><Input id="a-name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Default model" htmlFor="a-model"><Input id="a-model" value={f.defaultModel} maxLength={120} onChange={(e) => setF({ ...f, defaultModel: e.target.value })} /></Field>
          <Field label="Credential" htmlFor="a-cred"><CredentialSelect id="a-cred" value={f.credentialId} onChange={(v) => setF({ ...f, credentialId: v })} list={creds.data?.credentials ?? []} /></Field>
          {f.provider === "custom" && <div className="md:col-span-2"><Field label="Base URL (https)" htmlFor="a-url"><Input id="a-url" type="url" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} required /></Field></div>}
          <Field label="Monthly token limit" htmlFor="a-tok"><Input id="a-tok" type="number" min={0} value={f.tokens} onChange={(e) => setF({ ...f, tokens: e.target.value })} /></Field>
          <Field label="Monthly cost limit (USD)" htmlFor="a-cost"><Input id="a-cost" type="number" min={0} step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /> Make default</label>
          <div className="flex items-end"><Button type="submit" disabled={create.isPending || !f.name.trim()}>Register</Button></div>
        </form>
        {create.isError && <div className="mt-3"><Notice kind="error">{errMessage(create.error)}</Notice></div>}
      </Panel>
      <Panel title="AI providers">
        {list.isLoading && <Loading />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data?.providers.length === 0 && <Empty title="No AI providers registered" />}
        <ul className="divide-y divide-border/40">
          {list.data?.providers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name} <Badge variant="outline">{p.provider}</Badge> <Badge variant={p.status === "verified" ? "secondary" : "outline"}>{p.status}</Badge>{p.is_default && <Badge className="ml-1">default</Badge>}</div>
                <p className="text-xs text-muted-foreground">{p.default_model ?? "No default model"} · limits: {p.monthly_token_limit ?? "none"} tokens, {p.monthly_cost_limit_usd ? `$${p.monthly_cost_limit_usd}` : "no cost cap"} · used {p.tokens_used_month} tokens</p>
                {p.health_detail && <p className="text-xs text-muted-foreground">{p.health_detail}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => test.mutate(p.id)} disabled={test.isPending}>Test connection</Button>
                {!p.is_default && <Button size="sm" variant="outline" onClick={() => makeDefault.mutate(p.id)}>Make default</Button>}
                <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Delete ${p.name}?`)) remove.mutate(p.id); }}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        {test.data && <div className="mt-3"><Notice kind={test.data.verified ? "ok" : "info"}>{test.data.detail}</Notice></div>}
        {[test, makeDefault, remove].map((m, n) => m.isError && <div key={n} className="mt-3"><Notice kind="error">{errMessage(m.error)}</Notice></div>)}
      </Panel>
    </div>
  );
}
