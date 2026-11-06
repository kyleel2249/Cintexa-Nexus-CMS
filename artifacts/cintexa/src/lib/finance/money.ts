/**
 * CINTEXA Finance — centralized monetary handling engine.
 *
 * STORAGE CONTRACT (authoritative):
 *   Ledger, API and D1 columns store INTEGER MINOR units.
 *   1 GHS (major) = 100 minor units (pesewas).
 *   Example: GHS 5,000.00 is stored as 500000.
 *
 * INPUT CONTRACT (forms):
 *   Users type MAJOR units (5000 means GHS 5,000.00).
 *   Call majorToMinor() at the write boundary before posting.
 *   Never store major units in debit/credit/amountMinor fields.
 *
 * DISPLAY CONTRACT:
 *   formatMinor / formatCurrency always interpret the number as MINOR units and group thousands.
 *   Decimals appear only when the amount has them: 500000 → "5,000" / "GH₵ 5,000"; 123450 → "1,234.50".
 *   What the user typed is what they see back: entering "5,000" shows "5,000".
 *
 * 100× understatement root cause (fixed at form boundary):
 *   Journal/invoice forms previously posted major units without ×100, so
 *   GHS 5,000 was stored as 5000 and displayed as 50.00. Forms now convert
 *   with majorToMinor on post. Existing mis-scaled data can be corrected via
 *   POST /api/finance/admin/scale-to-minor (controlled, dry-run by default).
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
  /** Always show the currency's decimal places. Default: only when the amount has a fractional part, so 5,000 shows as "5,000" and 1,234.5 as "1,234.50". */
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
  const forceDecimals = opts?.forceDecimals === true; // default: show decimals only when the amount has them
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
 * Grouping always; decimals only when present (see DISPLAY CONTRACT).
 */
export function formatMinor(
  minor: number,
  currency = "GHS",
  _digits = 2, // retained for call-site compatibility; ignored
): string {
  return formatMoney(minor, currency, { useGrouping: true });
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
  return formatMoney(minor, currency, { ...opts, withSymbol: true, useGrouping: true });
}

/**
 * Compact numeric only (still two decimals) for dense tables / charts tooltips.
 */
export function formatMinorPlain(minor: number, currency = "GHS"): string {
  return formatMoney(minor, currency, { useGrouping: false });
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

/**
 * Convert a form field (MAJOR units, may contain thousands separators or spaces, e.g. "5,000" or "5 000.50")
 * to integer minor units. Returns 0 for empty or invalid input; use parseToMinor when you need the error.
 * Never use Number("5,000") for amounts: it is NaN.
 */
export function amountInputToMinor(input: string | number | null | undefined, currency = "GHS"): number {
  if (typeof input === "number") return Number.isFinite(input) ? majorToMinor(input, currency) : 0;
  const cleaned = String(input ?? "").replace(/\s/g, "");
  const r = parseToMinor(cleaned, currency);
  return r.ok ? r.minor : 0;
}

/** Numeric value (major units) of a form field that may contain separators; 0 when invalid. */
export function amountInputToMajor(input: string | number | null | undefined, currency = "GHS"): number {
  return minorToMajor(amountInputToMinor(input, currency), currency);
}

/** Plain number from a form field that may contain thousands separators ("1,000" -> 1000). NaN becomes 0. */
export function parseNumberInput(input: string | number | null | undefined): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  const n = Number(String(input ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
