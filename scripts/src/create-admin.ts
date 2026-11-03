/**
 * Create or update the administrator row in the Nexus database (cms_users).
 * Usage: CINTEXA_ADMIN_PASSWORD=... DATABASE_URL=... npm run admin:create --workspace=@workspace/scripts
 * Optional: CINTEXA_ADMIN_EMAIL, CINTEXA_ADMIN_NAME.
 * No third-party identity provider is involved: the password is stored as a bcrypt hash.
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const email = (process.env.CINTEXA_ADMIN_EMAIL ?? "cintexadmin@cintexa.com").trim().toLowerCase();
const name = process.env.CINTEXA_ADMIN_NAME ?? "Cintexa Admin";
const password = process.env.CINTEXA_ADMIN_PASSWORD;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("CINTEXA_ADMIN_PASSWORD must be provided and contain at least 8 characters.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const passwordHash = await bcrypt.hash(password as string, 12);
  const { rows } = await pool.query(
    `INSERT INTO cms_users (name, email, role, status, password_hash)
     VALUES ($1, $2, 'admin', 'active', $3)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, role = 'admin', status = 'active', password_hash = EXCLUDED.password_hash
     RETURNING id, (xmax = 0) AS inserted`,
    [name, email, passwordHash],
  );
  console.log(`Admin account ${rows[0].inserted ? "created" : "updated"}: ${email} (id ${rows[0].id})`);
}

main()
  .catch((error) => {
    console.error("Failed to provision admin account:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
