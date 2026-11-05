/**
 * Generic currency helpers for integer minor units (1 GHS = 100 pesewas).
 * Values are always stored and passed as integer minor units; only display and form input use major units.
 */

const SYMBOLS: Record<string, string> = { GHS: "GH₵", USD: "$", EUR: "€", GBP: "£", NGN: "₦", KES: "KSh", ZAR: "R" };

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 500000 -> "5,000.00" (two decimals, thousands separators, minus sign for negatives). */
export function formatMinor(minor: number, _currency = "GHS"): string {
  const n = Math.round(Number(minor) || 0);
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}${groupThousands(String(whole))}.${frac}`;
}

/** 500000 -> "GH₵ 5,000.00"; unknown currency codes fall back to the code as prefix. */
export function formatCurrency(minor: number, currency = "GHS"): string {
  const code = (currency || "GHS").toUpperCase();
  return `${SYMBOLS[code] ?? code} ${formatMinor(minor)}`;
}

/** Major units typed by a user (5000.5) -> integer minor units (500050). */
export function majorToMinor(major: number): number {
  return Math.round(Number(major) * 100);
}

/** Integer minor units -> major number (for display in inputs). */
export function minorToMajor(minor: number): number {
  return (Number(minor) || 0) / 100;
}
