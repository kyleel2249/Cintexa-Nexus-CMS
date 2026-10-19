/**
 * Duplicate detection. Pure functions: callers fetch candidates (by indexed e-mail / phone / company) and
 * these decide how likely each is to be the same person. Matching rules are configurable in Sales settings.
 */
export interface Dedupable {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}

export interface DedupeRules {
  matchEmail: boolean;
  matchPhone: boolean;
  matchCompany: boolean;
  nameSimilarity: number;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  let e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  // gmail ignores dots and +tags
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.split("+")[0]!.replace(/\./g, "");
  else local = local.split("+")[0]!;
  e = `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
  return e;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  // compare on the last 9 digits so +233 24 123 4567 and 024 123 4567 match
  return digits.slice(-9);
}

const COMPANY_NOISE = /\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|pty|the)\b/g;
export function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(COMPANY_NOISE, " ").replace(/\s+/g, " ").trim();
  return n.length >= 2 ? n : null;
}

/** Levenshtein distance (iterative, O(min(n,m)) memory). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x.length && !y.length) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export interface DuplicateMatch {
  id: number;
  confidence: number;
  reasons: string[];
}

export function matchScore(a: Dedupable, b: Dedupable, rules: DedupeRules): DuplicateMatch | null {
  const reasons: string[] = [];
  let confidence = 0;
  if (rules.matchEmail) {
    const ea = normalizeEmail(a.email);
    const eb = normalizeEmail(b.email);
    if (ea && eb && ea === eb) {
      confidence = Math.max(confidence, 0.95);
      reasons.push("Same e-mail address");
    }
  }
  if (rules.matchPhone) {
    const pa = normalizePhone(a.phone);
    const pb = normalizePhone(b.phone);
    if (pa && pb && pa === pb) {
      confidence = Math.max(confidence, 0.8);
      reasons.push("Same phone number");
    }
  }
  const na = [a.first_name, a.last_name].filter(Boolean).join(" ");
  const nb = [b.first_name, b.last_name].filter(Boolean).join(" ");
  const nameSim = na && nb ? similarity(na, nb) : 0;
  if (rules.matchCompany) {
    const ca = normalizeCompany(a.company);
    const cb = normalizeCompany(b.company);
    if (ca && cb && ca === cb && nameSim >= rules.nameSimilarity) {
      confidence = Math.max(confidence, 0.85);
      reasons.push("Same company and a very similar name");
    } else if (ca && cb && ca === cb && nameSim >= 0.6) {
      confidence = Math.max(confidence, 0.55);
      reasons.push("Same company and a similar name");
    }
  }
  if (reasons.length && nameSim >= rules.nameSimilarity) {
    confidence = Math.min(0.99, confidence + 0.04);
    reasons.push("Name is nearly identical");
  }
  if (!reasons.length) return null;
  return { id: b.id, confidence: Math.round(confidence * 100) / 100, reasons };
}

export function rankDuplicates(subject: Dedupable, candidates: Dedupable[], rules: DedupeRules, minConfidence = 0.5): DuplicateMatch[] {
  return candidates
    .filter((c) => c.id !== subject.id)
    .map((c) => matchScore(subject, c, rules))
    .filter((m): m is DuplicateMatch => m !== null && m.confidence >= minConfidence)
    .sort((x, y) => y.confidence - x.confidence || x.id - y.id);
}
