import { execPath } from "node:process";
import { existsSync, unlinkSync } from "node:fs";

const userAgent = process.env.npm_config_user_agent ?? "";

// Keep the workspace deterministic on Windows, macOS and Linux without relying
// on POSIX-only shell commands. pnpm is the supported package manager.
if (!userAgent.startsWith("pnpm/")) {
  console.error("CINTEXA Nexus requires pnpm. Install pnpm and run the command again.");
  process.exit(1);
}

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  if (existsSync(lockfile)) {
    try {
      unlinkSync(lockfile);
      console.log(`Removed unsupported lockfile: ${lockfile}`);
    } catch (error) {
      console.warn(`Could not remove ${lockfile}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(`Using Node ${process.version} (${execPath}) with pnpm.`);
