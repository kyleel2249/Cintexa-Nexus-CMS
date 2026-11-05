/**
 * Brand consistency assistant — heuristic text checks against approved/restricted claims.
 * Not legal certification. Does not rewrite user content.
 */
import type { BrandClaim, BrandProfile } from "./entities";

export type ComplianceSeverity = "info" | "warning" | "critical";

export type ComplianceIssue = {
  id: string;
  severity: ComplianceSeverity;
  message: string;
  excerpt?: string;
  suggestion?: string;
};

export function scanBrandCompliance(
  text: string,
  brand: BrandProfile | null | undefined,
  claims: BrandClaim[],
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (!text?.trim()) {
    issues.push({
      id: "empty",
      severity: "info",
      message: "No body text yet. Brand checks run when content is present.",
    });
    return issues;
  }
  const lower = text.toLowerCase();

  const restricted = claims.filter((c) => c.status === "restricted" || c.status === "prohibited");
  for (const c of restricted) {
    if (c.text && lower.includes(c.text.toLowerCase())) {
      issues.push({
        id: `restricted-${c.id}`,
        severity: c.status === "prohibited" ? "critical" : "warning",
        message: `${c.status === "prohibited" ? "Prohibited" : "Restricted"} claim appears in the text.`,
        excerpt: c.text.slice(0, 120),
        suggestion: "Remove or replace with an approved claim from Brand Management.",
      });
    }
  }

  const approved = claims.filter((c) => c.status === "approved");
  const hasApprovedSnippet = approved.some((c) => c.text && lower.includes(c.text.toLowerCase().slice(0, Math.min(40, c.text.length))));
  if (approved.length > 0 && !hasApprovedSnippet && text.length > 80) {
    issues.push({
      id: "no-approved",
      severity: "info",
      message: "No approved brand claim detected in this text.",
      suggestion: "Consider inserting an approved claim for consistent messaging.",
    });
  }

  const risky = [
    /\bguaranteed?\s+results?\b/i,
    /\b100%\s+success\b/i,
    /\brisk[- ]free\b/i,
    /\bbest\s+in\s+the\s+world\b/i,
  ];
  for (const re of risky) {
    const m = text.match(re);
    if (m) {
      issues.push({
        id: `risky-${re.source}`,
        severity: "warning",
        message: "Potentially overstated performance language detected.",
        excerpt: m[0],
        suggestion: "Prefer measurable, evidence-backed wording aligned with approved claims.",
      });
    }
  }

  if (brand?.name && text.length > 40 && !lower.includes(brand.name.toLowerCase()) && approved.length > 0) {
    issues.push({
      id: "brand-name",
      severity: "info",
      message: `Brand name “${brand.name}” does not appear in the text.`,
      suggestion: "Optional: include the brand name where natural.",
    });
  }

  return issues;
}
