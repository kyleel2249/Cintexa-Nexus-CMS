import type { Queryable } from "../core/types";

/**
 * Default approval policies. Seeded idempotently (never overwrites an administrator's edits).
 * always_protected actions can never be switched to "no approval" (DB CHECK + route guard).
 * has_executor=false means the system records the decision but a person performs the action in the normal screens.
 */
const SEED_SQL = `INSERT INTO sales_approval_policies (action_type, label, requires_approval, always_protected, auto_executable, has_executor, approver_role, ttl_hours) VALUES
   ('activity.create_followup','Create internal follow-up task',FALSE,FALSE,TRUE,TRUE,'sales_manager',72),
   ('notification.internal','Send internal notification / risk alert',FALSE,FALSE,TRUE,TRUE,'sales_manager',72),
   ('lead.assign','Assign an unassigned lead',FALSE,FALSE,TRUE,TRUE,'sales_manager',72),
   ('message.customer','Send customer-facing message',TRUE,TRUE,FALSE,TRUE,'sales_manager',72),
   ('campaign.publish','Publish campaign message',TRUE,TRUE,FALSE,FALSE,'sales_director',72),
   ('price.change','Change official price',TRUE,TRUE,FALSE,FALSE,'sales_director',72),
   ('discount.exceptional','Apply exceptional discount',TRUE,TRUE,FALSE,FALSE,'sales_director',72),
   ('proposal.issue','Issue final commercial proposal',TRUE,TRUE,FALSE,FALSE,'sales_manager',72),
   ('order.confirm','Confirm material sales order',TRUE,TRUE,FALSE,FALSE,'sales_manager',72),
   ('commission.rule_change','Change commission rules',TRUE,TRUE,FALSE,FALSE,'sales_director',72),
   ('commission.release','Release commission payment',TRUE,TRUE,FALSE,FALSE,'finance',72),
   ('record.delete','Delete business-critical record',TRUE,TRUE,FALSE,FALSE,'sales_admin',72),
   ('permission.change','Change user permissions',TRUE,TRUE,FALSE,FALSE,'sales_admin',72),
   ('data.export_sensitive','Export sensitive customer information',TRUE,TRUE,FALSE,FALSE,'sales_director',72),
   ('lead.convert','Convert lead to account, contact and opportunity',TRUE,FALSE,FALSE,FALSE,'sales_manager',72)
   ON CONFLICT (action_type) DO NOTHING`;

export const POLICY_COUNT = 15;

export async function seedPolicies(q: Queryable): Promise<void> {
  const n = (await q.query<{ n: number }>("SELECT count(*)::int n FROM sales_approval_policies")).rows[0]!.n;
  if (n >= POLICY_COUNT) return;
  await q.query(SEED_SQL);
}
