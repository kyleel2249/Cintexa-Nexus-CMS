/**
 * CINTEXA Business Diary — Cloudflare Pages Function (/api/diary/*)
 * Zero third-party API keys. Isolate memory store; optional D1 via DIARY_DB later.
 */

type Entry = {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string;
  activityDate: string;
  recordedAt: string;
  location?: string;
  department?: string;
  clientName?: string;
  outcome?: string;
  successStatus?: string;
  priority: string;
  tags: string[];
  lessons?: string;
  followUpRequired: boolean;
  followUpDeadline?: string;
  status: "active" | "archived";
  createdBy?: string;
  updatedAt: string;
};

type FollowUp = {
  id: string;
  entryId?: string;
  title: string;
  description?: string;
  assignedTo?: string;
  priority: string;
  dueDate?: string;
  status: "pending" | "in_progress" | "completed" | "overdue" | "cancelled";
  completedAt?: string;
  createdAt: string;
};

type Pitch = {
  id: string;
  prospect: string;
  company?: string;
  industry?: string;
  product?: string;
  pitchDate: string;
  method?: string;
  amountMinor?: number;
  currency: string;
  stage: string;
  outcome?: string;
  lessons?: string;
  createdAt: string;
};

type Feedback = {
  id: string;
  customer: string;
  feedbackDate: string;
  category?: string;
  body: string;
  sentiment: string;
  severity?: string;
  resolutionStatus: string;
  createdAt: string;
};

type Decision = {
  id: string;
  title: string;
  decisionDate: string;
  owner?: string;
  reasoning?: string;
  expectedResult?: string;
  actualResult?: string;
  status: string;
  createdAt: string;
};

type CaseStudy = {
  id: string;
  kind: "internal" | "external";
  title: string;
  company?: string;
  country?: string;
  industry?: string;
  challenge?: string;
  actions?: string;
  results?: string;
  lessons?: string;
  sourceUrl?: string;
  verification: string;
  createdAt: string;
};

interface Store {
  entries: Entry[];
  followups: FollowUp[];
  pitches: Pitch[];
  feedback: Feedback[];
  decisions: Decision[];
  cases: CaseStudy[];
}

