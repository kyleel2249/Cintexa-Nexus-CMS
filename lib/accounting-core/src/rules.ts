import { absBig, DECIMAL_FACTOR, isDigits, parseDecimalScaled, type IsoDate } from "./decimal";
import { POLICY_KEYS } from "./defaults";
import { PolicyError } from "./errors";
import type { PolicyRegistry } from "./registry";
import type { CapitalisationParams, DepreciationParams, FxTranslationParams, InventoryValuationParams, MaterialityParams, RevenueRecognitionParams } from "./types";

/**
 * Decision functions. Every accounting module asks these instead of deciding for itself, so Finance, Sales, Inventory,
 * Payroll and Fixed Assets cannot drift apart. Each result carries the policy key and version it relied on.
 */
export interface PolicyRef {
  policyKey: string;
  policyVersion: number;
}

function ref(key: string, version: number): PolicyRef {
  return { policyKey: key, policyVersion: version };
}

// ---- Depreciation -------------------------------------------------------------------------------------------------

export interface DepreciationRule extends PolicyRef {
  assetClass: string;
  method: "straight_line";
  annualRatePercent: string;
  /** Rate as a bigint scaled by 10^6, ready for exact arithmetic in the depreciation service. */
  annualRateScaled: bigint;
}

export function depreciationRule(registry: PolicyRegistry, assetClass: string, date: IsoDate): DepreciationRule {
  const v = registry.resolve(`depreciation.${assetClass}`, date);
  const p = v.params as unknown as DepreciationParams;
  const scaled = parseDecimalScaled(p.annualRatePercent);
  if (scaled === null) throw new PolicyError("INVALID_POLICY", `Stored depreciation rate for ${assetClass} is not valid`);
  return { ...ref(v.key, v.version), assetClass: p.assetClass, method: p.method, annualRatePercent: p.annualRatePercent, annualRateScaled: scaled };
}

// ---- Inventory ----------------------------------------------------------------------------------------------------

export function inventoryValuationMethod(registry: PolicyRegistry, date: IsoDate): PolicyRef & { method: InventoryValuationParams["method"] } {
  const v = registry.resolve(POLICY_KEYS.inventoryValuation, date);
  return { ...ref(v.key, v.version), method: (v.params as unknown as InventoryValuationParams).method };
}

// ---- Foreign currency ---------------------------------------------------------------------------------------------

export type FxItemKind = "monetary" | "non_monetary_historical_cost" | "non_monetary_fair_value";
export type FxRateBasis = "closing_rate" | "historical_rate" | "rate_at_fair_value_date";

/** Which rate applies to an item at period end. Non-monetary items are never revalued at the closing rate. */
export function fxRateBasis(registry: PolicyRegistry, kind: FxItemKind, date: IsoDate): PolicyRef & { basis: FxRateBasis; revalueAtPeriodEnd: boolean } {
  const v = registry.resolve(POLICY_KEYS.fxTranslation, date);
  const p = v.params as unknown as FxTranslationParams;
  switch (kind) {
    case "monetary":
      return { ...ref(v.key, v.version), basis: p.monetaryItems, revalueAtPeriodEnd: true };
    case "non_monetary_historical_cost":
      return { ...ref(v.key, v.version), basis: p.nonMonetaryHistoricalCost, revalueAtPeriodEnd: false };
    case "non_monetary_fair_value":
      return { ...ref(v.key, v.version), basis: p.nonMonetaryFairValue, revalueAtPeriodEnd: false };
  }
}

// ---- Revenue recognition ------------------------------------------------------------------------------------------

export type RevenueTrigger =
  | "quotation_issued"
  | "order_placed"
  | "invoice_issued"
  | "payment_received"
  | "delivery"
  | "service_performed"
  | "milestone_accepted"
  | "over_time_progress";

export type RevenueTreatment = "no_entry" | "defer_as_contract_liability" | "recognise_revenue";

export interface RevenueDecision extends PolicyRef {
  treatment: RevenueTreatment;
  reason: string;
}

const NON_TRANSACTIONS: RevenueTrigger[] = ["quotation_issued", "order_placed"];
const DOCUMENT_OR_CASH: RevenueTrigger[] = ["invoice_issued", "payment_received"];

/**
 * Decides what a sales event means for revenue. A quotation, an order, an invoice or a payment alone never recognises
 * revenue. Cash or an invoice ahead of performance is deferred; after performance it only settles an existing receivable.
 */
