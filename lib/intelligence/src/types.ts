// Core contracts for the CINTEXA NEXUS INTELLIGENCE ORCHESTRATOR.
// Zero runtime dependencies. Only erasable TypeScript syntax (runs under Node 22 type stripping and tsc).

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFORMATIONAL';
export type TaskStatus =
  | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type FindingStatus = 'confirmed' | 'needs_verification' | 'hypothesis';
export type AgentRole = string;

export interface Actor { userId: string; orgId: string; roles: string[] }

export interface Usage { promptTokens: number; completionTokens: number; costUsd: number }

export interface EvidenceRef { source: string; ref: string; observedAt?: string; note?: string }

export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: EvidenceRef[];
  confidence: number; // 0..1, independent of severity
  status: FindingStatus;
  meta?: Record<string, unknown>;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ProposedAction {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk: RiskLevel;
  reversible: boolean;
  requiredRoles?: string[];
}

export interface AgentOutput {
  taskId: string;
  agentRole: AgentRole;
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  evidence: EvidenceRef[];
  findings: Finding[];
  confidence: number;
  recommendedActions: ProposedAction[];
  uncertainties: string[];
  errors?: string[];
  summary?: string;
  data?: Record<string, unknown>;
}

export interface AgentTask {
  id: string;
  orgId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  lineage: AgentRole[]; // roles from root to this task (cycle prevention)
  depth: number;
  agentRole: AgentRole;
  input: Record<string, unknown>;
  priority: number; // 0..100, higher first
  status: TaskStatus;
  dependsOn: string[];
  idempotencyKey: string | null;
  inputHash: string;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  cancelRequested: boolean;
  result: AgentOutput | null;
  error: string | null;
  degraded: boolean;
  usage: Usage;
  progress: number; // 0..100
}

export type ApprovalStatus = 'prepared' | 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired';

export interface Approval {
  id: string;
  orgId: string;
  taskId: string;
  agentRole: AgentRole;
  action: ProposedAction;
  payloadHash: string;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  executionResult: { ok: boolean; detail?: string } | null;
}

export interface AuditEvent {
  id: string;
  orgId: string;
  at: string;
  actor: string;
  action: string;
  resource: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export class OrchestratorError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.retryable = retryable;
  }
}
