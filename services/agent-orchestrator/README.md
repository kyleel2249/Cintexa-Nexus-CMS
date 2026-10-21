# agent-orchestrator

Standalone TypeScript module (no workspace deps) containing the agent orchestrator:
task orchestration (`orchestrator.ts`), autonomy/approval policy (`autonomy.ts`), model routing (`llm.ts`),
tool registry (`tools.ts`), store (`store.ts`), metrics (`metrics.ts`), SSRF guard (`ssrf.ts`),
schema validation (`validate.ts`) and shared types (`types.ts`).

Imports use explicit `.ts` extensions, so it lives outside the `api-server` typecheck project.

Typecheck: `npx tsc -p services/agent-orchestrator/tsconfig.json`
