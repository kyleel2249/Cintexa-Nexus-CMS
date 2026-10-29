import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, TextField } from "./ui-bits";
import { analyzeUrl, VERDICT_TEXT, type Severity, type UrlReport } from "@/lib/sentinel-key/url-check";
import { cn } from "@/lib/utils";

const SEV: Record<Severity, { icon: typeof Info; cls: string; label: string }> = {
  high: { icon: AlertOctagon, cls: "text-rose-500 border-rose-500/40 bg-rose-500/10", label: "High" },
  medium: { icon: AlertTriangle, cls: "text-amber-500 border-amber-500/40 bg-amber-500/10", label: "Medium" },
  low: { icon: ShieldAlert, cls: "text-yellow-500 border-yellow-500/30 bg-yellow-500/5", label: "Low" },
  info: { icon: Info, cls: "text-sky-500 border-sky-500/30 bg-sky-500/5", label: "Info" },
};

const CHECKLIST = [
  "Type the address yourself or use a saved bookmark instead of following a link in a message.",
  "Read the domain just before the first single slash. That part decides who owns the page.",
  "Be wary of urgency, threats, prizes or requests to \"verify\" an account.",
  "A padlock or HTTPS only means the connection is encrypted, not that the site is honest.",
  "If a password manager does not offer your saved login on a site, treat that as a warning.",
  "Use passkeys or multi-factor authentication so a stolen password alone is not enough.",
];

export function SafetyPanel() {
  const reduce = useReducedMotion();
  const [url, setUrl] = useState("");
  const [expected, setExpected] = useState("");
  const [report, setReport] = useState<UrlReport | null>(null);
  const run = () => setReport(analyzeUrl(url, expected));
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-4">
        <form className="rounded-xl border bg-card p-4 space-y-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <TextField id="ws-url" label="Address to check" value={url} onChange={(v) => { setUrl(v); setReport(null); }} maxLength={2048} placeholder="https://example.com/login" hint="The address is analysed here in your browser. It is never opened or sent anywhere." />
          <TextField id="ws-expected" label="Website you expected (optional)" value={expected} onChange={(v) => { setExpected(v); setReport(null); }} maxLength={2048} placeholder="https://example.com" hint="Warns when the address does not match the site where a credential belongs." />
          <Button type="submit" disabled={!url.trim()}>Check address</Button>
        </form>
        <div role="status" aria-live="polite">
          {report && (
            <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                {report.verdict === "no-red-flags" ? <CheckCircle2 className="h-5 w-5 text-sky-500" aria-hidden /> : <AlertOctagon className={cn("h-5 w-5", report.verdict === "high-risk" ? "text-rose-500" : "text-amber-500")} aria-hidden />}
                <h3 className="font-semibold">{VERDICT_TEXT[report.verdict]}</h3>
              </div>
              {report.hostname && <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4"><dt className="text-muted-foreground">Domain</dt><dd className="font-mono break-all">{report.registrableDomain}</dd>{report.unicodeHostname !== report.hostname && <><dt className="text-muted-foreground">Shown as</dt><dd className="font-mono break-all">{report.unicodeHostname}</dd></>}<dt className="text-muted-foreground">Full host</dt><dd className="font-mono break-all">{report.hostname}</dd></dl>}
              <ul className="space-y-2">
                {report.findings.map((f) => { const s = SEV[f.severity]; const Icon = s.icon; return (
                  <li key={f.id} className={cn("flex gap-3 rounded-lg border p-3 text-sm", s.cls)}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div><p className="font-medium text-foreground"><span className="sr-only">{s.label} severity: </span>{f.title}</p><p className="text-muted-foreground">{f.detail}</p></div>
                  </li>); })}
              </ul>
              <p className="text-xs text-muted-foreground">These are heuristic checks on the text of the address only. They cannot see the page, its owner or its reputation, so a result is never a guarantee that a site is safe or unsafe.</p>
            </motion.div>
          )}
        </div>
      </div>
      <div className="lg:col-span-2 space-y-4">
        <div className="rounded-xl border bg-card p-4"><h3 className="font-medium mb-2">Before you sign in</h3><ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">{CHECKLIST.map((c) => <li key={c}>{c}</li>)}</ul></div>
        <Notice>Reputation lookups (known-phishing lists) are not configured in this build, so no URL is ever sent to a third party. Adding one would require a server-side proxy with a protected API key and rate limiting.</Notice>
      </div>
    </div>
  );
}
