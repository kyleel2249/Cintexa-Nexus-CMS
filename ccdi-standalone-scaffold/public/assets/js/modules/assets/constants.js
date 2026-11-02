export const ASSET_TYPES = [
  'domain', 'subdomain', 'website', 'ip_address', 'ip_range', 'hostname',
  'network_service', 'application', 'api',
];

export const LIFECYCLE_STATES = [
  'discovered', 'pending_verification', 'verified', 'active', 'inactive', 'retired', 'excluded', 'under_investigation',
];

export const LIFECYCLE_BADGE = {
  discovered: 'neutral',
  pending_verification: 'warn',
  verified: 'cyan',
  active: 'ok',
  inactive: 'neutral',
  retired: 'neutral',
  excluded: 'danger',
  under_investigation: 'warn',
};

export const CRITICALITY = ['critical', 'high', 'medium', 'low'];
export const ENVIRONMENTS = ['production', 'staging', 'development', 'test', 'dr'];
export const ASSET_STATUS = ['active', 'inactive', 'maintenance', 'decommissioned'];

export const SCOPE_STATUS = ['in_scope', 'out_of_scope', 'pending_review'];
export const SCOPE_BADGE = { in_scope: 'ok', out_of_scope: 'danger', pending_review: 'warn' };

export const RELATIONSHIP_TYPES = [
  'parent_domain', 'subdomain_of', 'resolves_to', 'hosts', 'depends_on', 'part_of',
];

export const CSV_TEMPLATE_HEADERS = [
  'name', 'assetType', 'ownerEmail', 'environment', 'businessCriticality', 'tags', 'description',
];
