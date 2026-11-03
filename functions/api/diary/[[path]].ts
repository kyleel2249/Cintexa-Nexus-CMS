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
  opportunities: Opportunity[];
  commitments: Commitment[];
  organizations: OrgProfile[];
  correspondence: Correspondence[];
}

type Opportunity = {
  id: string;
  diaryEntryId?: string;
  title: string;
  organization?: string;
  category: string;
  description: string;
  stage: string;
  estimatedValue: string;
  status: string;
  createdAt: string;
};

type Commitment = {
  id: string;
  diaryEntryId?: string;
  title: string;
  description: string;
  party: string;
  priority: string;
  status: string;
  dueDate?: string;
  createdAt: string;
};

type OrgProfile = {
  id: string;
  name: string;
  website?: string;
  industry?: string;
  relationshipStatus: string;
  lastEngagement?: string;
  createdAt: string;
};

type Correspondence = {
  id: string;
  subject?: string;
  body: string;
  extraction?: unknown;
  diaryEntryId?: string;
  status: string;
  createdAt: string;
};

let memory: Store = {
  entries: [],
  followups: [],
  pitches: [],
  feedback: [],
  decisions: [],
  cases: [],
  opportunities: [],
  commitments: [],
  organizations: [],
  correspondence: [],
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
      opportunities: memory.opportunities.length,
      commitments: memory.commitments.filter((c) => c.status !== "completed").length,
      organizations: memory.organizations.length,
      correspondence: memory.correspondence.length,
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


function nativeExtract(input: { body: string; subject?: string; activityDate?: string; sender?: string }): any {
  const body = (input.body || "").trim();
  const subject = (input.subject || "").trim();
  const text = `${subject}\n${body}`.toLowerCase();
  const raw = `${subject}\n${body}`;
  const partnership = /partnership|collaborat|joint venture|revenue shar/.test(text);
  const orgMatch = raw.match(/Get Remote Ready/i) || raw.match(/(?:to|for|with)\s+([A-Z][A-Za-z0-9&.\s]{2,40})/);
  const orgName = /get remote ready/i.test(raw) ? "Get Remote Ready" : (orgMatch && orgMatch[1] ? orgMatch[1].trim() : undefined);
  const emails = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const urls = raw.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  let category = "General Business";
  let subcategory = "Miscellaneous business events";
  if (partnership) {
    category = "Collaboration and Partnerships";
    subcategory = "Strategic Partnership Development";
  } else if (/quotat|proposal|pricing|order/.test(text)) {
    category = "Sales and Business Development";
    subcategory = "Client Enquiry";
  }
  const title = orgName && partnership
    ? `Partnership Proposal to ${orgName}`
    : orgName
      ? `Business correspondence — ${orgName}`
      : "Business correspondence record";
  const opportunities: any[] = [];
  const addOpp = (title: string, category: string, description: string) =>
    opportunities.push({ title, category, description, stage: "Identified", estimatedValue: "Value Not Yet Established", confidence: "suggested" });
  if (/software|application/.test(text)) addOpp(`Software development for ${orgName || "organisation"}`, "Software Development", "Suggested from text");
  if (/website|web development/.test(text)) addOpp(`Website development for ${orgName || "organisation"}`, "Website Development", "Suggested from text");
  if (/automat/.test(text)) addOpp(`Business automation services for ${orgName || "organisation"}`, "Business Automation", "Suggested from text");
  if (/train|course/.test(text)) addOpp(`Technology training / course development with ${orgName || "organisation"}`, "Training", "Suggested from text");
  if (/recruit|talent|placement/.test(text)) addOpp(`Recruitment / talent placement with ${orgName || "organisation"}`, "Recruitment", "Suggested from text");
  if (/support|maintenance/.test(text)) addOpp(`Ongoing technical support for ${orgName || "organisation"}`, "Maintenance", "Suggested from text");
  if (partnership && /revenue/.test(text)) addOpp(`Training revenue-sharing arrangement with ${orgName || "organisation"}`, "Partnership Revenue Sharing", "Terms not confirmed");
  const tags = ["Client Engagement"];
  if (orgName) tags.unshift(orgName);
  if (partnership) tags.push("Strategic Partnership", "Business Development");
  if (/software/.test(text)) tags.push("Software Development");
  if (/website/.test(text)) tags.push("Website Development");
  if (/automat/.test(text)) tags.push("Business Automation");
  if (/train/.test(text)) tags.push("Technology Training");
  if (/talent|recruit/.test(text)) tags.push("Talent Acquisition");
  if (/revenue shar/.test(text)) tags.push("Revenue Sharing");
  tags.push("Follow-up Required");
  const contacts: any[] = [];
  if (/elsie/i.test(raw)) contacts.push({ name: { value: "Elsie and the Get Remote Ready Team", confidence: "extracted" } });
  for (const e of [...new Set(emails)].slice(0, 3)) contacts.push({ email: { value: e, confidence: "extracted" } });
  return {
    title: { value: title, confidence: "extracted" },
    category: { value: category, confidence: partnership ? "extracted" : "suggested" },
    subcategory: { value: subcategory, confidence: "extracted" },
    organization: {
      name: orgName ? { value: orgName, confidence: "extracted" } : undefined,
      website: urls.find((u) => /getremoteready/i.test(u)) ? { value: "https://getremoteready.co/", confidence: "extracted" } : (urls[0] ? { value: urls[0], confidence: "extracted" } : undefined),
      industry: /remote|train/i.test(text) ? { value: "Remote employment / technology training", confidence: "inferred" } : undefined,
    },
    contacts,
    activityDate: { value: input.activityDate || (raw.match(/20\d{2}-\d{2}-\d{2}/) || [])[0] || "", confidence: input.activityDate ? "confirmed" : "extracted" },
    priority: { value: partnership ? "high" : "normal", confidence: "inferred" },
    status: { value: "Awaiting Response", confidence: "suggested" },
    successStatus: { value: "Pending", confidence: "suggested" },
    followUpRequired: { value: "yes", confidence: "inferred" },
    verification: "Proposal or correspondence captured. Commercial terms and partnership agreement not confirmed. Outcome pending.",
    executiveSummary: `${title}. Review extracted fields before approval. Native extraction only — no external AI.`,
    description: body.slice(0, 4000),
    objectives: partnership ? ["Explore strategic partnership", "Discuss mutual capabilities"] : [],
    opportunities,
    commitments: [
      { title: "Await external response", description: "Awaiting feedback from the other party", party: "external", priority: "high", confidence: "extracted" },
      { title: "Schedule introductory discussion", description: "Arrange meeting if interest is confirmed", party: "unclear", priority: "normal", confidence: "suggested" },
    ],
    suggestedFollowUp: { value: orgName ? `Contact ${orgName} to request feedback and arrange an introductory partnership meeting` : "Confirm next contact action", confidence: "suggested" },
    tags: [...new Set(tags)].slice(0, 16),
    risks: ["Commercial terms not agreed", "Partnership not active until confirmed"],
    method: "native-regex-keyword-v1",
  };
}

const GRR_FIXTURE = `Subject: Strategic Partnership Proposal — CINTEXA x Get Remote Ready

Dear Elsie and the Get Remote Ready Team,

We are writing from CINTEXA (https://cintexa.com/) to propose a strategic partnership with Get Remote Ready (https://getremoteready.co/).

Get Remote Ready focuses on remote employment readiness, technology training and talent pathways. CINTEXA can support complementary capabilities including:

- Website and software development
- Business automation services
- Technology training and course development
- Training revenue-sharing arrangements
- Recruitment and technology talent placement
- Ongoing technical support and maintenance

We would welcome the opportunity to discuss mutual objectives, explore collaboration models and agree next steps. Commercial terms, revenue sharing and formal partnership agreements are not yet defined and would need joint discussion.

Please reply with your feedback or a suitable time for an introductory partnership meeting.

Kind regards,
CINTEXA Team
Date: 2026-11-03
`;


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


  // --- Email-to-Diary: process (native extraction, no external AI) ---
  if (path === "email/process" && request.method === "POST") {
    const body = await readJson(request);
    const text = String(body.body || body.text || "");
    if (!text.trim()) return json({ error: "body required" }, 400);
    const extraction = nativeExtract({
      body: text,
      subject: body.subject ? String(body.subject) : undefined,
      activityDate: body.activityDate ? String(body.activityDate) : undefined,
      sender: body.sender ? String(body.sender) : undefined,
    });
    const corr: Correspondence = {
      id: crypto.randomUUID(),
      subject: body.subject ? String(body.subject).slice(0, 300) : undefined,
      body: text.slice(0, 100000),
      extraction,
      status: "processed",
      createdAt: new Date().toISOString(),
    };
    memory.correspondence.push(corr);
    return json({ correspondenceId: corr.id, extraction, method: extraction.method, apiKeysRequired: false }, 201);
  }

  if (path === "email/approve" && request.method === "POST") {
    const body = await readJson(request);
    const extraction = body.extraction || {};
    const now = new Date().toISOString();
    const title = String(body.title || extraction.title?.value || "Business correspondence").slice(0, 300);
    const category = String(body.category || extraction.category?.value || "General Business");
    const activityDate = String(body.activityDate || extraction.activityDate?.value || now.slice(0, 10)).slice(0, 10);
    const orgName = String(body.organization || extraction.organization?.name?.value || "").slice(0, 200);

    let orgId: string | undefined;
    if (orgName) {
      let org = memory.organizations.find((o) => o.name.toLowerCase() === orgName.toLowerCase());
      if (!org) {
        org = {
          id: crypto.randomUUID(),
          name: orgName,
          website: extraction.organization?.website?.value,
          industry: extraction.organization?.industry?.value,
          relationshipStatus: "Contacted",
          lastEngagement: activityDate,
          createdAt: now,
        };
        memory.organizations.push(org);
      } else {
        org.lastEngagement = activityDate;
      }
      orgId = org.id;
    }

    const entry: Entry = {
      id: crypto.randomUUID(),
      title,
      description: String(body.description || extraction.executiveSummary || extraction.description || "").slice(0, 5000),
      category,
      subcategory: body.subcategory || extraction.subcategory?.value,
      activityDate,
      recordedAt: now,
      clientName: orgName || undefined,
      outcome: extraction.verification,
      successStatus: String(body.successStatus || extraction.successStatus?.value || "Pending"),
      priority: String(body.priority || extraction.priority?.value || "normal"),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : (extraction.tags || []),
      lessons: undefined,
      followUpRequired: (body.followUpRequired ?? extraction.followUpRequired?.value) === "yes",
      followUpDeadline: body.followUpDeadline ? String(body.followUpDeadline).slice(0, 10) : undefined,
      status: "active",
      updatedAt: now,
    };
    memory.entries.push(entry);

    const opps = Array.isArray(body.opportunities) ? body.opportunities : extraction.opportunities || [];
    for (const o of opps) {
      memory.opportunities.push({
        id: crypto.randomUUID(),
        diaryEntryId: entry.id,
        title: String(o.title || "Opportunity").slice(0, 300),
        organization: orgName || undefined,
        category: String(o.category || "Other"),
        description: String(o.description || ""),
        stage: String(o.stage || "Identified"),
        estimatedValue: String(o.estimatedValue || "Value Not Yet Established"),
        status: "open",
        createdAt: now,
      });
    }

    const commits = Array.isArray(body.commitments) ? body.commitments : extraction.commitments || [];
    for (const c of commits) {
      memory.commitments.push({
        id: crypto.randomUUID(),
        diaryEntryId: entry.id,
        title: String(c.title || "Commitment").slice(0, 300),
        description: String(c.description || ""),
        party: String(c.party || "unclear"),
        priority: String(c.priority || "normal"),
        status: "pending",
        dueDate: c.dueDate ? String(c.dueDate).slice(0, 10) : undefined,
        createdAt: now,
      });
    }

    if (entry.followUpRequired) {
      const fuTitle = String(body.suggestedFollowUp || extraction.suggestedFollowUp?.value || `Follow up: ${title}`).slice(0, 300);
      memory.followups.push({
        id: crypto.randomUUID(),
        entryId: entry.id,
        title: fuTitle,
        description: "Generated from Email-to-Diary approval",
        priority: entry.priority,
        dueDate: entry.followUpDeadline,
        status: "pending",
        createdAt: now,
      });
    }

    if (body.correspondenceId) {
      const corr = memory.correspondence.find((c) => c.id === body.correspondenceId);
      if (corr) {
        corr.diaryEntryId = entry.id;
        corr.status = "approved";
      }
    }

    return json({
      entry,
      organizationId: orgId,
      opportunities: memory.opportunities.filter((o) => o.diaryEntryId === entry.id),
      commitments: memory.commitments.filter((c) => c.diaryEntryId === entry.id),
      followUps: memory.followups.filter((f) => f.entryId === entry.id),
    }, 201);
  }

  if (path === "opportunities" && request.method === "GET") return json({ items: memory.opportunities });
  if (path === "commitments" && request.method === "GET") return json({ items: memory.commitments });
  if (path === "organizations" && request.method === "GET") return json({ items: memory.organizations });
  if (path === "correspondence" && request.method === "GET") return json({ items: memory.correspondence.map((c) => ({ id: c.id, subject: c.subject, status: c.status, diaryEntryId: c.diaryEntryId, createdAt: c.createdAt })) });

  if (path === "email/fixture-grr" && request.method === "POST") {
    // Get Remote Ready end-to-end fixture
    const body = GRR_FIXTURE;
    const extraction = nativeExtract({ body, activityDate: "2026-11-03" });
    return json({ body, extraction, expected: {
      title: "Partnership Proposal to Get Remote Ready",
      category: "Collaboration and Partnerships",
      organization: "Get Remote Ready",
      activityDate: "2026-11-03",
      successStatus: "Pending",
      note: "Partnership not marked won or active partner",
    }});
  }


  return json({ error: "Not found", path }, 404);
};
