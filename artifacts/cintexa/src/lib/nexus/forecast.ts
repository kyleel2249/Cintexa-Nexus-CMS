/**
 * Nexus predictive analysis. Deterministic and offline: Holt's linear exponential smoothing with an 80% interval taken
 * from the model's own past errors. It extrapolates recorded history; it does not know about future events, so every
 * result carries a confidence label and the number of data points used. Fewer than 3 points gives no forecast.
 */

export interface Forecast {
  n: number;
  method: "holt-linear" | "insufficient-data";
  points: number[];
  lower: number[];
  upper: number[];
  trend: "up" | "down" | "flat";
  /** Average change per period as a percentage of the recent level (0 when unknown). */
  slopePct: number;
  confidence: "low" | "medium" | "high";
  note: string;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

export function forecastSeries(values: number[], horizon = 3, alpha = 0.5, beta = 0.3): Forecast {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 3) {
    return { n: v.length, method: "insufficient-data", points: [], lower: [], upper: [], trend: "flat", slopePct: 0, confidence: "low", note: "At least 3 periods of history are needed before a forecast is shown." };
  }
  let level = v[0]!;
  let trend = v[1]! - v[0]!;
  const errors: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const predicted = level + trend;
    errors.push(v[i]! - predicted);
    const prevLevel = level;
    level = alpha * v[i]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const sigma = std(errors);
  const points: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const p = Math.round(level + h * trend);
    const band = 1.2816 * sigma * Math.sqrt(h);
    points.push(p);
    lower.push(Math.round(p - band));
    upper.push(Math.round(p + band));
  }
  const base = Math.max(Math.abs(level), 1);
  const slopePct = (trend / base) * 100;
  const dir: Forecast["trend"] = Math.abs(slopePct) < 2 ? "flat" : slopePct > 0 ? "up" : "down";
  const confidence: Forecast["confidence"] = v.length >= 8 ? "high" : v.length >= 5 ? "medium" : "low";
  return {
    n: v.length,
    method: "holt-linear",
    points,
    lower,
    upper,
    trend: dir,
    slopePct: Math.round(slopePct * 10) / 10,
    confidence,
    note: `Based on ${v.length} recorded periods; the range is an 80% interval from past forecast errors. It does not know about future events.`,
  };
}

export interface AmountCheck {
  n: number;
  typical: number;
  z: number | null;
  verdict: "no-history" | "typical" | "larger-than-usual" | "much-larger-than-usual" | "smaller-than-usual";
  message: string;
}

/** Compare a new amount (minor units) with the history of amounts on the same account. */
export function checkAmount(amount: number, history: number[]): AmountCheck {
  const h = history.filter((x) => Number.isFinite(x) && x > 0);
  if (h.length < 3) return { n: h.length, typical: Math.round(mean(h)), z: null, verdict: "no-history", message: "Not enough earlier entries on this account to compare." };
  const m = mean(h);
  const s = std(h) || Math.max(m * 0.1, 1);
  const z = (amount - m) / s;
  const verdict: AmountCheck["verdict"] = z > 3 ? "much-larger-than-usual" : z > 1.5 ? "larger-than-usual" : z < -1.5 ? "smaller-than-usual" : "typical";
  const message = verdict === "typical" ? "In line with earlier entries on this account." : verdict === "smaller-than-usual" ? "Smaller than earlier entries on this account." : verdict === "larger-than-usual" ? "Larger than earlier entries on this account. Check the amount." : "Much larger than earlier entries on this account. Check for a missing decimal or an extra zero.";
  return { n: h.length, typical: Math.round(m), z: Math.round(z * 10) / 10, verdict, message };
}

/** Fill gaps so a day/month series has one value per period (zero when nothing happened). */
export function densify(rows: Array<{ key: string; n: number }>, keys: string[]): number[] {
  const m = new Map(rows.map((r) => [r.key, r.n]));
  return keys.map((k) => m.get(k) ?? 0);
}
