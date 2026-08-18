/**
 * Data connector stubs for CRM / analytics / ads.
 * Real OAuth and API pulls plug into the same interface later.
 */

export type ConnectorProvider =
  | "hubspot"
  | "salesforce"
  | "ga4"
  | "meta_ads"
  | "google_ads"
  | "shopify"
  | "custom_csv";

export const CONNECTOR_CATALOG: Array<{
  provider: ConnectorProvider;
  displayName: string;
  category: "crm" | "analytics" | "ads" | "commerce" | "file";
  description: string;
  metrics: string[];
}> = [
  { provider: "hubspot", displayName: "HubSpot CRM", category: "crm", description: "Contacts, deals, pipeline stages", metrics: ["open_deals", "won_deals", "pipeline_value"] },
  { provider: "salesforce", displayName: "Salesforce", category: "crm", description: "Opportunities and account health", metrics: ["opportunities", "win_rate"] },
  { provider: "ga4", displayName: "Google Analytics 4", category: "analytics", description: "Sessions, conversions, traffic sources", metrics: ["sessions", "conversions", "bounce_rate"] },
  { provider: "meta_ads", displayName: "Meta Ads", category: "ads", description: "Spend, CPL, ROAS by campaign", metrics: ["spend", "cpl", "roas"] },
  { provider: "google_ads", displayName: "Google Ads", category: "ads", description: "Search and display performance", metrics: ["spend", "cpc", "conversions"] },
  { provider: "shopify", displayName: "Shopify", category: "commerce", description: "Orders, AOV, repeat rate", metrics: ["orders", "aov", "repeat_rate"] },
  { provider: "custom_csv", displayName: "CSV / Spreadsheet upload", category: "file", description: "Manual metric import", metrics: ["custom"] },
];

/** Simulated sync — returns placeholder metrics labeled USER PROVIDED / INFERRED never as live verified unless wired */
export function simulateConnectorSync(provider: ConnectorProvider): {
  status: "connected";
  metricsPreview: Record<string, number | string | null>;
  note: string;
  evidence: "UNKNOWN";
} {
  const base: Record<string, number | string | null> = {};
  if (provider === "hubspot" || provider === "salesforce") {
    base.open_deals = null;
    base.pipeline_value = null;
    base.win_rate = null;
  } else if (provider === "ga4") {
    base.sessions = null;
    base.conversions = null;
  } else if (provider === "meta_ads" || provider === "google_ads") {
    base.spend = null;
    base.roas = null;
    base.cpl = null;
  } else if (provider === "shopify") {
    base.orders = null;
    base.aov = null;
  }
  return {
    status: "connected",
    metricsPreview: base,
    note: "Connector registered. Live API sync is not active in this environment — metrics remain UNKNOWN until OAuth credentials and a sync job are configured.",
    evidence: "UNKNOWN",
  };
}
