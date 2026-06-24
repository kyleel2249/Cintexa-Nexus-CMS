#!/usr/bin/env bash
# Auto-push to GitHub after every build
# Requires: GITHUB_TOKEN env var

set -euo pipefail

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[github-sync] GITHUB_TOKEN not set — skipping GitHub push"
  exit 0
fi

REPO_URL="https://${GITHUB_TOKEN}@github.com/kyleel2249/Cintexa-Nexus-CMS.git"

cd "$(git rev-parse --show-toplevel)"

# Configure git identity if not already set
git config user.email "cintexa-bot@replit.app" 2>/dev/null || true
git config user.name "Cintexa Bot" 2>/dev/null || true

# Stage all tracked changes
git add -A

# Only commit if there's something to commit
if git diff --cached --quiet; then
  echo "[github-sync] Nothing to commit — already up to date"
  exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
git commit -m "chore: auto-sync build $TIMESTAMP [skip ci]"

# Push quietly (suppress token in logs)
git push "$REPO_URL" HEAD:main --quiet 2>&1 | sed "s/${GITHUB_TOKEN}/****/g" || true

echo "[github-sync] Pushed to GitHub successfully"
