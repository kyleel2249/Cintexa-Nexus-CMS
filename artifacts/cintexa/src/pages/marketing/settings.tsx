import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { marketingIntel } from "@/lib/marketing/api";

export default function MarketingSettingsPage() {
  const qc = useQueryClient();
  const [businessName, setBusinessName] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [newChannel, setNewChannel] = useState("");

  useEffect(() => { marketingIntel.ensureSeed(); }, []);

  const settings = useQuery({
    queryKey: ["mkt", "settings"],
    queryFn: () => marketingIntel.getSettings(),
  });

  useEffect(() => {
    if (settings.data) {
      setBusinessName(settings.data.business_name);
      setCurrency(settings.data.currency);
      setChannels(settings.data.channels || []);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => marketingIntel.updateSettings({ business_name: businessName, currency }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mkt", "settings"] }); setMsg("Settings saved."); },
  });

  const downloadBackup = async () => {
    const json = await marketingIntel.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cintexa-marketing-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (mode: "merge" | "replace") => {
    if (mode === "replace" && !confirm("Replace entire local marketing store? This cannot be undone.")) return;
    const res = await marketingIntel.importJson(importText, mode);
    setMsg(res.message);
    if (res.ok) qc.invalidateQueries({ queryKey: ["mkt"] });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Marketing Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Local defaults and backup. Data lives in this browser only (localStorage).
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
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Channel management</CardTitle>
          <CardDescription>Internal classifications for campaigns and analytics — not external integrations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="New channel name"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              className="max-w-xs"
            />
            <Button
              size="sm"
              disabled={!newChannel.trim()}
              onClick={() => {
                const ch = [...channels];
                if (!ch.includes(newChannel.trim())) {
                  ch.push(newChannel.trim());
                  setChannels(ch);
                  marketingIntel.updateSettings({ channels: ch }).then(() => {
                    qc.invalidateQueries({ queryKey: ["mkt", "settings"] });
                    setNewChannel("");
                    setMsg("Channel added.");
                  });
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className="space-y-1">
            {channels.map((c, i) => (
              <li key={c} className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
                <span>{c}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    if (!confirm(`Remove channel "${c}"? Campaigns keep historical labels.`)) return;
                    const ch = channels.filter((x) => x !== c);
                    setChannels(ch);
                    marketingIntel.updateSettings({ channels: ch }).then(() => {
                      qc.invalidateQueries({ queryKey: ["mkt", "settings"] });
                      setMsg("Channel removed.");
                    });
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Backup & restore</CardTitle>
          <CardDescription>Full JSON export of the local marketing store. Keep backups outside the browser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" variant="outline" onClick={downloadBackup}>Download JSON backup</Button>
          <div>
            <Label>Import JSON</Label>
            <textarea className="w-full min-h-[120px] rounded-md border bg-background p-2 text-xs font-mono" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste backup JSON…" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!importText.trim()} onClick={() => doImport("merge")}>Merge import</Button>
            <Button size="sm" variant="destructive" disabled={!importText.trim()} onClick={() => doImport("replace")}>Replace import</Button>
          </div>
        </CardContent>
      </Card>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
