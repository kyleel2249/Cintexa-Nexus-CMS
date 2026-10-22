import type { AutonomyLevel, ProposedAction } from './types';

// Actions that ALWAYS need a human decision. Level 4 can never auto-run these; configuration cannot lower this.
export const MANDATORY_APPROVAL_TYPES: ReadonlySet<string> = new Set([
  'send_external_communication', 'apply_nonstandard_discount', 'change_commercial_terms',
  'create_binding_order', 'issue_refund', 'authorize_commission_payout', 'change_user_permissions',
  'delete_sensitive_records', 'export_sensitive_records', 'publish_website_change',
  'modify_production_infrastructure', 'change_financial_policy',
]);

export interface AutonomyPolicy {
  /** Level configured for an action type in this organisation (default applies otherwise). */
  levelFor(actionType: string): AutonomyLevel;
  /** Guarded-autonomy cap: max auto-executions per action type per run window. */
  maxAutoPerWindow?: number;
}

export function staticPolicy(defaultLevel: AutonomyLevel, overrides: Record<string, AutonomyLevel> = {}, maxAutoPerWindow = 10): AutonomyPolicy {
  return { levelFor: (t) => overrides[t] ?? defaultLevel, maxAutoPerWindow };
}

export type Disposition = 'suppress' | 'recommend' | 'prepare' | 'needs_approval' | 'auto_execute';

/**
 * Effective level = min(agent ceiling, org policy). Never elevated. Mandatory-approval types are capped at 3.
 * Level 4 auto-executes only low-risk, reversible, non-mandatory actions.
 */
export function decideDisposition(action: ProposedAction, agentCeiling: AutonomyLevel, policy: AutonomyPolicy): { level: AutonomyLevel; disposition: Disposition } {
  const mandatory = MANDATORY_APPROVAL_TYPES.has(action.type);
  let level = Math.min(agentCeiling, policy.levelFor(action.type)) as AutonomyLevel;
  if (mandatory && level > 3) level = 3;
  switch (level) {
    case 0: return { level, disposition: 'suppress' };
    case 1: return { level, disposition: 'recommend' };
    case 2: return { level, disposition: 'prepare' };
    case 3: return { level, disposition: 'needs_approval' };
    case 4:
      return action.risk === 'low' && action.reversible && !mandatory
        ? { level, disposition: 'auto_execute' }
        : { level: 3, disposition: 'needs_approval' };
  }
}
