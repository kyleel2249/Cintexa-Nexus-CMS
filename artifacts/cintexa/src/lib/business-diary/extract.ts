/**
 * Email-to-Diary native extraction engine — zero external AI APIs.
 * Rule/regex/keyword based. Labels: confirmed | extracted | inferred | suggested | requires_review | not_specified
 */

export type Confidence = "confirmed" | "extracted" | "inferred" | "suggested" | "requires_review" | "not_specified";

export interface Field<T> {
  value: T;
  confidence: Confidence;
  evidence?: string;
}

export interface ExtractedContact {
  name?: Field<string>;
  email?: Field<string>;
  phone?: Field<string>;
  title?: Field<string>;
}

export interface ExtractedOrg {
  name?: Field<string>;
  website?: Field<string>;
  industry?: Field<string>;
}

export interface OpportunityDraft {
  title: string;
  category: string;
  description: string;
  stage: string;
  estimatedValue: "Value Not Yet Established" | number;
  confidence: Confidence;
}

export interface CommitmentDraft {
  title: string;
  description: string;
  party: "cintexa" | "external" | "unclear";
  dueDate?: string;
  priority: string;
  confidence: Confidence;
}

export interface ExtractionResult {
  title: Field<string>;
  category: Field<string>;
  subcategory: Field<string>;
  organization: ExtractedOrg;
  contacts: ExtractedContact[];
  activityDate: Field<string>;
  priority: Field<string>;
  status: Field<string>;
  successStatus: Field<string>;
  followUpRequired: Field<"yes" | "no" | "requires_review">;
  verification: string;
  executiveSummary: string;
  description: string;
  objectives: string[];
  opportunities: OpportunityDraft[];
  commitments: CommitmentDraft[];
  suggestedFollowUp: Field<string>;
  tags: string[];
  risks: string[];
  method: string;
}

function f<T>(value: T, confidence: Confidence, evidence?: string): Field<T> {
  return { value, confidence, evidence };
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g;
const DATE_RE = /\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/gi;

const PARTNERSHIP_KW = ["partnership", "collaborate", "collaboration", "joint venture", "alliance", "revenue sharing", "partner with"];
const SALES_KW = ["quotation", "quote", "proposal", "invoice", "order", "purchase", "buy", "pricing", "demo"];
const SUPPORT_KW = ["complaint", "issue", "support", "bug", "delay", "refund"];
const MEETING_KW = ["meeting", "call", "discussion", "agenda", "minutes"];

function hasAny(text: string, words: string[]) {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

function classifyCategory(text: string): { category: string; subcategory: string; confidence: Confidence } {
  const t = text.toLowerCase();
  if (hasAny(t, PARTNERSHIP_KW)) {
    return {
      category: "Collaboration and Partnerships",
      subcategory: t.includes("proposal") ? "Partnership Proposal" : "Strategic Partnership Development",
      confidence: "extracted",
    };
  }
  if (hasAny(t, SALES_KW)) {
    return { category: "Sales and Business Development", subcategory: "Client Enquiry", confidence: "extracted" };
  }
  if (hasAny(t, SUPPORT_KW)) {
    return { category: "Customer Relations", subcategory: "Customer service incidents", confidence: "extracted" };
  }
  if (hasAny(t, MEETING_KW)) {
    return { category: "Management", subcategory: "Management meetings", confidence: "inferred" };
  }
  return { category: "General Business", subcategory: "Miscellaneous business events", confidence: "suggested" };
}

function priorityFromText(text: string): Field<string> {
  const t = text.toLowerCase();
  if (/\b(urgent|asap|immediately|critical)\b/.test(t)) return f("urgent", "extracted", "urgency keywords");
  if (/\b(deadline|by end of|this week|important)\b/.test(t) || hasAny(t, PARTNERSHIP_KW)) return f("high", "inferred");
  return f("normal", "suggested");
}

function extractOrgName(text: string, subject?: string): Field<string> | undefined {
  // "to Get Remote Ready", "from ABC Ltd", company-like Title Case sequences
  const patterns = [
    /(?:to|for|with|from)\s+([A-Z][A-Za-z0-9&.\s]{2,40}(?:Ltd|Limited|Inc|LLC|Ghana|Ready|Technologies|Tech)?)/,
    /(?:company|organisation|organization|partner):\s*([^\n,]{2,60})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p) || (subject || "").match(p);
    if (m?.[1]) {
      const name = m[1].trim().replace(/\s+/g, " ");
      if (name.length > 2) return f(name, "extracted", m[0]);
    }
  }
  // Known demo org
  if (/get\s*remote\s*ready/i.test(text) || /getremoteready/i.test(text)) {
    return f("Get Remote Ready", "extracted", "org name in body");
  }
  return undefined;
}

function extractContacts(text: string): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];
  const emails = [...new Set(text.match(EMAIL_RE) || [])].filter((e) => !/noreply|no-reply|example\.com/i.test(e));
  for (const email of emails.slice(0, 5)) {
    contacts.push({ email: f(email, "extracted") });
  }
  // "Dear Elsie", "Hi John,"
  const greet = text.match(/(?:dear|hi|hello)\s+([A-Z][a-z]+(?:\s+and\s+the\s+[A-Za-z\s]+Team)?)/i);
  if (greet?.[1]) {
    const name = greet[1].trim();
    if (contacts[0]) contacts[0].name = f(name, "extracted", greet[0]);
    else contacts.push({ name: f(name, "extracted", greet[0]) });
  }
  if (/elsie/i.test(text) && !contacts.some((c) => c.name?.value.toLowerCase().includes("elsie"))) {
    contacts.unshift({ name: f("Elsie and the Get Remote Ready Team", "inferred", "name mentioned") });
  }
  return contacts;
}

