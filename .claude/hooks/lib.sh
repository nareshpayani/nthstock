#!/bin/bash
# Shared helpers for the Claude Code hooks in this folder. Sourced, not run.
# Hooks receive the tool call as JSON on stdin; jsonField reads one dotted path from it with Node,
# which every contributor already has (Node 22 is pinned in .nvmrc), so no jq is needed.

HOOK_INPUT="$(cat)"

jsonField() {
  HOOK_INPUT="$HOOK_INPUT" node -e '
    const path = process.argv[1].split(".");
    let value = JSON.parse(process.env.HOOK_INPUT || "{}");
    for (const key of path) value = value == null ? undefined : value[key];
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "$1"
}

repoRoot() {
  printf '%s' "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
}

# Exit code 2 blocks the tool call (PreToolUse) or hands the message back to Claude (PostToolUse, Stop).
block() {
  printf '%s\n' "$1" >&2
  exit 2
}
