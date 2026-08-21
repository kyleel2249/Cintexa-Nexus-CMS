import { useCallback, useEffect, useState } from "react";
import { Archive, Upload, Download, RefreshCw, Zap } from "lucide-react";
import { cdOptimizerApi } from "@/lib/cd-optimizer-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

const MODES = ["lossless", "fast", "balanced", "ultra", "custom"] as const;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const b64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CdOptimizerPage() {
  const [mode, setMode] = useState<(typeof MODES)[number]>("balanced");
  const [jobs, setJobs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      const [j, m] = await Promise.all([cdOptimizerApi.jobs(), cdOptimizerApi.metrics()]);
      setJobs(j.items || []);
      setMetrics(m);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const list = Array.from(files).slice(0, 10);
      for (const file of list) {
        const dataBase64 = await fileToBase64(file);
        const job = await cdOptimizerApi.compress({
          filename: file.name,
          dataBase64,
          mimeType: file.type,
          mode,
        });
        setLastJob(job);
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Compression failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-primary text-sm font-semibold flex items-center gap-2">
            <Archive className="w-4 h-4" /> CD OPTIMIZER
          </div>
          <h1 className="text-3xl font-bold mt-1">Intelligent file compression</h1>
          <p className="text-muted-foreground mt-1">
            AI-assisted strategy selection with lossless-friendly gzip/brotli pipelines. Optional external Python engine via{" "}
            <code className="text-xs">CD_OPTIMIZER_SERVICE_URL</code>.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Files processed", value: metrics.filesProcessed ?? 0 },
          { label: "Bytes saved", value: metrics.bytesSaved ?? 0 },
          { label: "Avg savings %", value: metrics.averagePercentSaved ?? 0 },
          { label: "Avg ratio", value: metrics.averageRatio ?? 1 },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="text-xl font-bold tabular-nums">{typeof k.value === "number" ? k.value.toLocaleString() : k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compress files</CardTitle>
          <CardDescription>Basic mode presets. Advanced codecs (neural/GPU) require the external CD Optimizer service.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
                {m}
              </Button>
            ))}
          </div>
          <Label className="flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 cursor-pointer hover:bg-muted/40 transition">
            <Upload className="w-8 h-8 text-primary mb-2" />
            <span className="font-medium">{busy ? "Processing…" : "Upload files to optimize"}</span>
            <span className="text-xs text-muted-foreground mt-1">Images, documents, code, archives (size limits apply)</span>
            <input type="file" multiple className="hidden" disabled={busy} onChange={(e) => void onFiles(e.target.files)} />
          </Label>
          {error && <p className="text-sm text-rose-500">{error}</p>}
          {lastJob && (
            <div className="border rounded-lg p-4 text-sm grid sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>Original<br /><b>{lastJob.originalSize?.toLocaleString()} B</b></div>
              <div>Optimized<br /><b>{lastJob.optimizedSize?.toLocaleString()} B</b></div>
              <div>Saved<br /><b>{lastJob.percentSaved}%</b></div>
              <div>Ratio<br /><b>{lastJob.ratio}x</b></div>
              <div className="sm:col-span-2">Pipeline: <Badge variant="outline">{lastJob.pipeline}</Badge> <Badge>{lastJob.algorithm}</Badge></div>
              <div className="sm:col-span-2 flex gap-2">
                <Badge variant={lastJob.integrityOk ? "default" : "destructive"}>Integrity {lastJob.integrityOk ? "OK" : "FAIL"}</Badge>
                {lastJob.status === "completed" && (
                  <a href={cdOptimizerApi.downloadUrl(lastJob.id)}>
                    <Button size="sm" variant="outline"><Download className="w-3 h-3 mr-1" /> Download</Button>
                  </a>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4" /> Recent jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {jobs.length === 0 && <p className="text-muted-foreground">No jobs yet.</p>}
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
              <div>
                <div className="font-medium">{j.originalName}</div>
                <div className="text-xs text-muted-foreground">{j.mode} · {j.pipeline} · {j.percentSaved}% saved</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{j.status}</Badge>
                {j.status === "completed" && (
                  <a href={cdOptimizerApi.downloadUrl(j.id)}>
                    <Button size="sm" variant="ghost"><Download className="w-3 h-3" /></Button>
                  </a>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
