import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { marketingApi, marketingIntel } from "@/lib/marketing/api";
import { parseCsv, autoMapHeaders, buildPreview, type ImportEntity } from "@/lib/marketing/csv-import";

export default function MarketingImportPage() {
  const qc = useQueryClient();
  const [entity, setEntity] = useState<ImportEntity>("campaigns");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dupMode, setDupMode] = useState<"skip" | "new">("skip");
  const [summary, setSummary] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof buildPreview> | null>(null);

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    const auto = autoMapHeaders(parsed.headers, entity);
    setMapping(auto);
    setPreview(null);
    setSummary("");
  };

  const runPreview = async () => {
    const existing = new Set<string>();
    if (entity === "campaigns") {
      const c = await marketingApi.listCampaigns();
      c.items.forEach((x: any) => existing.add(String(x.name || "").toLowerCase()));
    } else {
      const c = await marketingApi.listLeads();
      c.items.forEach((x: any) => existing.add(String(x.email || x.name || "").toLowerCase()));
    }
    setPreview(buildPreview(rows, mapping, entity, existing));
  };

  const commit = async () => {
    if (!preview) return;
    let imported = 0;
    let skipped = preview.invalid.length;
    let dups = 0;
    const toImport = [...preview.valid];
    if (dupMode === "new") {
      for (const d of preview.duplicates) toImport.push(d.data);
    } else {
      dups = preview.duplicates.length;
      skipped += dups;
    }
    for (const row of toImport) {
      try {
        if (entity === "campaigns") {
          await marketingApi.createCampaign({
            name: row.name,
            status: row.status || "DRAFT",
            budget: Number(row.budget) || 0,
            spent: Number(row.spent) || 0,
            objective: row.objective || undefined,
          } as any);
        } else {
          await marketingApi.createLead({
            name: row.name,
            email: row.email || null,
            source: row.source || null,
            score: Number(row.score) || 0,
            status: row.status || "new",
          } as any);
        }
        imported++;
      } catch {
        skipped++;
      }
    }
    try {
      await marketingIntel.logActivity({
        action: "import",
        entity_type: entity,
        summary: `CSV import ${entity}: ${imported} imported, ${skipped} skipped, ${dups} duplicates`,
      });
    } catch { /* */ }
    qc.invalidateQueries({ queryKey: ["marketing"] });
    qc.invalidateQueries({ queryKey: ["mkt"] });
    setSummary(`Imported ${imported}. Skipped ${skipped}. Duplicates ${dups}. Invalid ${preview.invalid.length}.`);
  };

  const fields = entity === "campaigns" ? ["name", "status", "budget", "spent", "objective"] : ["name", "email", "source", "score", "status"];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CSV Import</h1>
        <p className="text-sm text-muted-foreground mt-1">Parse and import locally. No file upload to a server.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">1. Source</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={entity} onChange={(e) => setEntity(e.target.value as ImportEntity)}>
            <option value="campaigns">Campaigns</option>
            <option value="leads">Marketing leads</option>
          </select>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {rows.length > 0 && <Badge variant="secondary">{rows.length} data rows · {headers.length} columns</Badge>}
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">2. Column mapping</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {fields.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <span className="w-24">{f}{f === "name" ? " *" : ""}</span>
                <select className="h-9 flex-1 rounded-md border bg-background px-2" value={mapping[f] || ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                  <option value="">— Ignore —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={dupMode} onChange={(e) => setDupMode(e.target.value as any)}>
                <option value="skip">Skip duplicates</option>
                <option value="new">Import duplicates as new</option>
              </select>
              <Button size="sm" onClick={runPreview}>Preview</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">3. Preview</CardTitle>
            <CardDescription>
              Valid {preview.valid.length} · Duplicates {preview.duplicates.length} · Invalid {preview.invalid.length}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {preview.invalid.slice(0, 5).map((x) => (
              <p key={x.row} className="text-xs text-destructive">Row {x.row}: {x.reason}</p>
            ))}
            <Button size="sm" onClick={commit} disabled={!preview.valid.length && dupMode === "skip"}>Confirm import</Button>
            {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
