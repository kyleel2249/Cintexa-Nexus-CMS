/**
 * CINTEXA Finance — centralized monetary formatting engine.
 *
 * Storage contract (unchanged):
 *   All ledger amounts, API payloads and calculations use integer minor units
 *   (e.g. pesewas / cents). 1 GHS = 100 minor units.
 *
 * Display contract (corrected):
 *   Ordinary currency amounts always render with exactly two decimal places
 *   and optional thousands separators. This permanently resolves the
 *   "missing two zeros" presentation defect without altering any stored value
 *   or calculation.
 *
 * Never multiply/divide stored values by 100 to "fix" display. The root
 * cause was the previous default of forceDecimals: false.
 */

export type CurrencyMeta = { code: string; decimals: number; symbol?: string };

const CURRENCIES: Record<string, CurrencyMeta> = {
  GHS: { code: "GHS", decimals: 2, symbol: "GH₵" },
  USD: { code: "USD", decimals: 2, symbol: "$" },
  EUR: { code: "EUR", decimals: 2, symbol: "€" },
  GBP: { code: "GBP", decimals: 2, symbol: "£" },
  NGN: { code: "NGN", decimals: 2, symbol: "₦" },
  KES: { code: "KES", decimals: 2, symbol: "KSh" },
  ZAR: { code: "ZAR", decimals: 2, symbol: "R" },
};

export function currencyMeta(code?: string): CurrencyMeta {
  const key = (code || "GHS").toUpperCase();
  return CURRENCIES[key] || { code: key, decimals: 2 };
}

/** Parse user input to minor units. Rejects excess precision beyond currency decimals. */
export function parseToMinor(
  input: string,
  currency = "GHS",
): { ok: true; minor: number; display: string } | { ok: false; error: string } {
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

export type FormatMoneyOpts = {
  /** Prefer original user-entered string when it matches the numeric value. */
  displayHint?: string | null;
  /** Always show the currency's decimal places (default true for financial UI). */
  forceDecimals?: boolean;
  /** Insert thousands separators (default true). */
  useGrouping?: boolean;
  /** Prefix with currency symbol (GH₵, $, …). Default false for pure numeric tables. */
  withSymbol?: boolean;
  /** Append ISO code after the number (e.g. "50.00 GHS"). */
  withCode?: boolean;
};

/**
 * Format minor units for display.
 * Default behaviour (forceDecimals + useGrouping) produces:
 *   0        → "0.00"
 *   50       → "50.00"
 *   1500     → "1,500.00"
 *   500000   → "5,000.00"
 *   -1500    → "-1,500.00"
 */
export function formatMoney(
  minor: number,
  currency = "GHS",
  opts?: FormatMoneyOpts,
): string {
  const meta = currencyMeta(currency);
  const forceDecimals = opts?.forceDecimals !== false; // default TRUE
  const useGrouping = opts?.useGrouping !== false; // default TRUE
  const neg = minor < 0;
  const abs = Math.abs(Math.round(Number(minor) || 0));
  const whole = Math.floor(abs / 10 ** meta.decimals);
  const frac = abs % 10 ** meta.decimals;

  // Honour an exact display hint when it round-trips to the same minor value
  if (opts?.displayHint) {
    const parsed = parseToMinor(opts.displayHint, currency);
    if (parsed.ok && parsed.minor === minor) {
      let hint = opts.displayHint;
      if (opts.withSymbol && meta.symbol) hint = `${meta.symbol} ${hint}`;
      if (opts.withCode) hint = `${hint} ${meta.code}`;
      return hint;
    }
  }

  let out: string;
  if (forceDecimals || frac !== 0) {
    out = `${whole}.${String(frac).padStart(meta.decimals, "0")}`;
  } else {
    out = String(whole);
  }

  if (useGrouping) {
    const [w, f] = out.split(".");
    out = w!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? `.${f}` : "");
  }

  if (neg) out = `-${out}`;

  if (opts?.withSymbol && meta.symbol) {
    out = `${meta.symbol} ${out}`;
  }
  if (opts?.withCode) {
    out = `${out} ${meta.code}`;
  }
  return out;
}

/**
 * Primary helper used across Finance UI and reports.
 * Always forces two decimal places + grouping for ordinary currencies.
 */
export function formatMinor(
  minor: number,
  currency = "GHS",
  _digits = 2, // retained for call-site compatibility; ignored
): string {
  return formatMoney(minor, currency, { useGrouping: true, forceDecimals: true });
}

/**
 * Currency-aware display with symbol (preferred for KPI cards and executive views).
 * Example: formatCurrency(500000) → "GH₵ 5,000.00"
 */
export function formatCurrency(
  minor: number,
  currency = "GHS",
  opts?: Omit<FormatMoneyOpts, "withSymbol">,
): string {
  return formatMoney(minor, currency, { ...opts, withSymbol: true, forceDecimals: true, useGrouping: true });
}

/**
 * Compact numeric only (still two decimals) for dense tables / charts tooltips.
 */
export function formatMinorPlain(minor: number, currency = "GHS"): string {
  return formatMoney(minor, currency, { useGrouping: false, forceDecimals: true });
}

/** Convert major units (e.g. 50.00) to minor units safely. */
export function majorToMinor(major: number, currency = "GHS"): number {
  const meta = currencyMeta(currency);
  return Math.round(Number(major) * 10 ** meta.decimals);
}

/** Convert minor units back to major number (for chart libraries that expect floats). */
export function minorToMajor(minor: number, currency = "GHS"): number {
  const meta = currencyMeta(currency);
  return (Number(minor) || 0) / 10 ** meta.decimals;
}
