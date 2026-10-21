#!/bin/bash
# Installs dependencies at the start of web sessions so agents can run `npm run check`, and authors
# commits as the owner (CLAUDE.md §6 Attribution).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
git config user.name "Naresh Payani"
git config user.email "15100692+nareshpayani@users.noreply.github.com"
# npm ci installs exactly what package-lock.json says and never rewrites the lockfile.
npm ci --no-audit --no-fund
