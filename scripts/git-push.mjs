/**
 * Auto-push to GitHub after every build.
 * Requires GITHUB_TOKEN and GITHUB_REPO_URL to be set.
 * Skips silently if either is missing.
 */
import { execSync } from "node:child_process";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPO_URL;

if (!token || !repo) {
  console.log("[git-push] GITHUB_TOKEN or GITHUB_REPO_URL not set — skipping.");
  process.exit(0);
}

try {
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (!status) {
    console.log("[git-push] No changes to commit.");
    process.exit(0);
  }

  execSync('git config user.email "replit-autopush@noreply.replit.com"', { stdio: "pipe" });
  execSync('git config user.name "Replit Auto Push"', { stdio: "pipe" });

  execSync("git add -A", { stdio: "pipe" });

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  execSync(`git commit -m "Auto-push: ${timestamp} UTC"`, { stdio: "pipe" });

  const repoWithAuth = repo.replace(/^https:\/\//, `https://${token}@`);
  execSync(`git remote set-url origin "${repoWithAuth}"`, { stdio: "pipe" });

  execSync("git push origin HEAD", { stdio: "inherit" });
  console.log("[git-push] ✓ Pushed to GitHub successfully.");
} catch (err) {
  console.error("[git-push] Push failed (build continues):", err.message);
  process.exit(0);
}
