export const LOWER = "abcdefghijklmnopqrstuvwxyz";
export const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";
/** Symbols chosen to be accepted by most sign-up forms (no quotes, backslash, space or backtick). */
export const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/~";
/** Characters that are easy to confuse when read or typed. */
export const AMBIGUOUS = "Il1O0o|";

export interface CharsetOptions {
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
  /** Extra characters added as their own category. */
  custom?: string;
  /** Characters never to use. */
  exclude?: string;
}

export interface Category {
  id: string;
  chars: string[];
}

function clean(chars: string, drop: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of Array.from(chars)) {
    if (drop.has(ch) || seen.has(ch)) continue;
    // Control characters and whitespace are never valid in generated secrets.
    if (/[\u0000-\u0020\u007f-\u009f]/.test(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

/** Builds the enabled, de-duplicated categories after exclusions. Empty categories are dropped. */
export function buildCategories(o: CharsetOptions): Category[] {
  const drop = new Set<string>(Array.from(o.exclude ?? ""));
  if (o.excludeAmbiguous) for (const ch of AMBIGUOUS) drop.add(ch);
  const cats: Category[] = [];
  const add = (id: string, src: string) => {
    const chars = clean(src, drop);
    if (chars.length) cats.push({ id, chars });
  };
  if (o.lower) add("lower", LOWER);
  if (o.upper) add("upper", UPPER);
  if (o.digits) add("digits", DIGITS);
  if (o.symbols) add("symbols", SYMBOLS);
  if (o.custom) {
    // Characters already present in another category stay in that category.
    const used = new Set(cats.flatMap((c) => c.chars));
    const chars = clean(o.custom, drop).filter((c) => !used.has(c));
    if (chars.length) cats.push({ id: "custom", chars });
  }
  return cats;
}

export function poolOf(cats: Category[]): string[] {
  return cats.flatMap((c) => c.chars);
}
