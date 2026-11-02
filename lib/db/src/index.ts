import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
export { ensureSchema, SCHEMA_STATEMENTS } from "./bootstrap";
export { SALES_SCHEMA_STATEMENTS } from "./sales-schema";
export { createSalesDb, type SalesDb, type SalesQueryable } from "./sales-adapter";
export { SENTINEL_SCHEMA_STATEMENTS } from "./sentinel-schema";
export { FINANCE_SCHEMA_STATEMENTS, FINANCE_PHASE4_STATEMENTS, FINANCE_PHASE5_STATEMENTS } from "./finance-schema";
export { FINANCE_INTEGRATION_STATEMENTS } from "./finance-integration-schema";
export { CCDI_SCHEMA_STATEMENTS, CCDI_PERMISSION_SEED, CCDI_SYSTEM_ROLES } from "./ccdi-schema";

export {
  CCDI_FOUNDATION_SCHEMA_STATEMENTS,
  CCDI_FOUNDATION_PERMISSION_SEED,
  CCDI_FOUNDATION_SYSTEM_ROLES,
  CCDI_FOUNDATION_ROLE_EXTENSIONS,
  CCDI_RESTRICTED_PERMISSIONS,
} from "./ccdi-foundation-schema";