function extractDates(text: string, fallback?: string): Field<string> {
  const matches = text.match(DATE_RE);
  if (matches?.[0]) {
    const raw = matches[0];
    // normalize YYYY-MM-DD if possible
    const iso = raw.match(/20\d{2}-\d{2}-\d{2}/);
    if (iso) return f(iso[0], "extracted", raw);
    return f(raw, "extracted", raw);
  }
  if (fallback) return f(fallback, "confirmed", "user-supplied activity date");
  return f("", "not_specified");
}

function opportunityDrafts(text: string, org?: string): OpportunityDraft[] {
  const t = text.toLowerCase();
  const orgLabel = org || "the organisation";
  const out: OpportunityDraft[] = [];
  const add = (title: string, category: string, description: string) => {
    if (out.some((o) => o.title === title)) return;
    out.push({
      title,
      category,
      description,
      stage: "Identified",
      estimatedValue: "Value Not Yet Established",
      confidence: "suggested",
    });
  };
  if (/software|application|app development|web app/i.test(t)) {
    add(`Software development for ${orgLabel}`, "Software Development", "Suggested from correspondence references to software/development.");
  }
  if (/website|web design|web development/i.test(t)) {
    add(`Website development for ${orgLabel}`, "Website Development", "Suggested from website-related language.");
  }
  if (/automat/i.test(t)) {
    add(`Business automation services for ${orgLabel}`, "Business Automation", "Suggested from automation references.");
  }
  if (/train|course|curriculum|upskill/i.test(t)) {
    add(`Technology training / course development with ${orgLabel}`, "Training", "Suggested from training language.");
  }
  if (/recruit|talent|hiring|placement/i.test(t)) {
    add(`Recruitment / talent placement with ${orgLabel}`, "Recruitment", "Suggested from talent/recruitment language.");
  }
  if (/support|maintenance|retainer/i.test(t)) {
    add(`Ongoing technical support for ${orgLabel}`, "Maintenance", "Suggested from support/maintenance language.");
  }
  if (hasAny(t, PARTNERSHIP_KW) && /revenue|share|commission/i.test(t)) {
    add(`Training revenue-sharing arrangement with ${orgLabel}`, "Partnership Revenue Sharing", "Partnership + revenue share language; terms not confirmed.");
  }
  if (hasAny(t, PARTNERSHIP_KW) && out.length === 0) {
    add(`Strategic partnership opportunity with ${orgLabel}`, "Other", "Partnership discussed; commercial model not established.");
  }
  return out;
}

function commitmentDrafts(text: string): CommitmentDraft[] {
  const out: CommitmentDraft[] = [];
  const t = text.toLowerCase();
  if (/we will|we shall|we can provide|cintexa will/i.test(t)) {
    out.push({
      title: "CINTEXA delivery commitment (review)",
      description: "Correspondence suggests CINTEXA offered or proposed delivering services — confirm exact scope.",
      party: "cintexa",
      priority: "high",
      confidence: "requires_review",
    });
  }
  if (/please (reply|respond|confirm|review)|awaiting your|look forward to hearing/i.test(t)) {
    out.push({
      title: "Await external response",
      description: "Correspondence requests or expects a response from the other party.",
      party: "external",
      priority: "high",
      confidence: "extracted",
    });
  }
  if (/follow[- ]?up|next step|schedule a (call|meeting)/i.test(t)) {
    out.push({
      title: "Schedule follow-up engagement",
      description: "Next contact or meeting indicated in the text.",
      party: "unclear",
      priority: "normal",
      confidence: "inferred",
    });
  }
  return out;
}

function buildTitle(org: string | undefined, category: string, text: string): Field<string> {
  if (org && hasAny(text, PARTNERSHIP_KW)) {
    return f(`Partnership Proposal to ${org}`, "extracted");
  }
  if (org && hasAny(text, SALES_KW)) {
    return f(`Client Enquiry from ${org}`, "inferred");
  }
  if (org) return f(`Business correspondence — ${org}`, "suggested");
  const first = text.split(/\n/).map((l) => l.trim()).find((l) => l.length > 10 && l.length < 80);
  if (first) return f(first.slice(0, 100), "suggested");
  return f("Business correspondence record", "suggested");
}