export function decideRevenueRecognition(registry: PolicyRegistry, input: { date: IsoDate; trigger: RevenueTrigger; performanceAlreadySatisfied?: boolean }): RevenueDecision {
  const v = registry.resolve(POLICY_KEYS.revenueRecognition, input.date);
  const p = v.params as unknown as RevenueRecognitionParams;
  const base = ref(v.key, v.version);
  if (NON_TRANSACTIONS.includes(input.trigger)) return { ...base, treatment: "no_entry", reason: `A ${input.trigger.replace("_", " ")} is not yet a recognised transaction.` };
  if (DOCUMENT_OR_CASH.includes(input.trigger)) {
    if (input.performanceAlreadySatisfied) return { ...base, treatment: "no_entry", reason: "Revenue was already recognised on performance; this event only settles or documents the receivable." };
    return { ...base, treatment: "defer_as_contract_liability", reason: "Invoice or payment ahead of delivery or performance does not recognise revenue." };
  }
  if ((p.recogniseOn as string[]).includes(input.trigger)) return { ...base, treatment: "recognise_revenue", reason: `Performance trigger "${input.trigger}" is enabled by the revenue policy.` };
  return { ...base, treatment: "defer_as_contract_liability", reason: `Trigger "${input.trigger}" is not enabled by the revenue policy.` };
}

// ---- Capital vs revenue expenditure -------------------------------------------------------------------------------

export type ExpenditureNature = "new_asset" | "improvement" | "repair" | "maintenance" | "other";
export interface CapitalisationDecision extends PolicyRef {
  treatment: "capitalise" | "expense";
  reason: string;
}

export function decideCapitalisation(registry: PolicyRegistry, input: { date: IsoDate; amountMinor: bigint; nature: ExpenditureNature; extendsLifeOrCapacity: boolean }): CapitalisationDecision {
  if (input.amountMinor < 0n) throw new PolicyError("INVALID_EVENT", "amountMinor cannot be negative");
  const v = registry.resolve(POLICY_KEYS.capitalisation, input.date);
  const p = v.params as unknown as CapitalisationParams;
  const base = ref(v.key, v.version);
  if (p.routineNaturesExpensed.includes(input.nature)) return { ...base, treatment: "expense", reason: `Routine ${input.nature} is revenue expenditure and is never capitalised.` };
  if (input.nature === "other") return { ...base, treatment: "expense", reason: "Expenditure that does not create or improve an asset is expensed." };
  if (input.nature === "improvement" && !input.extendsLifeOrCapacity) return { ...base, treatment: "expense", reason: "An improvement that does not extend life or capacity is expensed." };
  if (!isDigits(p.thresholdMinor)) throw new PolicyError("INVALID_POLICY", "Stored capitalisation threshold is not valid");
  if (input.amountMinor < BigInt(p.thresholdMinor)) return { ...base, treatment: "expense", reason: "Below the capitalisation threshold." };
  return { ...base, treatment: "capitalise", reason: "Creates or improves an asset and meets the capitalisation threshold." };
}

// ---- Materiality --------------------------------------------------------------------------------------------------

export interface MaterialityAssessment extends PolicyRef {
  material: boolean;
  reasons: string[];
}

/**
 * Quantitative and qualitative materiality. A legal or regulatory matter is always material: thresholds never bypass it.
 * With a zero benchmark a non-zero item cannot be compared, so it is treated as material (the prudent reading).
 */
export function assessMateriality(registry: PolicyRegistry, input: { date: IsoDate; amountMinor: bigint; benchmarkMinor: bigint; qualitativeFlags?: string[]; legalOrRegulatory?: boolean }): MaterialityAssessment {
  const v = registry.resolve(POLICY_KEYS.materiality, input.date);
  const p = v.params as unknown as MaterialityParams;
  const thr = parseDecimalScaled(p.thresholdPercent);
  if (thr === null) throw new PolicyError("INVALID_POLICY", "Stored materiality threshold is not valid");
  const reasons: string[] = [];
  const amount = absBig(input.amountMinor);
  const bench = absBig(input.benchmarkMinor);

  if (input.legalOrRegulatory) reasons.push("Legal or regulatory requirement: materiality thresholds do not apply.");
  if (amount > 0n && bench === 0n) reasons.push(`Benchmark (${p.benchmark}) is zero, so the item cannot be compared and is treated as material.`);
  else if (bench > 0n && amount * 100n * DECIMAL_FACTOR >= thr * bench) reasons.push(`Amount is at or above ${p.thresholdPercent}% of ${p.benchmark}.`);
  if (p.absoluteFloorMinor !== undefined && amount >= BigInt(p.absoluteFloorMinor)) reasons.push("Amount is at or above the absolute floor.");
  for (const flag of input.qualitativeFlags ?? []) {
    if (p.qualitativeAlwaysMaterial.includes(flag)) reasons.push(`Qualitative factor "${flag}" is always material.`);
  }
  return { ...ref(v.key, v.version), material: reasons.length > 0, reasons };
}

// ---- Readiness ----------------------------------------------------------------------------------------------------

export function policyReadiness(registry: PolicyRegistry, date: IsoDate, keys: readonly string[]): { ready: boolean; missing: string[] } {
  const missing = registry.missing(keys, date);
  return { ready: missing.length === 0, missing };
}
