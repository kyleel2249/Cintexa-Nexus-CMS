import { getCrypto, toHex } from "./random";

export async function sha1Hex(text: string): Promise<string> {
  const d = await getCrypto().subtle.digest("SHA-1", new TextEncoder().encode(text));
  return toHex(new Uint8Array(d)).toUpperCase();
}

export const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";

export interface BreachResult { found: boolean; count: number }

/** Parses a range response ("SUFFIX:COUNT" lines). Padding entries with count 0 are ignored. */
export function matchRange(body: string, suffix: string): BreachResult {
  for (const line of body.split(/\r?\n/)) {
    const [s, c] = line.trim().split(":");
    if (s && s.toUpperCase() === suffix) {
      const count = parseInt(c ?? "0", 10) || 0;
      return { found: count > 0, count };
    }
  }
  return { found: false, count: 0 };
}

/**
 * k-anonymity check against Pwned Passwords. Only the first 5 hex characters of the SHA-1 hash leave the browser;
 * the password and the full hash are never transmitted. A match means the password appears in a known dataset;
 * no match does not prove the password is safe.
 */
export async function checkPwned(password: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<BreachResult> {
  if (!password) throw new Error("Enter a password to check.");
  const hash = await sha1Hex(password);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PWNED_RANGE_URL + hash.slice(0, 5), { headers: { "Add-Padding": "true" }, signal: ctl.signal, referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error(`The breach service responded with ${res.status}.`);
    return matchRange(await res.text(), hash.slice(5));
  } finally {
    clearTimeout(timer);
  }
}
