import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { bdGet, bdPost, bdPatch } from "@/lib/business-diary/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Mode = "entries" | "pitches" | "feedback" | "followups" | "decisions" | "cases" | "insights";

/** Each mode renders different hooks; keying by mode remounts cleanly on navigation instead of crashing the page. */
export default function BdPage({ mode }: { mode: Mode }) {
  return <BdPageInner key={mode} mode={mode} />;
}

function BdPageInner({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["bd"] });

  if (mode === "entries") {
    const cats = useQuery({ queryKey: ["bd", "cats"], queryFn: () => bdGet<{ items: string[] }>("/categories") });
    const list = useQuery({ queryKey: ["bd", "entries"], queryFn: () => bdGet<{ items: any[] }>("/entries") });
    const [title, setTitle] = useState("");
    const [category, setCategory] = useState("Sales and Business Development");
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [desc, setDesc] = useState("");
    const create = useMutation({
      mutationFn: () => bdPost("/entries", { title, category, activityDate: date, description: desc }),
      onSuccess: () => { setTitle(""); setDesc(""); inv(); },
    });
    return (
      <Shell title="Diary entries" desc="Create and review business activities">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            {(cats.data?.items || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>Add entry</Button>
        </div>
        <Input className="mb-3" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="space-y-2">
          {(list.data?.items || []).map((e) => (
            <Card key={e.id}><CardContent className="py-3 text-sm">
              <div className="flex justify-between gap-2"><span className="font-medium">{e.title}</span>
                <Button size="sm" variant="ghost" onClick={() => bdPatch(`/entries/${e.id}`, { status: "archived" }).then(inv)}>Archive</Button>
              </div>
              <p className="text-xs text-muted-foreground">{e.activityDate} · {e.category}</p>
              {e.description && <p className="mt-1 text-muted-foreground">{e.description}</p>}
            </CardContent></Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "pitches") {
    const list = useQuery({ queryKey: ["bd", "pitches"], queryFn: () => bdGet<{ items: any[] }>("/pitches") });
    const [prospect, setProspect] = useState("");
    const [company, setCompany] = useState("");
    const [stage, setStage] = useState("prospecting");
    const create = useMutation({
      mutationFn: () => bdPost("/pitches", { prospect, company, pitchDate: new Date().toISOString().slice(0, 10), stage }),
      onSuccess: () => { setProspect(""); setCompany(""); inv(); },
    });
    return (
      <Shell title="Sales pitches" desc="Track pitch lifecycle">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Prospect" value={prospect} onChange={(e) => setProspect(e.target.value)} />
          <Input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={stage} onChange={(e) => setStage(e.target.value)}>
            {["prospecting", "contacted", "pitch_delivered", "interested", "negotiating", "won", "lost"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button disabled={!prospect || create.isPending} onClick={() => create.mutate()}>Add pitch</Button>
        </div>
        <div className="space-y-2">{(list.data?.items || []).map((p) => (
          <Card key={p.id}><CardContent className="py-3 text-sm"><p className="font-medium">{p.prospect} — {p.company || "—"}</p><p className="text-xs text-muted-foreground">{p.pitchDate} · {p.stage}</p></CardContent></Card>
        ))}</div>
      </Shell>
    );
  }

  if (mode === "feedback") {
    const list = useQuery({ queryKey: ["bd", "feedback"], queryFn: () => bdGet<{ items: any[] }>("/feedback") });
    const [customer, setCustomer] = useState("");
    const [body, setBody] = useState("");
    const create = useMutation({
      mutationFn: () => bdPost("/feedback", { customer, body }),
      onSuccess: () => { setCustomer(""); setBody(""); inv(); },
    });
    return (
      <Shell title="Customer feedback" desc="Local keyword sentiment classification">
        <div className="grid gap-2 mb-4">
          <Input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <Input placeholder="Feedback text" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button disabled={!customer || !body || create.isPending} onClick={() => create.mutate()}>Record feedback</Button>
        </div>
        <div className="space-y-2">{(list.data?.items || []).map((f) => (
          <Card key={f.id}><CardContent className="py-3 text-sm">
            <p className="font-medium">{f.customer} <span className="text-xs text-muted-foreground">({f.sentiment})</span></p>
            <p className="text-muted-foreground">{f.body}</p>
          </CardContent></Card>
        ))}</div>
      </Shell>
    );
  }

  if (mode === "followups") {
    const list = useQuery({ queryKey: ["bd", "fu"], queryFn: () => bdGet<{ items: any[] }>("/followups") });
    const [title, setTitle] = useState("");
    const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
    const create = useMutation({
      mutationFn: () => bdPost("/followups", { title, dueDate: due }),
      onSuccess: () => { setTitle(""); inv(); },
    });
    return (
      <Shell title="Follow-ups" desc="Tasks linked to diary work">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>Add task</Button>
        </div>
        <div className="space-y-2">{(list.data?.items || []).map((f) => (
          <Card key={f.id}><CardContent className="py-3 text-sm flex justify-between gap-2">
            <div><p className="font-medium">{f.title}</p><p className="text-xs text-muted-foreground">Due {f.dueDate || "—"} · {f.status}</p></div>
            {f.status !== "completed" && (
              <Button size="sm" variant="outline" onClick={() => bdPatch(`/followups/${f.id}`, { status: "completed" }).then(inv)}>Complete</Button>
            )}
          </CardContent></Card>
        ))}</div>
      </Shell>
    );
  }

  if (mode === "decisions") {
    const list = useQuery({ queryKey: ["bd", "dec"], queryFn: () => bdGet<{ items: any[] }>("/decisions") });
    const [title, setTitle] = useState("");
    const [reasoning, setReasoning] = useState("");
    const create = useMutation({
      mutationFn: () => bdPost("/decisions", { title, reasoning, decisionDate: new Date().toISOString().slice(0, 10) }),
      onSuccess: () => { setTitle(""); setReasoning(""); inv(); },
    });
    return (
      <Shell title="Management decisions" desc="Decision register">
        <div className="grid gap-2 mb-4">
          <Input placeholder="Decision title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Reasoning" value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>Record decision</Button>
        </div>
        <div className="space-y-2">{(list.data?.items || []).map((d) => (
          <Card key={d.id}><CardContent className="py-3 text-sm"><p className="font-medium">{d.title}</p><p className="text-xs text-muted-foreground">{d.decisionDate}</p>{d.reasoning && <p className="text-muted-foreground">{d.reasoning}</p>}</CardContent></Card>
        ))}</div>
      </Shell>
    );
  }

  if (mode === "cases") {
    const list = useQuery({ queryKey: ["bd", "cases"], queryFn: () => bdGet<{ items: any[] }>("/cases") });
    const [title, setTitle] = useState("");
    const [lessons, setLessons] = useState("");
    const create = useMutation({
      mutationFn: () => bdPost("/cases", { title, lessons, kind: "internal", verification: "unverified" }),
      onSuccess: () => { setTitle(""); setLessons(""); inv(); },
    });
    return (
      <Shell title="Case studies" desc="Internal library — never invent external facts">
        <div className="grid gap-2 mb-4">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Lessons" value={lessons} onChange={(e) => setLessons(e.target.value)} />
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>Add case study</Button>
        </div>
        <div className="space-y-2">{(list.data?.items || []).map((c) => (
          <Card key={c.id}><CardContent className="py-3 text-sm"><p className="font-medium">{c.title}</p><p className="text-xs text-muted-foreground">{c.kind} · {c.verification}</p>{c.lessons && <p>{c.lessons}</p>}</CardContent></Card>
        ))}</div>
      </Shell>
    );
  }

  // insights
  const ins = useQuery({ queryKey: ["bd", "insights"], queryFn: () => bdGet<any>("/insights") });
  const [question, setQuestion] = useState("What happened today?");
  const [answer, setAnswer] = useState<any>(null);
  const ask = useMutation({
    mutationFn: () => bdPost("/ask", { question }),
    onSuccess: setAnswer,
  });
  return (
    <Shell title="Native intelligence" desc="Rule-based analysis — not generative AI">
      {ins.data && (
        <div className="space-y-3 mb-6">
          <p className="text-xs text-muted-foreground">{ins.data.method}</p>
          <p className="text-sm">Keywords: {(ins.data.keywords || []).join(", ") || "—"}</p>
          <p className="text-sm">Successes: {ins.data.successCount} · Failures: {ins.data.failCount}</p>
          {(ins.data.recommendations || []).map((r: any, i: number) => (
            <Card key={i}><CardContent className="py-3 text-sm">
              <p className="font-medium">{r.title} <span className="text-xs uppercase text-muted-foreground">({r.priority})</span></p>
              <p className="text-muted-foreground">{r.evidence}</p>
              <p>{r.action}</p>
            </CardContent></Card>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input className="flex-1 min-w-[200px]" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <Button onClick={() => ask.mutate()} disabled={ask.isPending}>Ask</Button>
      </div>
      {answer && (
        <Card className="mt-3"><CardContent className="py-3 text-sm">
          <p>{answer.answer}</p>
          <p className="text-xs text-muted-foreground mt-1">Method: {answer.method}</p>
        </CardContent></Card>
      )}
    </Shell>
  );
}

function Shell({ title, desc, children }: { title: string; desc: string; children: import("react").ReactNode }) {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}
