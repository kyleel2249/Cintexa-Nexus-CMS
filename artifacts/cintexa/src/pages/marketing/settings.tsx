import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { marketingIntel } from "@/lib/marketing/api";
import type { KpiDefinition } from "@/lib/marketing/entities";

export default function MarketingSettingsPage() {
  const qc = useQueryClient();
  const [businessName, setBusinessName] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [channels, setChannels] = useState<string[]>([]);
  const [archived, setArchived] = useState<string[]>([]);
  const [newChannel, setNewChannel] = useState("");
  const [attribution, setAttribution] = useState<"first_touch" | "last_touch" | "linear" | "manual">("last_touch");
  const [attrNotes, setAttrNotes] = useState("");
  const [defaultBrandId, setDefaultBrandId] = useState<string>("");
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [kpiName, setKpiName] = useState("");
  const [kpiUnit, setKpiUnit] = useState("count");
  const [kpiTarget, setKpiTarget] = useState("");
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const settings = useQuery({
    queryKey: ["mkt", "settings"],
    queryFn: () => marketingIntel.getSettings(),
  });
  const brands = useQuery({
    queryKey: ["mkt", "brands"],
    queryFn: () => marketingIntel.listBrands(),
  });

  useEffect(() => {
    if (settings.data) {
      setBusinessName(settings.data.business_name);
      setCurrency(settings.data.currency);
      setChannels(settings.data.channels || []);
      setArchived(settings.data.archived_channels || []);
      setAttribution(settings.data.attribution_model || "last_touch");
      setAttrNotes(settings.data.attribution_notes || "");
      setDefaultBrandId(settings.data.default_brand_id != null ? String(settings.data.default_brand_id) : "");
      setKpis(settings.data.kpis || []);
    }
  }, [settings.data]);

  const persist = (patch: Parameters<typeof marketingIntel.updateSettings>[0]) =>
    marketingIntel.updateSettings(patch).then(() => {
      qc.invalidateQueries({ queryKey: ["mkt", "settings"] });
      setMsg("Settings saved.");
    });

  const saveBasics = useMutation({
    mutationFn: () =>
      persist({
        business_name: businessName,
        currency,
        default_brand_id: defaultBrandId ? Number(defaultBrandId) : null,
        attribution_model: attribution,
        attribution_notes: attrNotes,
      }),
  });

  const downloadBackup = async () => {
    const json = await marketingIntel.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cintexa-marketing-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const doImport = async (mode: "merge" | "replace") => {
    if (mode === "replace" && !confirm("Replace entire local marketing store?")) return;
    const res = await marketingIntel.importJson(importText, mode);
    setMsg(res.message);
    if (res.ok) qc.invalidateQueries({ queryKey: ["mkt"] });
  };

  const exportSelective = async (kind: string) => {
    let rows: Record<string, unknown>[] = [];
    if (kind === "channels") {
      rows = channels.map((c, i) => ({ name: c, order: i, status: "active" }));
      rows = rows.concat(archived.map((c) => ({ name: c, status: "archived" })));
    } else if (kind === "kpis") {
      rows = kpis as any;
    } else if (kind === "campaigns") {
      const c = await (await import("@/lib/marketing/api")).marketingApi.listCampaigns();
      rows = c.items as any;
    } else if (kind === "activity") {
      rows = (await marketingIntel.listActivity(200)) as any;
    }
    const csv = marketingIntel.toCsv(rows);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `marketing-${kind}.csv`;
    a.click();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marketing Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Local defaults, channels, KPIs and attribution configuration. Data stays in this browser.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Defaults</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Business name</Label><Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></div>
          <div>
            <Label>Currency</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="GHS">GHS</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          <div>
            <Label>Default brand</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={defaultBrandId} onChange={(e) => setDefaultBrandId(e.target.value)}>
              <option value="">— None —</option>
              {(brands.data?.items || []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <Button size="sm" disabled={saveBasics.isPending} onClick={() => saveBasics.mutate()}>Save defaults</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Channel management</CardTitle>
          <CardDescription>Archive instead of delete when campaigns may still reference a channel name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input placeholder="New channel" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} className="max-w-xs" />
            <Button
              size="sm"
              disabled={!newChannel.trim()}
              onClick={() => {
                const name = newChannel.trim();
                if (channels.includes(name) || archived.includes(name)) return;
                const ch = [...channels, name];
                setChannels(ch);
                setNewChannel("");
                persist({ channels: ch });
              }}
            >
              Add
            </Button>
          </div>
          <ul className="space-y-1">
            {channels.map((c, i) => (
              <li key={c} className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
                <span className="flex-1">{c}</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={i === 0} onClick={() => {
                  const ch = [...channels];
                  [ch[i - 1], ch[i]] = [ch[i], ch[i - 1]];
                  setChannels(ch);
                  persist({ channels: ch });
                }}>Up</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={i === channels.length - 1} onClick={() => {
                  const ch = [...channels];
                  [ch[i], ch[i + 1]] = [ch[i + 1], ch[i]];
                  setChannels(ch);
                  persist({ channels: ch });
                }}>Down</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                  const ch = channels.filter((x) => x !== c);
                  const arch = [...archived, c];
                  setChannels(ch);
                  setArchived(arch);
                  persist({ channels: ch, archived_channels: arch });
                }}>Archive</Button>
              </li>
            ))}
          </ul>
          {archived.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Archived</p>
              {archived.map((c) => (
                <div key={c} className="flex items-center justify-between text-sm border rounded px-2 py-1 mb-1">
                  <span>{c} <Badge variant="secondary" className="text-[9px]">archived</Badge></span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                    const arch = archived.filter((x) => x !== c);
                    const ch = [...channels, c];
                    setArchived(arch);
                    setChannels(ch);
                    persist({ channels: ch, archived_channels: arch });
                  }}>Restore</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Attribution</CardTitle>
          <CardDescription>
            Local preference only. Without per-touchpoint data, results cannot be computed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={attribution} onChange={(e) => setAttribution(e.target.value as any)}>
            <option value="first_touch">First touch</option>
            <option value="last_touch">Last touch</option>
            <option value="linear">Linear</option>
            <option value="manual">Manual</option>
          </select>
          <Input value={attrNotes} onChange={(e) => setAttrNotes(e.target.value)} placeholder="Notes / limitations" />
          <Button size="sm" onClick={() => persist({ attribution_model: attribution, attribution_notes: attrNotes })}>Save attribution</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">KPI definitions</CardTitle>
          <CardDescription>Definitions only — historical values are not rewritten when a KPI changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="KPI name" value={kpiName} onChange={(e) => setKpiName(e.target.value)} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={kpiUnit} onChange={(e) => setKpiUnit(e.target.value)}>
              <option value="count">Count</option>
              <option value="percent">Percent</option>
              <option value="currency">Currency</option>
              <option value="manual">Manual</option>
            </select>
            <Input placeholder="Target (optional)" type="number" value={kpiTarget} onChange={(e) => setKpiTarget(e.target.value)} />
            <Button
              size="sm"
              disabled={!kpiName.trim()}
              onClick={() => {
                const row: KpiDefinition = {
                  id: crypto.randomUUID(),
                  name: kpiName.trim(),
                  unit: kpiUnit,
                  method: kpiUnit === "currency" ? "currency" : kpiUnit === "percent" ? "percent" : "count",
                  target: kpiTarget ? Number(kpiTarget) : null,
                  frequency: "monthly",
                };
                const next = [...kpis, row];
                setKpis(next);
                setKpiName("");
                setKpiTarget("");
                persist({ kpis: next });
              }}
            >
              Add KPI
            </Button>
          </div>
          {kpis.map((k) => (
            <div key={k.id} className="flex justify-between text-sm border rounded px-2 py-1">
              <span>{k.name} · {k.unit}{k.target != null ? ` · target ${k.target}` : ""}</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                const next = kpis.filter((x) => x.id !== k.id);
                setKpis(next);
                persist({ kpis: next });
              }}>Remove</Button>
            </div>
          ))}
          {!kpis.length && <p className="text-xs text-muted-foreground">No KPI definitions yet.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Selective export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => exportSelective("channels")}>Channels CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportSelective("kpis")}>KPIs CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportSelective("campaigns")}>Campaigns CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportSelective("activity")}>Activity CSV</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Backup & restore</CardTitle>
          <CardDescription>Full JSON of the local marketing store.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" variant="outline" onClick={downloadBackup}>Download JSON backup</Button>
          <textarea className="w-full min-h-[100px] rounded-md border bg-background p-2 text-xs font-mono" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste backup JSON…" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!importText.trim()} onClick={() => doImport("merge")}>Merge</Button>
            <Button size="sm" variant="destructive" disabled={!importText.trim()} onClick={() => doImport("replace")}>Replace</Button>
          </div>
        </CardContent>
      </Card>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
