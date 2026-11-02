/**
 * Connector catalog. This is a REGISTRY/FRAMEWORK definition only — CCDI
 * does not ship or execute any scanner binaries. A connector entry
 * describes how the orchestration layer (functions/src/routes/connectors.js
 * + functions/src/routes/scans.js) would talk to an externally-installed,
 * separately-licensed tool that YOU install, configure and run under your
 * own authorization. Health checks only verify that the operator has
 * configured a reachable endpoint/credential for that tool; they never
 * invoke scanning or exploitation logic themselves.
 */
export const CONNECTOR_CATALOG = [
  { id: 'zap', name: 'OWASP ZAP', category: 'website', docsUrl: 'https://www.zaproxy.org/docs/', licensing: 'Apache-2.0, free' },
  { id: 'nuclei', name: 'Nuclei', category: 'website', docsUrl: 'https://docs.projectdiscovery.io/tools/nuclei', licensing: 'MIT, free' },
  { id: 'nikto', name: 'Nikto', category: 'website', docsUrl: 'https://github.com/sullo/nikto', licensing: 'GPLv2, free' },
  { id: 'testssl', name: 'testssl.sh', category: 'website', docsUrl: 'https://testssl.sh/', licensing: 'GPLv2, free' },
  { id: 'burp', name: 'Burp Suite (Enterprise/Pro API)', category: 'website', docsUrl: 'https://portswigger.net/burp', licensing: 'Commercial license required' },
  { id: 'nmap', name: 'Nmap', category: 'network', docsUrl: 'https://nmap.org/book/', licensing: 'NPSL, free' },
  { id: 'openvas', name: 'Greenbone / OpenVAS', category: 'network', docsUrl: 'https://greenbone.github.io/docs/', licensing: 'AGPL / commercial feed options' },
  { id: 'wireshark', name: 'Wireshark / TShark', category: 'network', docsUrl: 'https://www.wireshark.org/docs/', licensing: 'GPLv2, free' },
  { id: 'schemathesis', name: 'Schemathesis', category: 'api', docsUrl: 'https://schemathesis.readthedocs.io/', licensing: 'MIT, free' },
  { id: 'postman', name: 'Postman Collection Runner', category: 'api', docsUrl: 'https://learning.postman.com/docs/', licensing: 'Free / commercial tiers' },
];

export const CONNECTOR_STATUS = ['not_configured', 'configured', 'healthy', 'unreachable', 'error'];
export const CONNECTOR_STATUS_BADGE = { not_configured: 'neutral', configured: 'warn', healthy: 'ok', unreachable: 'danger', error: 'danger' };

export const SCAN_PROFILES = [
  { id: 'passive', name: 'Passive assessment', impact: 'None — read-only observation', requiresApproval: false },
  { id: 'basic', name: 'Basic security assessment', impact: 'Low — lightweight checks, no intrusive requests', requiresApproval: true },
  { id: 'standard', name: 'Standard vulnerability assessment', impact: 'Medium — active probing within rate limits', requiresApproval: true },
  { id: 'comprehensive', name: 'Comprehensive authorized assessment', impact: 'High — full authorized test suite, may trigger alerting on target', requiresApproval: true },
  { id: 'config_audit', name: 'Configuration audit', impact: 'None — configuration/header review only', requiresApproval: false },
];

export const SCAN_STATUS_BADGE = {
  pending_approval: 'warn', approved: 'cyan', in_progress: 'ok', completed: 'ok',
  denied: 'danger', cancelled: 'neutral', failed: 'danger',
};
