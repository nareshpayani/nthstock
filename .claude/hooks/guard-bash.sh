#!/bin/bash
# PreToolUse (Bash): blocks git commands that break the repo rules (CLAUDE.md §8, D9):
# pushing to main, force-pushing, skipping hooks/checks, and printing secrets.
set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

deny() { echo "Blocked by .claude/hooks/guard-bash.sh: $1" >&2; exit 2; }

if grep -qE '(^|[;&|[:space:]])git[[:space:]]+push' <<< "$cmd"; then
  grep -qE '[[:space:]](origin[[:space:]]+)?(HEAD:)?(refs/heads/)?main([[:space:]]|$)|:main([[:space:]]|$)' <<< "$cmd" \
    && deny "never push to main; open a PR from a branch."
  grep -qE '[[:space:]](--force|-f)([[:space:]]|$)' <<< "$cmd" \
    && deny "no force-push; use --force-with-lease on your own branch if you must."
fi
grep -qE -- '--no-verify' <<< "$cmd" && deny "do not skip checks with --no-verify."
grep -qE '(cat|less|more|head|tail|bat)[[:space:]]+[^|;&]*\.env([[:space:]]|$|\.local|\.production)' <<< "$cmd" \
  && deny "do not print .env files; they hold secrets. Use .env.example for the variable list."
exit 0
