import { log2 } from "./random";
import { hasRepeat, hasSequence } from "./password";

export type StrengthLabel = "Very weak" | "Weak" | "Fair" | "Strong" | "Excellent";

export interface PasswordAnalysis {
  length: number;
  classes: { lower: boolean; upper: boolean; digits: boolean; symbols: boolean; other: boolean };
  /** Size of the character pool the password appears to draw from. */
  poolSize: number;
  /** Pattern-adjusted estimate in bits. An estimate for a typed password, not a measurement. */
  entropyBits: number;
  label: StrengthLabel;
  /** 0-4, usable for meters. */
  level: 0 | 1 | 2 | 3 | 4;
  weaknesses: string[];
  suggestions: string[];
}

const COMMON = ["password", "passw0rd", "letmein", "welcome", "admin", "login", "qwerty", "qwertyuiop", "asdfgh", "zxcvbn", "iloveyou", "monkey", "dragon", "football", "baseball", "master", "sunshine", "princess", "shadow", "superman", "trustno1", "abc123", "123456", "12345678", "123456789", "111111", "000000", "changeme", "default", "secret", "cintexa", "nexus"];
const KEYBOARD = ["qwerty", "asdf", "zxcv", "1qaz", "qazwsx", "1234", "4321", "0987", "poiuy", "lkjhg"];

export function labelFor(bits: number): { label: StrengthLabel; level: 0 | 1 | 2 | 3 | 4 } {
  if (bits < 28) return { label: "Very weak", level: 0 };
  if (bits < 40) return { label: "Weak", level: 1 };
  if (bits < 60) return { label: "Fair", level: 2 };
  if (bits < 80) return { label: "Strong", level: 3 };
  return { label: "Excellent", level: 4 };
}

/** Normalises common substitutions (p@ssw0rd -> password) so dictionary checks are not trivially bypassed. */
function deleet(s: string): string {
  const map: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
  return s.toLowerCase().replace(/[013457@$!]/g, (c) => map[c] ?? c);
}

export function analyzePassword(pw: string): PasswordAnalysis {
  const chars = Array.from(pw);
  const length = chars.length;
  const classes = {
    lower: /[a-z]/.test(pw), upper: /[A-Z]/.test(pw), digits: /[0-9]/.test(pw),
    symbols: /[!-\/:-@\[-`{-~]/.test(pw), other: /[^\x00-\x7f]/.test(pw),
  };
  const poolSize = (classes.lower ? 26 : 0) + (classes.upper ? 26 : 0) + (classes.digits ? 10 : 0) + (classes.symbols ? 33 : 0) + (classes.other ? 100 : 0);
  const weaknesses: string[] = [];
  const suggestions: string[] = [];
  if (length === 0) return { length, classes, poolSize: 0, entropyBits: 0, label: "Very weak", level: 0, weaknesses: [], suggestions: ["Enter or generate a password to analyse it."] };

  let bits = poolSize > 1 ? length * log2(poolSize) : 0;
  // Characters that repeat carry little new information.
  const unique = new Set(chars).size;
  if (unique < length) {
    const lost = (length - unique) * log2(Math.max(poolSize, 2)) * 0.6;
    bits -= lost;
    if (unique <= length / 2) weaknesses.push("Many characters are repeated.");
  }
  if (hasRepeat(pw) && /(.)\1\1/.test(pw)) weaknesses.push("Contains the same character three or more times in a row.");
  if (hasSequence(pw)) { bits -= 6; weaknesses.push("Contains a sequence such as abc or 321."); }
  const lower = pw.toLowerCase();
  const normalised = deleet(pw);
  const dict = COMMON.find((w) => lower.includes(w) || normalised.includes(w));
  if (dict) { bits = Math.min(bits, 24); weaknesses.push("Contains a very common password or word."); }
  if (KEYBOARD.some((k) => lower.includes(k))) { bits -= 8; weaknesses.push("Contains a keyboard pattern."); }
  if (/(19|20)\d{2}/.test(pw)) { bits -= 5; weaknesses.push("Contains what looks like a year."); }
  if (/^[A-Za-z]+\d{1,4}[!@#$%^&*]?$/.test(pw)) { bits -= 8; weaknesses.push("Follows a common word-plus-number pattern."); }
  if (length < 12) weaknesses.push("Shorter than 12 characters.");
  if (!dict && length >= 8 && Object.values(classes).filter(Boolean).length === 1) weaknesses.push("Uses only one character type.");

  bits = Math.max(0, Math.round(bits * 10) / 10);
  const { label, level } = labelFor(bits);
  if (length < 16) suggestions.push("Use at least 16 characters; length adds the most strength.");
  if (weaknesses.length) suggestions.push("Replace this with a randomly generated password or passphrase instead of editing it.");
  suggestions.push("Use a unique password for every account and turn on multi-factor authentication or passkeys.");
  return { length, classes, poolSize, entropyBits: bits, label, level, weaknesses, suggestions };
}

/** Pretty "2^N" search-space description. This is a size, not a crack-time guarantee. */
export function searchSpace(bits: number): string {
  if (bits <= 0) return "-";
  const exp10 = bits * Math.log10(2);
  return `2^${Math.round(bits)} (about 10^${Math.round(exp10)})`;
}

export interface AuditEntry { id: string; name: string; password: string }
export interface AuditResult {
  distribution: Record<StrengthLabel, number>;
  weak: string[];
  reused: { ids: string[]; names: string[] }[];
  short: string[];
  patterns: string[];
  total: number;
}

/** Local-only vault audit: strength distribution, reuse and pattern findings. Returns entry ids, never secret values. */
export function auditEntries(entries: AuditEntry[]): AuditResult {
  const distribution: Record<StrengthLabel, number> = { "Very weak": 0, Weak: 0, Fair: 0, Strong: 0, Excellent: 0 };
  const weak: string[] = [], short: string[] = [], patterns: string[] = [];
  const byPw = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const a = analyzePassword(e.password);
    distribution[a.label]++;
    if (a.level <= 1) weak.push(e.id);
    if (a.length < 12) short.push(e.id);
    if (a.weaknesses.some((w) => /sequence|keyboard|common|year|pattern/i.test(w))) patterns.push(e.id);
    const list = byPw.get(e.password) ?? [];
    list.push(e); byPw.set(e.password, list);
  }
  const reused = Array.from(byPw.values()).filter((l) => l.length > 1).map((l) => ({ ids: l.map((e) => e.id), names: l.map((e) => e.name) }));
  return { distribution, weak, reused, short, patterns, total: entries.length };
}
