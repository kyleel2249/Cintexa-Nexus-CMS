-- Marketing Management foundation (idempotent)
-- Applied via API boot schema statements or run manually.

-- Core tables created by MARKETING_SCHEMA_STATEMENTS in lib/db/src/marketing-schema.ts
-- This file documents the migration for operators and CI.

-- Example: psql $DATABASE_URL -f this file
-- Or rely on the runtime idempotent statements registered in the API bootstrap.

BEGIN;

-- Placeholder: actual CREATE statements live in marketing-schema.ts and are executed on boot.
-- Operators may also run the exported statements array.

COMMIT;
