import { EFF_LARGE_WORDLIST } from "./wordlist";
import { log2, pick, randomInt } from "./random";
import type { GeneratedSecret } from "./password";

export type PassphraseCase = "lower" | "title" | "upper";

export interface PassphraseOptions {
  words: number;
  separator: string;
  casing: PassphraseCase;
  /** Append one random digit to one random word. */
  includeNumber: boolean;
}

export const PASSPHRASE_LIMITS = { minWords: 3, maxWords: 12, defaultWords: 6, maxSeparator: 3 } as const;
export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = { words: PASSPHRASE_LIMITS.defaultWords, separator: "-", casing: "lower", includeNumber: false };

export function passphraseEntropyBits(o: PassphraseOptions): number {
  const perWord = log2(EFF_LARGE_WORDLIST.length);
  let bits = o.words * perWord;
  if (o.includeNumber) bits += log2(o.words) + log2(10);
  return bits;
}

const applyCase = (w: string, c: PassphraseCase) => (c === "upper" ? w.toUpperCase() : c === "title" ? w[0]!.toUpperCase() + w.slice(1) : w);

export function generatePassphrase(o: PassphraseOptions): GeneratedSecret {
  if (!Number.isInteger(o.words) || o.words < PASSPHRASE_LIMITS.minWords || o.words > PASSPHRASE_LIMITS.maxWords) throw new Error(`Use between ${PASSPHRASE_LIMITS.minWords} and ${PASSPHRASE_LIMITS.maxWords} words.`);
  const sep = Array.from(o.separator ?? "").slice(0, PASSPHRASE_LIMITS.maxSeparator).join("").replace(/[\u0000-\u001f\u007f]/g, "");
  const words: string[] = [];
  for (let i = 0; i < o.words; i++) words.push(applyCase(pick(EFF_LARGE_WORDLIST), o.casing));
  if (o.includeNumber) { const i = randomInt(words.length); words[i] = words[i]! + String(randomInt(10)); }
  return { value: words.join(sep), entropyBits: passphraseEntropyBits(o), poolSize: EFF_LARGE_WORDLIST.length };
}
