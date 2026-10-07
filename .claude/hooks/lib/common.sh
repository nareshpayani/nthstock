#!/bin/bash
# Shared helpers for the Claude Code hooks. Sourced, never run directly.

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Puts Node 22 (.nvmrc) first on PATH when the default node is another major version.
use_node22() {
  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" = 22 ] && return 0
  if command -v brew >/dev/null 2>&1 && [ -d "$(brew --prefix node@22 2>/dev/null)/bin" ]; then
    PATH="$(brew --prefix node@22)/bin:$PATH"
  elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null && nvm use 22 >/dev/null 2>&1 || true
  fi
  export PATH
}

# True when dependencies are installed; hooks stay silent otherwise (for example in the Reviewer job).
deps_installed() { [ -d "$ROOT/node_modules/.bin" ]; }

# Nearest workspace folder (apps/x or packages/x) of a repo-relative path, or empty.
workspace_of() {
  case "$1" in
    apps/*/* | packages/*/*) echo "$1" | cut -d/ -f1-2 ;;
    *) echo "" ;;
  esac
}
