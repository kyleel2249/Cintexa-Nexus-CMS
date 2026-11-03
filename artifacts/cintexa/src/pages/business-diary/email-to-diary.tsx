import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { bdGet, bdPost } from "@/lib/business-diary/api";
import { extractFromCorrespondence, getRemoteReadyFixtureBody } from "@/lib/business-diary/extract";
import { publishNexusEvent } from "@/lib/nexus-sync/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Extraction = ReturnType<typeof extractFromCorrespondence>;

export default function EmailToDiaryPage() {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [activityDate, setActivityDate] = useState("2026-11-03");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [correspondenceId, setCorrespondenceId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [organization, setOrganization] = useState("");
  const [priority, setPriority] = useState("high");
  const [status, setStatus] = useState("Awaiting Response");
  const [successStatus, setSuccessStatus] = useState("Pending");
  const [followUpRequired, setFollowUpRequired] = useState<"yes" | "no" | "requires_review">("yes");
  const [suggestedFollowUp, setSuggestedFollowUp] = useState("");
  const [tags, setTags] = useState("");
  const [verification, setVerification] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  const applyExtraction = (ex: Extraction) => {
    setExtraction(ex);
    setTitle(ex.title.value);
    setCategory(ex.category.value);
    setSubcategory(ex.subcategory.value);
    setOrganization(ex.organization.name?.value || "");
    setPriority(ex.priority.value);
    setStatus(ex.status.value);
    setSuccessStatus(ex.successStatus.value);
    setFollowUpRequired(ex.followUpRequired.value);
    setSuggestedFollowUp(ex.suggestedFollowUp.value);
    setTags(ex.tags.join(", "));
    setVerification(ex.verification);
    if (ex.activityDate.value) setActivityDate(ex.activityDate.value);
  };

  const processLocal = () => {
    const ex = extractFromCorrespondence({ body, subject, activityDate });
    applyExtraction(ex);
    setCorrespondenceId(null);
    setSavedId(null);
  };

  const processRemote = useMutation({
    mutationFn: () =>
      bdPost<{ correspondenceId: string; extraction: Extraction }>("/email/process", {
        body,
        subject,
        activityDate,
      }),
    onSuccess: (r) => {
      setCorrespondenceId(r.correspondenceId);
      // Prefer server extraction shape; fall back to local for type safety
      try {
        applyExtraction(r.extraction as Extraction);
      } catch {
        applyExtraction(extractFromCorrespondence({ body, subject, activityDate }));
      }
    },
  });

  const approve = useMutation({
    mutationFn: () =>
      bdPost<{ entry: { id: string } }>("/email/approve", {
        correspondenceId,
        title,
        category,
        subcategory,
        organization,
        activityDate,
        priority,
        successStatus,
        followUpRequired,
        suggestedFollowUp,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        description: extraction?.executiveSummary || body.slice(0, 2000),
        extraction,
        opportunities: extraction?.opportunities || [],
        commitments: extraction?.commitments || [],
      }),
    onSuccess: async (r) => {
      setSavedId(r.entry.id);
      qc.invalidateQueries({ queryKey: ["bd"] });
      try {
        await publishNexusEvent({
          eventType: "DIARY_ENTRY_CREATED",
          sourceModule: "business-diary",
          entityType: "diary_entry",
          entityId: r.entry.id,
          payload: { title, organization },
          idempotencyKey: `email-to-diary:${r.entry.id}`,
        });
      } catch { /* optional */ }
    },
  });

  const loadGrr = () => {
    const fixture = getRemoteReadyFixtureBody();
    setBody(fixture);
    setSubject("Strategic Partnership Proposal — CINTEXA x Get Remote Ready");
    setActivityDate("2026-11-03");
    setSavedId(null);
    const ex = extractFromCorrespondence({ body: fixture, activityDate: "2026-11-03" });
    applyExtraction(ex);
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Email-to-Diary Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Native extraction · zero API keys · review before permanent save
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={loadGrr}>Load Get Remote Ready fixture</Button>
          <Link href="/business-diary"><Button size="sm" variant="ghost">Diary home</Button></Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Correspondence</CardTitle>
          <CardDescription>Paste email, proposal, or notes. TXT-style content supported.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
          <textarea
            className="min-h-[200px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Paste correspondence here…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!body.trim()} onClick={processLocal}>Process (local engine)</Button>
            <Button variant="outline" disabled={!body.trim() || processRemote.isPending} onClick={() => processRemote.mutate()}>
              {processRemote.isPending ? "Processing…" : "Process via API"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {extraction && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Record configuration</CardTitle>
              <CardDescription>Autofilled from extraction — edit before approval. Method: {extraction.method}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" value={title} onChange={setTitle} />
              <Field label="Category" value={category} onChange={setCategory} />
              <Field label="Subcategory" value={subcategory} onChange={setSubcategory} />
              <Field label="Organization" value={organization} onChange={setOrganization} />
              <Field label="Activity date" value={activityDate} onChange={setActivityDate} />
              <Field label="Priority" value={priority} onChange={setPriority} />
              <Field label="Status" value={status} onChange={setStatus} />
              <Field label="Success status" value={successStatus} onChange={setSuccessStatus} />
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Follow-up required</label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={followUpRequired} onChange={(e) => setFollowUpRequired(e.target.value as any)}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="requires_review">Requires review</option>
                </select>
              </div>
              <div className="sm:col-span-2"><Field label="Suggested follow-up" value={suggestedFollowUp} onChange={setSuggestedFollowUp} /></div>
              <div className="sm:col-span-2"><Field label="Tags (comma-separated)" value={tags} onChange={setTags} /></div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Verification</label>
                <p className="mt-1 text-sm rounded border p-2">{verification}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">3. Executive summary</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>{extraction.executiveSummary}</p>
              {extraction.objectives.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {extraction.objectives.map((o) => <li key={o}>{o}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Revenue opportunities</CardTitle>
              <CardDescription>Values not invented — &quot;Value Not Yet Established&quot; when unknown</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {extraction.opportunities.length === 0 && <p className="text-muted-foreground">None detected</p>}
              {extraction.opportunities.map((o, i) => (
                <div key={i} className="rounded border p-3">
                  <p className="font-medium">{o.title}</p>
                  <p className="text-xs text-muted-foreground">{o.category} · {o.stage} · {o.estimatedValue}</p>
                  <p className="text-muted-foreground">{o.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">5. Commitments</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {extraction.commitments.map((c, i) => (
                <div key={i} className="rounded border p-3">
                  <p className="font-medium">{c.title} <span className="text-xs text-muted-foreground">({c.party})</span></p>
                  <p className="text-muted-foreground">{c.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? "Saving…" : "Approve and save permanently"}
            </Button>
            <Button variant="outline" onClick={() => { setExtraction(null); setSavedId(null); }}>Cancel</Button>
          </div>

          {savedId && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="py-4 text-sm">
                Saved diary entry <code className="text-xs">{savedId}</code>. Opportunities, commitments and follow-ups linked.{" "}
                <Link href="/business-diary/entries"><span className="text-primary underline cursor-pointer">View entries</span></Link>
              </CardContent>
            </Card>
          )}
          {approve.isError && (
            <p className="text-sm text-rose-600">Save failed — is /api/diary deployed? You can still use Process (local) to preview.</p>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
