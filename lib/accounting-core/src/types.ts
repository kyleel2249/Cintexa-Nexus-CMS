import type { IsoDate } from "./decimal";

export type PolicyDomain =
  | "reporting_framework"
  | "functional_currency"
  | "depreciation"
  | "fx_translation"
  | "inventory_valuation"
  | "revenue_recognition"
  | "capitalisation"
  | "materiality";

export type PolicyCategory = "recognition" | "measurement" | "classification" | "valuation" | "disclosure";

/** IAS 8 distinction: initial adoption, voluntary policy change, change in estimate (prospective only) or correction of an error. */
export type ChangeType = "initial" | "policy_change" | "estimate_change" | "error_correction";

export type PolicyStatus = "draft" | "approved" | "rejected";

export interface PolicyVersion {
  key: string;
  domain: PolicyDomain;
  category: PolicyCategory;
  version: number;
  status: PolicyStatus;
  /** First day the policy applies to. A version stays in force until a later approved version takes over. */
  effectiveFrom: IsoDate;
  params: Record<string, unknown>;
  changeType: ChangeType;
  rationale: string;
  standardRef?: string;
  /** True when the change is to be applied to periods that have already closed (needs a formal restatement). */
  retrospective: boolean;
  /** Set at approval: the change reaches into a locked period, so a restatement pack must be produced. */
  requiresRestatement: boolean;
  proposedBy: string;
  proposedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface ProposeInput {
  key: string;
  domain: PolicyDomain;
  effectiveFrom: IsoDate;
  params: Record<string, unknown>;
  changeType: ChangeType;
  rationale: string;
  standardRef?: string;
  retrospective?: boolean;
  actor: string;
}

export interface PolicyAuditEvent {
  seq: number;
  at: string;
  actor: string;
  action: "proposed" | "approved" | "rejected";
  key: string;
  version: number;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface RegistrySnapshot {
  versions: PolicyVersion[];
  audit: PolicyAuditEvent[];
}

/** Typed views of validated policy params. */
export interface DepreciationParams {
  assetClass: string;
  method: "straight_line";
  annualRatePercent: string;
  convention: "annual_divided_by_12";
  startsOn: "available_for_use";
}

export interface InventoryValuationParams {
  method: "FIFO" | "WEIGHTED_AVERAGE" | "SPECIFIC_IDENTIFICATION";
  allowNegativeStock: false;
}

export interface RevenueRecognitionParams {
  recogniseOn: Array<"delivery" | "service_performed" | "milestone_accepted" | "over_time_progress">;
  invoiceAloneRecognises: false;
  paymentAloneRecognises: false;
}

export interface CapitalisationParams {
  thresholdMinor: string;
  routineNaturesExpensed: string[];
}

export interface MaterialityParams {
  thresholdPercent: string;
  benchmark: "profit_before_tax" | "revenue" | "total_assets";
  absoluteFloorMinor?: string;
  qualitativeAlwaysMaterial: string[];
}

export interface FxTranslationParams {
  monetaryItems: "closing_rate";
  nonMonetaryHistoricalCost: "historical_rate";
  nonMonetaryFairValue: "rate_at_fair_value_date";
  unrealisedDifferences: "reverse_next_period";
}
