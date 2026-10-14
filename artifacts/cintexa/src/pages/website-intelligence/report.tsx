import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Download, Printer, XCircle } from "lucide-react";
import { REPORT_TYPES, REPORT_TYPE_LABELS, type ReportType } from "@workspace/wi-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAudit, useBundle, useRecordReport, useReports } from "@/lib/website-intelligence/api";
import { downloadReport, printReport } from "@/lib/website-intelligence/deliver";
import type { GeneratedReport, ValidationCheck } from "@/lib/website-intelligence/report-pdf";
import { EmptyState, ErrorNote, Loading, Panel, WI, fmtDate } from "./components";

const DESCRIPTIONS: Record<ReportType, string> = {
  executive: "Scores, risks, strengths and next actions for decision makers.",
  technical: "Every technical finding with evidence, fixes and implementation order.",
  seo: "Technical SEO, on-page, crawl and structured data.",
  performance: "Core Web Vitals (lab and field shown separately) and delivery.",
  accessibility: "Automated WCAG 2.2 AA findings, with honest limits.",
  security: "Passive security and privacy configuration review.",
  conversion: "Conversion, content, trust and journey assessment.",
  roadmap: "Prioritised remediation plan, sequence and acceptance criteria.",
  comparison: "Before-and-after changes against the previous audit.",
  full: "The complete report: all 25 analysis sections plus cover and contents.",
};

export default function ReportPage({ id }: { id: string }) {
  const audit = useAudit(id);
  const bundle = useBundle(id);
  const history = useReports(id);
  const record = useRecordReport(id);
  const [type, setType] = useState<ReportType>("full");
  const [brand, setBrand] = useState("");
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState<"idle" | "download" | "print">("idle");
  const [error, setError] = useState<unknown>(null);
  const [checks, setChecks] = useState<ValidationCheck[] | null>(null);
  const [last, setLast] = useState<GeneratedReport | null>(null);

  if (bundle.isLoading || audit.isLoading) return <Loading />;
  if (bundle.error) return <ErrorNote error={bundle.error} />;
  const b = bundle.data;
  if (!b || !b.audit.scores) return <EmptyState title="No report available" body="Reports need a finished, scored audit." />;
  const hasComparison = Boolean(b.comparison);

  const run = async (mode: "download" | "print") => {
    setBusy(mode); setError(null); setChecks(null);
    try {
      const { generateReport, ReportValidationError } = await import("@/lib/website-intelligence/report-pdf");
      let report: GeneratedReport;
      try {
        report = await generateReport(b, { type, brandName: brand || undefined, confidentiality: conf || undefined });
      } catch (e) {
        if (e instanceof ReportValidationError) setChecks(e.checks);
        throw e;
      }
      setChecks(report.validation.checks);
      setLast(report);
      // The server validates and records the metadata; a refusal means the file is not offered.
      await record.mutateAsync({ type, filename: report.fileName, bytes: report.sizeBytes, pages: report.pages, sha256: report.sha256, sections: report.sections });
      if (mode === "download") downloadReport(report); else printReport(report);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="space-y-5">
      <Link href={`${WI}/audits/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to {audit.data?.config.name || audit.data?.hostname}</Link>
      <Panel title="Choose a report" description="The PDF is built from the saved audit data and contains the full selected report, not just what the dashboard shows.">
        <div role="radiogroup" aria-label="Report type" className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {REPORT_TYPES.map((t) => {
            const disabled = t === "comparison" && !hasComparison;
            return (
              <label key={t} className={`rounded-lg border p-3 text-sm ${disabled ? "opacity-50" : "cursor-pointer"} ${type === t ? "border-primary bg-primary/5" : ""}`}>
                <input type="radio" name="report" className="sr-only" checked={type === t} disabled={disabled} onChange={() => setType(t)} />
                <div className="font-medium">{REPORT_TYPE_LABELS[t]}</div>
                <p className="mt-1 text-xs text-muted-foreground">{disabled ? "Needs an earlier audit of this site to compare with." : DESCRIPTIONS[t]}</p>
              </label>
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">Brand name on the cover (optional)<Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="CINTEXA NEXUS" maxLength={120} /></label>
          <label className="space-y-1 text-sm">Confidentiality label (optional)<Input value={conf} onChange={(e) => setConf(e.target.value)} placeholder="Confidential - prepared for the website owner" maxLength={200} /></label>
        </div>
        <div className="wi-no-print mt-4 flex flex-wrap gap-2">
          <Button onClick={() => run("download")} disabled={busy !== "idle"}><Download className="mr-2 h-4 w-4" />{busy === "download" ? "Building PDF" : "Download PDF"}</Button>
          <Button variant="outline" onClick={() => run("print")} disabled={busy !== "idle"}><Printer className="mr-2 h-4 w-4" />{busy === "print" ? "Preparing" : "Print report"}</Button>
        </div>
        {error ? <div className="mt-3"><ErrorNote error={error} /></div> : null}
      </Panel>

      {checks && (
        <Panel title="Validation" description={last ? `${last.fileName} - ${last.pages} pages, ${(last.sizeBytes / 1024).toFixed(0)} KB, report ${last.reportId}` : "The report was not offered because a check failed."}>
          <ul className="space-y-1 text-sm">{checks.map((c) => <li key={c.name} className="flex items-start gap-2">{c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-400" />}<span><b>{c.name}</b> <span className="text-muted-foreground">{c.detail}</span></span></li>)}</ul>
        </Panel>
      )}

      <Panel title="Generated reports" description="Recorded after validation. Files are generated on demand from the audit data.">
        {!history.data?.reports.length ? <p className="text-sm text-muted-foreground">Nothing generated yet.</p> : (
          <ul className="divide-y text-sm">{history.data.reports.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="break-all">{r.filename}</span><span className="text-xs text-muted-foreground">{REPORT_TYPE_LABELS[r.type]} - {r.pages} pages - {(r.bytes / 1024).toFixed(0)} KB - {fmtDate(r.createdAt)}</span></li>)}</ul>
        )}
      </Panel>
    </div>
  );
}
