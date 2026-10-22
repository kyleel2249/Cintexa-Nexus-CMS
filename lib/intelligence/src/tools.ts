import { OrchestratorError } from './types';
import { validate } from './validate';
import type { Schema } from './validate';

export type ToolRisk = 'read' | 'write' | 'external';
export interface ToolContext { orgId: string; taskId: string; signal: AbortSignal }
export interface ToolDef {
  name: string;
  risk: ToolRisk;
  description: string;
  args: Schema;
  handler: (args: any, ctx: ToolContext) => Promise<unknown>;
}

/** Explicit allowlist registry. Agents can only invoke 'read' tools named in their definition. orgId comes from the task, never from args. */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  register(def: ToolDef): void {
    if (this.tools.has(def.name)) throw new Error(`tool already registered: ${def.name}`);
    this.tools.set(def.name, def);
  }
  has(name: string): boolean { return this.tools.has(name); }
  get(name: string): ToolDef | undefined { return this.tools.get(name); }
  names(): string[] { return [...this.tools.keys()]; }

  async invokeForAgent(allowed: readonly string[], name: string, args: unknown, ctx: ToolContext): Promise<unknown> {
    if (!allowed.includes(name)) throw new OrchestratorError('tool_not_permitted', `agent may not use tool ${name}`);
    const def = this.tools.get(name);
    if (!def) throw new OrchestratorError('tool_unavailable', `tool ${name} is not configured`);
    if (def.risk !== 'read') throw new OrchestratorError('tool_not_permitted', `tool ${name} is not read-only; use propose()`);
    if (typeof args === 'object' && args !== null && ('orgId' in args || 'organizationId' in args))
      throw new OrchestratorError('tool_not_permitted', 'tenant scope cannot be supplied by agents');
    const errs = validate(def.args, args ?? {});
    if (errs.length) throw new OrchestratorError('invalid_tool_args', errs.join('; '));
    return def.handler(args ?? {}, ctx);
  }
}
