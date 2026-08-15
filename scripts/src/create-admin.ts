import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import * as schema from "@workspace/db/schema";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_EMAIL = (process.env.CINTEXA_ADMIN_EMAIL ?? "cintexadmin@cintexa.com").trim().toLowerCase();
const ADMIN_NAME = process.env.CINTEXA_ADMIN_NAME ?? "Cintexa Admin";
const ADMIN_PASSWORD = process.env.CINTEXA_ADMIN_PASSWORD;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error("CINTEXA_ADMIN_PASSWORD must be provided and contain at least 8 characters.");
  console.error("The password is intentionally read from the environment and is never stored in source control.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const [existing] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.email, ADMIN_EMAIL));

  if (existing) {
    await db.update(schema.usersTable).set({
      name: ADMIN_NAME,
      role: "admin",
      status: "active",
      passwordHash,
    }).where(eq(schema.usersTable.id, existing.id));
    console.log(`Admin account updated: ${ADMIN_EMAIL}`);
  } else {
    await db.insert(schema.usersTable).values({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      role: "admin",
      status: "active",
      passwordHash,
    });
    console.log(`Admin account created: ${ADMIN_EMAIL}`);
  }
}

main()
  .catch((error) => {
    console.error("Failed to provision admin account:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
