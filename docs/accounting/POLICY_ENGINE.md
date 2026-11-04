# Accounting Policy & Rules Engine (`@workspace/accounting-core`)

Step 1 of the Nexus accounting build. Dependency-free TypeScript; no database, no network, no authentication.

## What it does
- **One authority for policy.** Effective-dated, versioned policies per key (depreciation, FX translation, inventory valuation, revenue recognition, capitalisation, materiality, framework, functional currency). A version is never edited or deleted; a later approved version supersedes it.
- **Decision functions** every module must call instead of deciding for itself: `depreciationRule`, `inventoryValuationMethod`, `fxRateBasis`, `decideRevenueRecognition`, `decideCapitalisation`, `assessMateriality`. Each result carries the policy key and version used, so a journal can record which policy produced it.
- **IAS 8 discipline.** Initial, policy change, estimate change, error correction. Estimate changes are prospective only. Anything reaching into a locked period must be flagged `retrospective` and is marked `requiresRestatement`; plain backdating is refused.
- **No guessing.** Framework (IFRS vs IFRS for SMEs), inventory costing method and materiality thresholds are not seeded. Until configured, decisions throw `PolicyNotConfiguredError`.
- **Tamper-evident audit.** Every proposal, approval and rejection is in a SHA-256 hash chain; a registry refuses to load a snapshot whose chain fails.
- **No-login model.** Actors are plain strings (the fixed `open-access` operator today). Segregation of duties is `requireDistinctApprover`, off by default; turn it on when a second approver exists.

## Seeded by `seedDefaultPolicies`
Functional currency (GHS, assumed - confirm), 25% straight-line computer equipment depreciation, IAS 21 translation basis, revenue recognised on performance only, capitalisation (threshold 0; repair and maintenance always expensed).

## Not in this step
Persistence (the registry exposes `snapshot()` for step 2), posting/journals, chart of accounts, depreciation arithmetic, FX, inventory, payroll, restatement, year-end close, statements. Payroll statutory rates (PAYE, pension) are intentionally absent and will be effective-dated configuration, never hardcoded.

## Verification status
Tests are in `src/policy-engine.test.ts` (`npm test --workspace=@workspace/accounting-core`). **They have not been run**: they were written without a runnable workspace. Run `npm install`, then the test and typecheck scripts, before merging.