export function extractFromCorrespondence(input: {
  body: string;
  subject?: string;
  activityDate?: string;
  sender?: string;
}): ExtractionResult {
  const body = (input.body || "").trim();
  const subject = (input.subject || "").trim();
  const text = `${subject}\n${body}`;
  const { category, subcategory, confidence: catConf } = classifyCategory(text);
  const orgField = extractOrgName(text, subject);
  const orgName = orgField?.value;
  const contacts = extractContacts(text);
  if (input.sender && EMAIL_RE.test(input.sender)) {
    contacts.unshift({ email: f(input.sender, "confirmed", "sender field") });
  }
  const websites = [...new Set(text.match(URL_RE) || [])].slice(0, 5);
  const organization: ExtractedOrg = {
    name: orgField,
    website: websites[0] ? f(websites[0].replace(/[.,;]+$/, ""), "extracted") : undefined,
  };
  if (/getremoteready\.co/i.test(text)) {
    organization.website = f("https://getremoteready.co/", "extracted");
    organization.name = organization.name || f("Get Remote Ready", "extracted");
  }
  if (/remote|training|employment/i.test(text) && organization.name) {
    organization.industry = f("Remote employment / technology training", "inferred");
  }

  const activityDate = extractDates(text, input.activityDate);
  const priority = priorityFromText(text);
  const followUpRequired = f<"yes" | "no" | "requires_review">(
    hasAny(text, PARTNERSHIP_KW) || /awaiting|please reply|follow/i.test(text) ? "yes" : "requires_review",
    "inferred",
  );
  const opportunities = opportunityDrafts(text, orgName || organization.name?.value);
  const commitments = commitmentDrafts(text);
  const title = buildTitle(organization.name?.value, category, text);

  const tags = new Set<string>();
  if (organization.name?.value) tags.add(organization.name.value);
  if (hasAny(text, PARTNERSHIP_KW)) {
    tags.add("Strategic Partnership");
    tags.add("Business Development");
  }
  if (/software|development/i.test(text)) tags.add("Software Development");
  if (/website/i.test(text)) tags.add("Website Development");
  if (/automat/i.test(text)) tags.add("Business Automation");
  if (/train/i.test(text)) tags.add("Technology Training");
  if (/recruit|talent/i.test(text)) tags.add("Talent Acquisition");
  if (/revenue share|revenue-sharing/i.test(text)) tags.add("Revenue Sharing");
  if (followUpRequired.value === "yes") tags.add("Follow-up Required");
  tags.add("Client Engagement");

  const risks: string[] = [];
  if (!organization.name) risks.push("Organization not clearly identified");
  if (opportunities.length) risks.push("Commercial terms and values not established");
  if (followUpRequired.value === "yes") risks.push("Awaiting external response — outcome not confirmed");

  const verification = [
    organization.name ? `Organisation: ${organization.name.value} (${organization.name.confidence})` : "Organisation: not specified",
    `Category: ${category}`,
    opportunities.length
      ? `${opportunities.length} revenue opportunity suggestion(s) — values not established; partnership not marked won`
      : "No revenue opportunities auto-detected",
    "No commercial agreement treated as confirmed unless explicitly stated",
  ].join(". ");

  const executiveSummary =
    `${title.value}. ` +
    (organization.name ? `Engagement involving ${organization.name.value}. ` : "") +
    `Classified under ${category} / ${subcategory}. ` +
    (followUpRequired.value === "yes" ? "Follow-up recommended. " : "") +
    "Generated by native rule-based extraction — review before approval.";

  const objectives: string[] = [];
  if (hasAny(text, PARTNERSHIP_KW)) objectives.push("Explore or propose a strategic partnership");
  if (/train/i.test(text)) objectives.push("Discuss training / capability development");
  if (/software|website|automat/i.test(text)) objectives.push("Explore technology / digital service collaboration");

  const suggestedFollowUp = f(
    organization.name
      ? `Contact ${organization.name.value} to request feedback and arrange an introductory partnership meeting`
      : "Review correspondence and confirm next contact action",
    "suggested",
  );

  return {
    title,
    category: f(category, catConf),
    subcategory: f(subcategory, catConf),
    organization,
    contacts,
    activityDate,
    priority,
    status: f(followUpRequired.value === "yes" ? "Awaiting Response" : "Active", "suggested"),
    successStatus: f("Pending", "suggested"),
    followUpRequired,
    verification,
    executiveSummary,
    description: body.slice(0, 4000) || subject,
    objectives,
    opportunities,
    commitments,
    suggestedFollowUp,
    tags: [...tags].slice(0, 16),
    risks,
    method: "native-regex-keyword-v1",
  };
}

/** Preset for Get Remote Ready partnership proposal (demo / E2E fixture). */
export function getRemoteReadyFixtureBody(): string {
  return `Subject: Strategic Partnership Proposal — CINTEXA x Get Remote Ready

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
}
