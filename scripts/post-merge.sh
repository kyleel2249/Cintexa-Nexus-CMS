#!/usr/bin/env node
// Cross-platform post-merge helper. Run with: node scripts/post-merge.sh
import { execFileSync } from "node:child_process";

execFileSync("npm", ["install"], { stdio: "inherit", shell: true });
execFileSync("npm", ["run", "push", "--workspace=@workspace/db"], { stdio: "inherit", shell: true });
execFileSync("npm", ["run", "seed", "--workspace=@workspace/scripts"], { stdio: "inherit", shell: true });
