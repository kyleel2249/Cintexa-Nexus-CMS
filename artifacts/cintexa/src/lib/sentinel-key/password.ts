import { buildCategories, poolOf, type CharsetOptions } from "./charsets";
import { log2, pick, randomInt, shuffle } from "./random";

export interface PasswordOptions extends CharsetOptions {
  length: number;
  /** Disallow the same character twice in a row. */
  avoidRepeats?: boolean;
  /** Disallow 3-character ascending/descending runs such as abc, 321. */
  avoidSequences?: boolean;
  /** Minimum characters taken from each enabled category (default 1). */
  minPerCategory?: number;
}

export interface GeneratedSecret {
  value: string;
  /** Upper bound of entropy in bits derived from the generation process. */
  entropyBits: number;
  poolSize: number;
}

export const PASSWORD_LIMITS = { minLength: 8, maxLength: 128, defaultLength: 24, maxBulk: 50 } as const;

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: PASSWORD_LIMITS.defaultLength,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  avoidRepeats: false,
  avoidSequences: false,
  minPerCategory: 1,
  custom: "",
  exclude: "",
};

const isAlnumRun = (a: string, b: string, c: string): boolean => {
  const x = a.toLowerCase().charCodeAt(0), y = b.toLowerCase().charCodeAt(0), z = c.toLowerCase().charCodeAt(0);
  const same = /^[a-z]$/i.test(a + b + c) || /^[0-9]$/.test(a) && /^[0-9]$/.test(b) && /^[0-9]$/.test(c);
  return same && ((y - x === 1 && z - y === 1) || (x - y === 1 && y - z === 1));
};

export function hasSequence(s: string): boolean {
  for (let i = 0; i + 2 < s.length; i++) if (isAlnumRun(s[i]!, s[i + 1]!, s[i + 2]!)) return true;
  return false;
}

export function hasRepeat(s: string): boolean {
  for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return true;
  return false;
}

export function validatePasswordOptions(o: PasswordOptions): string | null {
  if (!Number.isInteger(o.length) || o.length < PASSWORD_LIMITS.minLength || o.length > PASSWORD_LIMITS.maxLength) return `Length must be between ${PASSWORD_LIMITS.minLength} and ${PASSWORD_LIMITS.maxLength}.`;
  const cats = buildCategories(o);
  if (cats.length === 0) return "Select at least one character type.";
  const pool = poolOf(cats);
  if (pool.length < 2) return "The character pool is too small.";
  const min = Math.max(0, Math.floor(o.minPerCategory ?? 1));
  if (min * cats.length > o.length) return "Length is too short for the required characters per type.";
  if (o.avoidRepeats && pool.length < 3) return "The pool is too small to avoid repeated characters.";
  return null;
}

/** Entropy upper bound for the generation process (bits). Constraints such as sequence avoidance lower the true value slightly. */
export function passwordEntropyBits(o: PasswordOptions): number {
  const pool = poolOf(buildCategories(o)).length;
  if (pool < 2) return 0;
  if (o.avoidRepeats) return log2(pool) + (o.length - 1) * log2(pool - 1);
  return o.length * log2(pool);
}

/** Generates one password. Uses rejection sampling so constraints never bias characters inside the allowed set. */
export function generatePassword(o: PasswordOptions): GeneratedSecret {
  const err = validatePasswordOptions(o);
  if (err) throw new Error(err);
  const cats = buildCategories(o);
  const pool = poolOf(cats);
  const min = Math.max(0, Math.floor(o.minPerCategory ?? 1));
  for (let attempt = 0; attempt < 500; attempt++) {
    const chars: string[] = [];
    for (const c of cats) for (let i = 0; i < min; i++) chars.push(pick(c.chars));
    while (chars.length < o.length) chars.push(pool[randomInt(pool.length)]!);
    const value = shuffle(chars).join("");
    if (o.avoidRepeats && hasRepeat(value)) continue;
    if (o.avoidSequences && hasSequence(value)) continue;
    return { value, entropyBits: passwordEntropyBits(o), poolSize: pool.length };
  }
  throw new Error("Could not satisfy the selected constraints. Relax a rule or increase the length.");
}

export function generatePasswords(o: PasswordOptions, count: number): GeneratedSecret[] {
  const n = Math.min(Math.max(1, Math.floor(count)), PASSWORD_LIMITS.maxBulk);
  const seen = new Set<string>();
  const out: GeneratedSecret[] = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const s = generatePassword(o);
    if (!seen.has(s.value)) { seen.add(s.value); out.push(s); }
  }
  return out;
}