let memory: Store = {
  entries: [],
  followups: [],
  pitches: [],
  feedback: [],
  decisions: [],
  cases: [],
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function readJson(request: Request): Promise<any> {
  try {
    const t = await request.text();
    return t?.trim() ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

const CATEGORIES = [
  "Sales and Business Development",
  "Collaboration and Partnerships",
  "Customer Relations",
  "Marketing and Advertising",
  "Finance",
  "Operations",
  "Management",
  "Competition and Market Intelligence",
  "General Business",
];

/** Local rule-based sentiment — no external AI. */
function classifySentiment(text: string): "positive" | "negative" | "neutral" | "mixed" {
  const t = text.toLowerCase();
  const pos = ["thank", "great", "excellent", "happy", "satisfied", "love", "good", "pleased", "recommend"];
  const neg = ["complaint", "angry", "poor", "bad", "terrible", "delay", "refund", "broken", "unhappy", "worst"];
  let p = 0, n = 0;
  for (const w of pos) if (t.includes(w)) p++;
  for (const w of neg) if (t.includes(w)) n++;
  if (p > 0 && n > 0) return "mixed";
  if (p > n) return "positive";
  if (n > p) return "negative";
  return "neutral";
}

function extractKeywords(text: string, limit = 8): string[] {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "have", "were", "been", "are", "was", "our", "their"]);
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (w.length < 4 || stop.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

function inRange(date: string, from?: string, to?: string) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const active = memory.entries.filter((e) => e.status === "active");
  const pendingFu = memory.followups.filter((f) => f.status === "pending" || f.status === "in_progress" || f.status === "overdue");
  const won = memory.pitches.filter((p) => p.stage === "won" || p.outcome === "won").length;
  const lost = memory.pitches.filter((p) => p.stage === "lost" || p.outcome === "lost").length;
  const conversion = won + lost === 0 ? null : Math.round((won / (won + lost)) * 1000) / 10;
  return {
    totals: {
      entries: active.length,
      today: active.filter((e) => e.activityDate === today).length,
      week: active.filter((e) => e.activityDate >= weekAgo).length,
      month: active.filter((e) => e.activityDate >= monthAgo).length,
      pendingFollowUps: pendingFu.length,
      pitches: memory.pitches.length,
      feedback: memory.feedback.length,
      decisions: memory.decisions.length,
      caseStudies: memory.cases.length,
      pitchConversionPct: conversion,
    },
    recent: active.slice().sort((a, b) => b.activityDate.localeCompare(a.activityDate)).slice(0, 8),
    upcomingFollowUps: pendingFu.slice().sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 8),
    byCategory: CATEGORIES.map((c) => ({ category: c, count: active.filter((e) => e.category === c).length })).filter((x) => x.count > 0),
    apiKeysRequired: false,
    engine: "native-diary-v1",
  };
}

function insights() {
  const active = memory.entries.filter((e) => e.status === "active");
  const keywords = extractKeywords(active.map((e) => `${e.title} ${e.description} ${e.lessons || ""}`).join(" "));
  const failed = active.filter((e) => e.successStatus === "unsuccessful" || e.successStatus === "failed");
  const successes = active.filter((e) => e.successStatus === "successful" || e.successStatus === "won");
  const recs: { title: string; evidence: string; action: string; priority: string }[] = [];
  if (failed.length >= 2) {
    recs.push({
      title: "Review recurring unsuccessful activities",
      evidence: `${failed.length} entries marked unsuccessful/failed`,
      action: "Inspect lessons fields and assign follow-ups on root causes",
      priority: "high",
    });
  }
  if (memory.followups.filter((f) => f.status === "overdue" || (f.dueDate && f.dueDate < new Date().toISOString().slice(0, 10) && f.status === "pending")).length > 0) {
    recs.push({
      title: "Clear overdue follow-ups",
      evidence: "One or more follow-ups are past due",
      action: "Complete or re-schedule overdue tasks this week",
      priority: "high",
    });
  }
  const won = memory.pitches.filter((p) => p.stage === "won").length;
  const lost = memory.pitches.filter((p) => p.stage === "lost").length;
  if (lost > won && lost + won >= 3) {
    recs.push({
      title: "Analyse lost pitch patterns",
      evidence: `Lost ${lost} vs won ${won}`,
      action: "Compare objections and industries on lost pitches",
      priority: "medium",
    });
  }
  if (!recs.length && active.length) {
    recs.push({
      title: "Continue structured diary capture",
      evidence: `${active.length} active entries`,
      action: "Keep tagging outcomes and lessons for stronger trend detection",
      priority: "low",
    });
  }
  return {
    keywords,
    successCount: successes.length,
    failCount: failed.length,
    recommendations: recs,
    method: "Rule-based scoring and keyword frequency over stored diary records. Not generative AI.",
  };
}

function answerQuestion(q: string) {
  const s = q.toLowerCase();
  const dash = dashboard();
  if (s.includes("today")) {
    return { answer: `Today there are ${dash.totals.today} diary activit${dash.totals.today === 1 ? "y" : "ies"} recorded.`, source: "counts.today", method: "deterministic_count" };
  }
  if (s.includes("follow")) {
    return { answer: `There are ${dash.totals.pendingFollowUps} pending follow-up(s).`, source: "followups", method: "deterministic_count" };
  }
  if (s.includes("pitch") || s.includes("sales")) {
    return {
      answer: `Sales pitches tracked: ${dash.totals.pitches}. Conversion (won/(won+lost)): ${dash.totals.pitchConversionPct ?? "n/a"}%.`,
      source: "pitches",
      method: "deterministic_count",
    };
  }
  if (s.includes("week")) {
    return { answer: `${dash.totals.week} activit${dash.totals.week === 1 ? "y" : "ies"} in the last 7 days.`, source: "counts.week", method: "deterministic_count" };
  }
  if (s.includes("complaint") || s.includes("feedback")) {
    const neg = memory.feedback.filter((f) => f.sentiment === "negative").length;
    return { answer: `${memory.feedback.length} feedback record(s); ${neg} classified negative by local keyword rules.`, source: "feedback", method: "rule_sentiment" };
  }
  return {
    answer: "Supported questions cover today/week activity counts, follow-ups, pitches/conversion, and feedback. Rephrase or open the dashboard for full analytics.",
    source: null,
    method: "unsupported_query_map",
  };
}

type Env = { DIARY_DB?: D1Database };

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const path = parts.join("/");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;

  if (path === "" || path === "dashboard") return json(dashboard());
  if (path === "categories") return json({ items: CATEGORIES });
  if (path === "insights") return json(insights());
  if (path === "meta") {
    return json({
      name: "CINTEXA Business Diary",
      version: "1.0.0",
      apiKeysRequired: false,
      firebase: false,
      storage: "isolate-memory",
      engine: "native-diary-v1",
    });
  }

  if (path === "ask" && request.method === "POST") {
    const body = await readJson(request);
    return json(answerQuestion(String(body.question || "")));
  }

  // --- entries ---
  if (path === "entries" && request.method === "GET") {
    let items = memory.entries.filter((e) => e.status !== "archived" || url.searchParams.get("archived") === "1");
    const cat = url.searchParams.get("category");
    const q = (url.searchParams.get("q") || "").toLowerCase();
    if (cat) items = items.filter((e) => e.category === cat);
    if (from || to) items = items.filter((e) => inRange(e.activityDate, from, to));
    if (q) items = items.filter((e) => `${e.title} ${e.description} ${e.clientName}`.toLowerCase().includes(q));
    items = items.slice().sort((a, b) => b.activityDate.localeCompare(a.activityDate));
    return json({ items });
  }

  if (path === "entries" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.title || !body.category || !body.activityDate) {
      return json({ error: "title, category, activityDate required" }, 400);
    }
    const now = new Date().toISOString();
    const entry: Entry = {
      id: crypto.randomUUID(),
      title: String(body.title).slice(0, 300),
      description: String(body.description || "").slice(0, 5000),
      category: String(body.category),
      subcategory: body.subcategory ? String(body.subcategory).slice(0, 120) : undefined,
      activityDate: String(body.activityDate).slice(0, 10),
      recordedAt: now,
      location: body.location ? String(body.location).slice(0, 200) : undefined,
      department: body.department ? String(body.department).slice(0, 120) : undefined,
      clientName: body.clientName ? String(body.clientName).slice(0, 200) : undefined,
      outcome: body.outcome ? String(body.outcome).slice(0, 2000) : undefined,
      successStatus: body.successStatus ? String(body.successStatus).slice(0, 40) : undefined,
      priority: String(body.priority || "medium").slice(0, 20),
      tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
      lessons: body.lessons ? String(body.lessons).slice(0, 2000) : undefined,
      followUpRequired: Boolean(body.followUpRequired),
      followUpDeadline: body.followUpDeadline ? String(body.followUpDeadline).slice(0, 10) : undefined,
      status: "active",
      createdBy: body.createdBy ? String(body.createdBy).slice(0, 120) : undefined,
      updatedAt: now,
    };
    memory.entries.push(entry);
    return json({ entry }, 201);
  }

  if (path.startsWith("entries/") && request.method === "PATCH") {
    const id = path.split("/")[1];
    const body = await readJson(request);
    const idx = memory.entries.findIndex((e) => e.id === id);
    if (idx < 0) return json({ error: "Not found" }, 404);
    const cur = memory.entries[idx]!;
    const next = {
      ...cur,
      title: body.title != null ? String(body.title).slice(0, 300) : cur.title,
      description: body.description != null ? String(body.description).slice(0, 5000) : cur.description,
      outcome: body.outcome != null ? String(body.outcome).slice(0, 2000) : cur.outcome,
      successStatus: body.successStatus != null ? String(body.successStatus).slice(0, 40) : cur.successStatus,
      lessons: body.lessons != null ? String(body.lessons).slice(0, 2000) : cur.lessons,
      status: body.status === "archived" ? "archived" as const : body.status === "active" ? "active" as const : cur.status,
      updatedAt: new Date().toISOString(),
    };
    memory.entries[idx] = next;
    return json({ entry: next });
  }

  // --- follow-ups ---
  if (path === "followups" && request.method === "GET") return json({ items: memory.followups });
  if (path === "followups" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.title) return json({ error: "title required" }, 400);
    const fu: FollowUp = {
      id: crypto.randomUUID(),
      entryId: body.entryId ? String(body.entryId) : undefined,
      title: String(body.title).slice(0, 300),
      description: body.description ? String(body.description).slice(0, 2000) : undefined,
      assignedTo: body.assignedTo ? String(body.assignedTo).slice(0, 120) : undefined,
      priority: String(body.priority || "medium"),
      dueDate: body.dueDate ? String(body.dueDate).slice(0, 10) : undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    memory.followups.push(fu);
    return json({ followUp: fu }, 201);
  }
  if (path.startsWith("followups/") && request.method === "PATCH") {
    const id = path.split("/")[1];
    const body = await readJson(request);
    const idx = memory.followups.findIndex((f) => f.id === id);
    if (idx < 0) return json({ error: "Not found" }, 404);
    const cur = memory.followups[idx]!;
    const status = body.status ? String(body.status) : cur.status;
    memory.followups[idx] = {
      ...cur,
      status: status as FollowUp["status"],
      completedAt: status === "completed" ? new Date().toISOString() : cur.completedAt,
    };
    return json({ followUp: memory.followups[idx] });
  }

  // --- pitches ---
  if (path === "pitches" && request.method === "GET") return json({ items: memory.pitches });
  if (path === "pitches" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.prospect || !body.pitchDate) return json({ error: "prospect and pitchDate required" }, 400);
    const pitch: Pitch = {
      id: crypto.randomUUID(),
      prospect: String(body.prospect).slice(0, 200),
      company: body.company ? String(body.company).slice(0, 200) : undefined,
      industry: body.industry ? String(body.industry).slice(0, 120) : undefined,
      product: body.product ? String(body.product).slice(0, 200) : undefined,
      pitchDate: String(body.pitchDate).slice(0, 10),
      method: body.method ? String(body.method).slice(0, 80) : undefined,
      amountMinor: body.amountMinor != null ? Math.round(Number(body.amountMinor)) : undefined,
      currency: String(body.currency || "GHS").slice(0, 8),
      stage: String(body.stage || "prospecting").slice(0, 40),
      outcome: body.outcome ? String(body.outcome).slice(0, 500) : undefined,
      lessons: body.lessons ? String(body.lessons).slice(0, 2000) : undefined,
      createdAt: new Date().toISOString(),
    };
    memory.pitches.push(pitch);
    return json({ pitch }, 201);
  }

  // --- feedback ---
  if (path === "feedback" && request.method === "GET") return json({ items: memory.feedback });
  if (path === "feedback" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.customer || !body.body) return json({ error: "customer and body required" }, 400);
    const text = String(body.body);
    const fb: Feedback = {
      id: crypto.randomUUID(),
      customer: String(body.customer).slice(0, 200),
      feedbackDate: String(body.feedbackDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      category: body.category ? String(body.category).slice(0, 80) : undefined,
      body: text.slice(0, 5000),
      sentiment: body.sentiment ? String(body.sentiment) : classifySentiment(text),
      severity: body.severity ? String(body.severity).slice(0, 40) : undefined,
      resolutionStatus: String(body.resolutionStatus || "open"),
      createdAt: new Date().toISOString(),
    };
    memory.feedback.push(fb);
    return json({ feedback: fb }, 201);
  }

  // --- decisions ---
  if (path === "decisions" && request.method === "GET") return json({ items: memory.decisions });
  if (path === "decisions" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.title || !body.decisionDate) return json({ error: "title and decisionDate required" }, 400);
    const d: Decision = {
      id: crypto.randomUUID(),
      title: String(body.title).slice(0, 300),
      decisionDate: String(body.decisionDate).slice(0, 10),
      owner: body.owner ? String(body.owner).slice(0, 120) : undefined,
      reasoning: body.reasoning ? String(body.reasoning).slice(0, 3000) : undefined,
      expectedResult: body.expectedResult ? String(body.expectedResult).slice(0, 2000) : undefined,
      actualResult: body.actualResult ? String(body.actualResult).slice(0, 2000) : undefined,
      status: "recorded",
      createdAt: new Date().toISOString(),
    };
    memory.decisions.push(d);
    return json({ decision: d }, 201);
  }

  // --- case studies ---
  if (path === "cases" && request.method === "GET") return json({ items: memory.cases });
  if (path === "cases" && request.method === "POST") {
    const body = await readJson(request);
    if (!body.title) return json({ error: "title required" }, 400);
    const c: CaseStudy = {
      id: crypto.randomUUID(),
      kind: body.kind === "external" ? "external" : "internal",
      title: String(body.title).slice(0, 300),
      company: body.company ? String(body.company).slice(0, 200) : undefined,
      country: body.country ? String(body.country).slice(0, 80) : undefined,
      industry: body.industry ? String(body.industry).slice(0, 120) : undefined,
      challenge: body.challenge ? String(body.challenge).slice(0, 3000) : undefined,
      actions: body.actions ? String(body.actions).slice(0, 3000) : undefined,
      results: body.results ? String(body.results).slice(0, 3000) : undefined,
      lessons: body.lessons ? String(body.lessons).slice(0, 3000) : undefined,
      sourceUrl: body.sourceUrl ? String(body.sourceUrl).slice(0, 500) : undefined,
      verification: body.verification ? String(body.verification).slice(0, 40) : "unverified",
      createdAt: new Date().toISOString(),
    };
    memory.cases.push(c);
    return json({ caseStudy: c }, 201);
  }

  if (path === "seed-demo" && request.method === "POST") {
    if (memory.entries.some((e) => e.tags.includes("DEMO"))) return json({ ok: true, message: "Demo already present" });
    const today = new Date().toISOString().slice(0, 10);
    memory.entries.push({
      id: crypto.randomUUID(),
      title: "Client discovery meeting — Accra",
      description: "Discussed logistics needs and timeline for Q1 expansion.",
      category: "Sales and Business Development",
      subcategory: "Customer meetings",
      activityDate: today,
      recordedAt: new Date().toISOString(),
      clientName: "Demo Client Ltd",
      successStatus: "successful",
      priority: "high",
      tags: ["DEMO", "sales"],
      lessons: "Prepare pricing sheet before next visit.",
      followUpRequired: true,
      followUpDeadline: today,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    memory.pitches.push({
      id: crypto.randomUUID(),
      prospect: "Ama Mensah",
      company: "Demo Client Ltd",
      industry: "Logistics",
      product: "Fleet tracking",
      pitchDate: today,
      method: "in-person",
      amountMinor: 2500000,
      currency: "GHS",
      stage: "negotiating",
      createdAt: new Date().toISOString(),
    });
    memory.feedback.push({
      id: crypto.randomUUID(),
      customer: "Demo Client Ltd",
      feedbackDate: today,
      body: "Service was good but delivery was delayed by two days.",
      sentiment: classifySentiment("Service was good but delivery was delayed by two days."),
      resolutionStatus: "open",
      createdAt: new Date().toISOString(),
    });
    memory.followups.push({
      id: crypto.randomUUID(),
      title: "Send revised quotation",
      priority: "high",
      dueDate: today,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true, message: "Demo diary data loaded (tagged DEMO)." });
  }

  return json({ error: "Not found", path }, 404);
};
