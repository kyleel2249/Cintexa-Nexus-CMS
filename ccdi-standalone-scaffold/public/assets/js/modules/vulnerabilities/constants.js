export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];

export const FINDING_STATUSES = [
  'new', 'confirmed', 'under_investigation', 'accepted_risk', 'remediation_planned',
  'in_progress', 'resolved', 'retest_pending', 'reopened', 'false_positive',
];

export const FINDING_STATUS_BADGE = {
  new: 'cyan',
  confirmed: 'warn',
  under_investigation: 'warn',
  accepted_risk: 'neutral',
  remediation_planned: 'cyan',
  in_progress: 'warn',
  resolved: 'ok',
  retest_pending: 'cyan',
  reopened: 'danger',
  false_positive: 'neutral',
};

export const CONFIDENCE_LEVELS = ['confirmed', 'firm', 'tentative'];
export const DETECTION_SOURCES = [
  'manual', 'zap', 'nuclei', 'nikto', 'testssl', 'burp', 'nmap', 'openvas', 'nvd_feed', 'internal_engine',
];

export const VULN_CATEGORIES = [
  'broken_access_control', 'cryptographic_failures', 'injection', 'insecure_design',
  'security_misconfiguration', 'vulnerable_outdated_components', 'auth_failures',
  'software_data_integrity', 'logging_monitoring_failures', 'ssrf', 'other',
];

export const RESTRICTED_STATUS_TRANSITIONS = {
  // status -> roles allowed to set it (enforced server-side too)
  accepted_risk: 'admin',
  resolved: 'analyst',
  false_positive: 'analyst',
};
