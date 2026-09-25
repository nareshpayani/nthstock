#!/bin/bash
# Installs dependencies at the start of Claude Code web sessions so agents can run `npm run check`.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
npm install --no-audit --no-fund
