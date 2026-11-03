/**
 * Full-value financial amount handling — no K/M abbreviation, no silent rounding.
 * Storage remains integer minor units; display preserves entered precision when provided.
 */

export type CurrencyMeta = { code: string; decimals: number; symbol?: string };

const CURRENCIES: Record<string, CurrencyMeta> = {
  GHS: { code: "GHS", decimals: 2, symbol: "GH₵" },
  USD: { code: "USD", decimals: 2, symbol: "$" },
  EUR: { code: "EUR", decimals: 2, symbol: "€" },
  GBP: { code: "GBP", decimals: 2, symbol: "£" },
};

export function currencyMeta(code?: string): CurrencyMeta {
  return CURRENCIES[(code || "GHS").toUpperCase()] || { code: code || "GHS", decimals: 2 };
}

/** Parse user input to minor units. Rejects excess precision beyond currency decimals. */
export function parseToMinor(input: string, currency = "GHS"): { ok: true; minor: number; display: string } | { ok: false; error: string } {
  const raw = String(input).trim().replace(/,/g, "");
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return { ok: false, error: "Invalid amount" };
  const meta = currencyMeta(currency);
  const parts = raw.replace(/^-/, "").split(".");
  if (parts[1] && parts[1].length > meta.decimals) {
    return { ok: false, error: `Maximum ${meta.decimals} decimal places for ${meta.code}` };
  }
  const neg = raw.startsWith("-");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(meta.decimals, "0").slice(0, meta.decimals);
  const minor = Number(whole) * 10 ** meta.decimals + Number(frac || "0");
  if (!Number.isSafeInteger(minor)) return { ok: false, error: "Amount too large" };
  return { ok: true, minor: neg ? -minor : minor, display: raw };
}

/**
 * Format minor units for display.
 * - If displayHint provided (original entry), use it when it matches the numeric value.
 * - Otherwise show full value without forced trailing .00 on whole amounts unless decimals were used.
 * - Never abbreviate (no 1.2K / 1M).
 */
export function formatMoney(
  minor: number,
  currency = "GHS",
  opts?: { displayHint?: string | null; forceDecimals?: boolean; useGrouping?: boolean },
): string {
  const meta = currencyMeta(currency);
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 10 ** meta.decimals);
  const frac = abs % 10 ** meta.decimals;

  if (opts?.displayHint) {
    const parsed = parseToMinor(opts.displayHint, currency);
    if (parsed.ok && parsed.minor === minor) return opts.displayHint;
  }

  let out: string;
  if (opts?.forceDecimals || frac !== 0) {
    out = `${whole}.${String(frac).padStart(meta.decimals, "0")}`;
  } else {
    out = String(whole);
  }
  if (opts?.useGrouping) {
    const [w, f] = out.split(".");
    out = w!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? `.${f}` : "");
  }
  return neg ? `-${out}` : out;
}

/** Legacy helper used across Finance UI — full value, optional grouping, no compact notation */
export function formatMinor(minor: number, currency = "GHS", _digits = 2): string {
  return formatMoney(minor, currency, { useGrouping: true, forceDecimals: false });
}
