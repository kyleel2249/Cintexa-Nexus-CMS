import { execPath } from "node:process";

const userAgent = process.env.npm_config_user_agent ?? "";

// npm is the supported package manager for CINTEXA Nexus. Keep installation
// cross-platform and do not rely on POSIX shell commands.
if (!userAgent.startsWith("npm/")) {
  console.error("CINTEXA Nexus requires npm. Run `npm install` from the repository root.");
  process.exit(1);
}

console.log(`Using Node ${process.version} (${execPath}) with npm.`);
