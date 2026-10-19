/**
 * Single source of truth for KPI definitions, shown on the dashboard ("What does this mean?") and used by the
 * reconciliation tests. Basis matters: booked = confirmed orders; collected = payments received.
 */
export interface KpiDefinition {
  key: string;
  label: string;
  definition: string;
  formula: string;
  source: string;
  basis?: "booked" | "invoiced" | "collected" | "n/a";
}

export const KPI_DEFINITIONS: KpiDefinition[] = [
  { key: "sales_today", label: "Today's sales", definition: "Value of orders confirmed today (business timezone), net of tax, less the returns recorded against those orders.", formula: "Σ (net_total − returned_total) of orders with booked_at today", source: "sales_orders", basis: "booked" },
  { key: "revenue_mtd", label: "Month-to-date revenue", definition: "Booked order value (net of tax) confirmed in the period, less the returns recorded against those orders. Orders in other currencies are excluded and counted separately.", formula: "Σ (net_total − returned_total) of orders with booked_at in the period", source: "sales_orders", basis: "booked" },
  { key: "gross_profit", label: "Gross profit", definition: "Net order value minus recorded unit costs, only for orders where every line has a cost.", formula: "Σ (net_total − cost_total) over fully-costed orders", source: "sales_orders", basis: "booked" },
  { key: "gross_margin", label: "Gross margin %", definition: "Gross profit divided by the net value of the same fully-costed orders.", formula: "gross_profit ÷ Σ net_total (fully-costed orders) × 100", source: "sales_orders", basis: "booked" },
  { key: "target_attainment", label: "Target attainment", definition: "Actual performance on the target's basis divided by the approved target.", formula: "actual ÷ target × 100 (blank when the target is zero)", source: "sales_targets", basis: "n/a" },
  { key: "new_leads", label: "New leads", definition: "Leads created in the period, excluding merged duplicates.", formula: "count(leads where created_at in period and merged_into_id is null)", source: "sales_leads" },
  { key: "qualified_opps", label: "Qualified opportunities", definition: "Open opportunities beyond the first pipeline stage.", formula: "count(open opportunities where stage position > 1)", source: "sales_opportunities" },
  { key: "open_pipeline", label: "Open pipeline value", definition: "Sum of open opportunity amounts (net of tax, in the opportunity currency).", formula: "Σ amount (status = open)", source: "sales_opportunities" },
  { key: "weighted_pipeline", label: "Weighted pipeline", definition: "Open pipeline weighted by stage probability.", formula: "Σ amount × probability ÷ 100 (status = open)", source: "sales_opportunities" },
  { key: "win_rate", label: "Win rate", definition: "Won deals divided by all closed deals in the period (by close date).", formula: "won ÷ (won + lost) × 100", source: "sales_opportunities" },
  { key: "avg_deal_size", label: "Average deal size", definition: "Mean amount of deals won in the period.", formula: "Σ won amount ÷ won count", source: "sales_opportunities" },
  { key: "sales_cycle", label: "Average sales cycle", definition: "Mean days from opportunity creation to close for deals won in the period.", formula: "avg(closed_at − created_at) for won", source: "sales_opportunities" },
  { key: "new_customers", label: "New customers acquired", definition: "Accounts whose first confirmed order falls in the period.", formula: "count(accounts with first booked order in period)", source: "sales_orders" },
  { key: "repeat_revenue", label: "Repeat customer revenue", definition: "Booked revenue in the period from accounts that had an earlier order.", formula: "Σ net_total where the account has an order before the period", source: "sales_orders", basis: "booked" },
  { key: "overdue_followups", label: "Overdue follow-ups", definition: "Open activities whose due date has passed.", formula: "count(activities open and due_at < now)", source: "sales_activities" },
  { key: "overdue_quotes", label: "Overdue quotations", definition: "Sent or viewed quotations past their validity date that were not accepted or rejected.", formula: "count(quotations sent|viewed and validity_date < today)", source: "sales_quotations" },
  { key: "receivables", label: "Outstanding receivables", definition: "Order totals not yet paid, only where payments are tracked; unavailable when no finance system is connected.", formula: "Σ (total − paid_total) over invoiced, unpaid orders", source: "sales_orders, sales_order_payments", basis: "invoiced" },
  { key: "forecast", label: "Forecast revenue", definition: "Closed revenue plus stage-weighted open pipeline expected to close in the period.", formula: "closed + Σ amount × probability (expected close in period)", source: "sales_opportunities" },
  { key: "quote_conversion", label: "Quotation conversion", definition: "Accepted quotations divided by quotations that reached a final outcome.", formula: "accepted ÷ (accepted + rejected + expired) × 100", source: "sales_quotations" },
  { key: "lead_conversion", label: "Lead conversion", definition: "Converted leads divided by leads created in the period.", formula: "converted ÷ created × 100", source: "sales_leads" },
];
