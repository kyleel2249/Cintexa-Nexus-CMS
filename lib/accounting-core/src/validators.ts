import { isDigits, parseDecimalScaled, DECIMAL_FACTOR } from "./decimal";
import type { PolicyCategory, PolicyDomain } from "./types";

export const DOMAIN_CATEGORY: Record<PolicyDomain, PolicyCategory> = {
  reporting_framework: "disclosure",
  functional_currency: "measurement",
  depreciation: "measurement",
  fx_translation: "measurement",
  inventory_valuation: "valuation",
  revenue_recognition: "recognition",
  capitalisation: "classification",
  materiality: "disclosure",
};

const CURRENCY = /^[A-Z]{3}$/;
const REVENUE_TRIGGERS = ["delivery", "service_performed", "milestone_accepted", "over_time_progress"];
const MATERIALITY_BENCHMARKS = ["profit_before_tax", "revenue", "total_assets"];
const INVENTORY_METHODS = ["FIFO", "WEIGHTED_AVERAGE", "SPECIFIC_IDENTIFICATION"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
}

function percentInRange(v: unknown, label: string, out: string[]): void {
  const scaled = parseDecimalScaled(v);
  if (scaled === null) {
    out.push(`${label} must be a plain decimal string such as "25" or "0.5"`);
    return;
  }
  if (scaled <= 0n || scaled > 100n * DECIMAL_FACTOR) out.push(`${label} must be greater than 0 and at most 100`);
}

/** Returns a list of problems; an empty list means the params are valid for the domain. */
export function validateParams(domain: PolicyDomain, p: Record<string, unknown>): string[] {
  const out: string[] = [];
  switch (domain) {
    case "reporting_framework":
      if (p.framework !== "IFRS" && p.framework !== "IFRS_FOR_SMES") out.push('framework must be "IFRS" or "IFRS_FOR_SMES"');
      if (typeof p.presentationCurrency !== "string" || !CURRENCY.test(p.presentationCurrency)) out.push("presentationCurrency must be a 3-letter ISO code");
      break;
    case "functional_currency":
      if (typeof p.functionalCurrency !== "string" || !CURRENCY.test(p.functionalCurrency)) out.push("functionalCurrency must be a 3-letter ISO code");
      break;
    case "depreciation":
      if (typeof p.assetClass !== "string" || !p.assetClass.trim()) out.push("assetClass is required");
      if (p.method !== "straight_line") out.push('method must be "straight_line"');
      percentInRange(p.annualRatePercent, "annualRatePercent", out);
      if (p.convention !== "annual_divided_by_12") out.push('convention must be "annual_divided_by_12"');
      if (p.startsOn !== "available_for_use") out.push('startsOn must be "available_for_use"');
      break;
    case "fx_translation":
      if (p.monetaryItems !== "closing_rate") out.push('monetaryItems must be "closing_rate"');
      if (p.nonMonetaryHistoricalCost !== "historical_rate") out.push('nonMonetaryHistoricalCost must be "historical_rate"');
      if (p.nonMonetaryFairValue !== "rate_at_fair_value_date") out.push('nonMonetaryFairValue must be "rate_at_fair_value_date"');
      if (p.unrealisedDifferences !== "reverse_next_period") out.push('unrealisedDifferences must be "reverse_next_period"');
      break;
    case "inventory_valuation":
      if (p.method === "LIFO") out.push("LIFO is not permitted under IAS 2 / IFRS for SMEs");
      else if (typeof p.method !== "string" || !INVENTORY_METHODS.includes(p.method)) out.push("method must be FIFO, WEIGHTED_AVERAGE or SPECIFIC_IDENTIFICATION");
      if (p.allowNegativeStock !== false) out.push("allowNegativeStock must be false");
      break;
    case "revenue_recognition":
      if (!isStringArray(p.recogniseOn) || p.recogniseOn.length === 0 || !p.recogniseOn.every((t) => REVENUE_TRIGGERS.includes(t))) {
        out.push(`recogniseOn must be a non-empty list drawn from: ${REVENUE_TRIGGERS.join(", ")}`);
      }
      if (p.invoiceAloneRecognises !== false) out.push("invoiceAloneRecognises must be false");
      if (p.paymentAloneRecognises !== false) out.push("paymentAloneRecognises must be false");
      break;
    case "capitalisation":
      if (!isDigits(p.thresholdMinor)) out.push("thresholdMinor must be digits (amount in minor units, 0 = no threshold)");
      if (!isStringArray(p.routineNaturesExpensed) || !p.routineNaturesExpensed.includes("repair") || !p.routineNaturesExpensed.includes("maintenance")) {
        out.push('routineNaturesExpensed must be a list that includes at least "repair" and "maintenance"');
      }
      break;
    case "materiality":
      percentInRange(p.thresholdPercent, "thresholdPercent", out);
      if (typeof p.benchmark !== "string" || !MATERIALITY_BENCHMARKS.includes(p.benchmark)) out.push(`benchmark must be one of: ${MATERIALITY_BENCHMARKS.join(", ")}`);
      if (p.absoluteFloorMinor !== undefined && !isDigits(p.absoluteFloorMinor)) out.push("absoluteFloorMinor must be digits when given");
      if (!isStringArray(p.qualitativeAlwaysMaterial)) out.push("qualitativeAlwaysMaterial must be a list of strings (may be empty)");
      break;
    default: {
      const never: never = domain;
      out.push(`unknown policy domain ${String(never)}`);
    }
  }
  return out;
}
