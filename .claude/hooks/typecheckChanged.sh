#!/bin/bash
# Stop: type-checks every workspace with changed TypeScript files before Claude finishes its turn.
# Errors go back to Claude (exit 2) to fix. Runs once per stop: a second stop in a row is let through.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

[ "$(jsonField stop_hook_active)" = "true" ] && exit 0
root="$(repoRoot)"
cd "$root" || exit 0
[ -x node_modules/.bin/tsc ] || exit 0

workspaces="$(
  git status --porcelain --untracked-files=all 2>/dev/null |
    awk '{print $NF}' |
    grep -E '\.(ts|tsx)$' |
    grep -Eo '^(apps|packages)/[^/]+' |
    sort -u
)"
[ -z "$workspaces" ] && exit 0

failed=""
for ws in $workspaces; do
  [ -f "$ws/package.json" ] || continue
  if ! output="$(npm run typecheck --silent -w "$ws" 2>&1)"; then
    failed+="
== $ws ==
$(printf '%s\n' "$output" | tail -n 40)"
  fi
done

[ -n "$failed" ] && block "TypeScript errors in changed workspaces:$failed"
exit 0
