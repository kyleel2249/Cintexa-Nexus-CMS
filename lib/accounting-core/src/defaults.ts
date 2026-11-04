import type { IsoDate } from "./decimal";
import type { PolicyRegistry } from "./registry";
import type { ProposeInput } from "./types";

export const POLICY_KEYS = {
  framework: "reporting.framework",
  functionalCurrency: "currency.functional",
  depreciationComputerEquipment: "depreciation.computer_equipment",
  fxTranslation: "fx.translation",
  inventoryValuation: "inventory.valuation",
  revenueRecognition: "revenue.recognition",
  capitalisation: "capitalisation",
  materiality: "materiality",
} as const;

/**
 * Policies that must be configured by an authorised person before the related postings are allowed. They are deliberately
 * NOT seeded: the framework, inventory costing method and materiality thresholds are entity decisions, and the engine does
 * not invent them. Postings that need one fail with PolicyNotConfiguredError until it exists.
 */
export const MUST_BE_CONFIGURED: readonly string[] = [POLICY_KEYS.framework, POLICY_KEYS.inventoryValuation, POLICY_KEYS.materiality];

export const ALL_CORE_POLICY_KEYS: readonly string[] = Object.values(POLICY_KEYS);

type SeedProposal = Omit<ProposeInput, "actor" | "effectiveFrom">;

/** Policies stated in the Nexus accounting mandate or fixed by the standards themselves. */
export function defaultPolicyPack(functionalCurrency: string = "GHS"): SeedProposal[] {
  return [
    {
      key: POLICY_KEYS.functionalCurrency,
      domain: "functional_currency",
      params: { functionalCurrency },
      changeType: "initial",
      rationale: "Initial functional currency (assumed from the mandate's GHC amounts; confirm).",
      standardRef: "IAS 21",
    },
    {
      key: POLICY_KEYS.depreciationComputerEquipment,
      domain: "depreciation",
      params: { assetClass: "computer_equipment", method: "straight_line", annualRatePercent: "25", convention: "annual_divided_by_12", startsOn: "available_for_use" },
      changeType: "initial",
      rationale: "Mandatory 25% annual straight-line accounting depreciation for computers and laptops (Cintexa policy). Accounting depreciation only; Ghana tax capital allowances are tracked separately.",
      standardRef: "IAS 16 / IFRS for SMEs s17",
    },
    {
      key: POLICY_KEYS.fxTranslation,
      domain: "fx_translation",
      params: { monetaryItems: "closing_rate", nonMonetaryHistoricalCost: "historical_rate", nonMonetaryFairValue: "rate_at_fair_value_date", unrealisedDifferences: "reverse_next_period" },
      changeType: "initial",
      rationale: "Monetary items at closing rate; non-monetary items at historical rate or rate at fair-value date.",
      standardRef: "IAS 21",
    },
    {
      key: POLICY_KEYS.revenueRecognition,
      domain: "revenue_recognition",
      params: { recogniseOn: ["delivery", "service_performed", "milestone_accepted", "over_time_progress"], invoiceAloneRecognises: false, paymentAloneRecognises: false },
      changeType: "initial",
      rationale: "Revenue is recognised on transfer of goods or services, never on an invoice, order or payment alone.",
      standardRef: "IFRS 15 / IFRS for SMEs s23",
    },
    {
      key: POLICY_KEYS.capitalisation,
      domain: "capitalisation",
      params: { thresholdMinor: "0", routineNaturesExpensed: ["repair", "maintenance"] },
      changeType: "initial",
      rationale: "No capitalisation threshold set (0). Routine repairs and maintenance are always expensed.",
      standardRef: "IAS 16",
    },
  ];
}

/**
 * Installs the default pack. Idempotent: keys that already have any version are left alone, so re-running never rewrites
 * history. The approver defaults to the proposer, which is fine for the single-operator deployment; when the registry
 * enforces distinct approvers, pass a different `approver`.
 */
export function seedDefaultPolicies(registry: PolicyRegistry, opts: { effectiveFrom: IsoDate; actor: string; approver?: string; functionalCurrency?: string }): string[] {
  const seeded: string[] = [];
  for (const p of defaultPolicyPack(opts.functionalCurrency)) {
    if (registry.hasPolicy(p.key)) continue;
    const v = registry.propose({ ...p, effectiveFrom: opts.effectiveFrom, actor: opts.actor });
    registry.approve(p.key, v.version, opts.approver ?? opts.actor);
    seeded.push(p.key);
  }
  return seeded;
}
