import { randomInt } from "./random";

/** 31 symbols without look-alikes (no 0/O, 1/I/L). About 4.95 bits per character. */
export const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_LIMITS = { minCount: 1, maxCount: 20, minGroups: 2, maxGroups: 4, minGroupLen: 4, maxGroupLen: 8 } as const;

export interface RecoveryOptions { count: number; groups: number; groupLength: number }
export const DEFAULT_RECOVERY_OPTIONS: RecoveryOptions = { count: 10, groups: 2, groupLength: 5 };

export function recoveryEntropyBits(o: RecoveryOptions): number {
  return o.groups * o.groupLength * Math.log2(new Set(RECOVERY_ALPHABET).size);
}

export function generateRecoveryCodes(o: RecoveryOptions): string[] {
  const L = RECOVERY_LIMITS;
  if (o.count < L.minCount || o.count > L.maxCount || o.groups < L.minGroups || o.groups > L.maxGroups || o.groupLength < L.minGroupLen || o.groupLength > L.maxGroupLen) throw new Error("Recovery code options are out of range.");
  const alphabet = Array.from(new Set(RECOVERY_ALPHABET));
  const seen = new Set<string>();
  let guard = 0;
  while (seen.size < o.count) {
    if (guard++ > 1000) throw new Error("Could not generate unique recovery codes.");
    const parts: string[] = [];
    for (let g = 0; g < o.groups; g++) {
      let p = "";
      for (let i = 0; i < o.groupLength; i++) p += alphabet[randomInt(alphabet.length)];
      parts.push(p);
    }
    seen.add(parts.join("-"));
  }
  return Array.from(seen);
}
