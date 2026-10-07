#!/bin/bash
# PostToolUse(Edit|Write|MultiEdit): formats the changed file with Prettier, then runs ESLint --fix on it.
# Lint errors that can't be auto-fixed go back to Claude (exit 2) so they are fixed straight away,
# instead of turning up later in `npm run check` or CI.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

file="$(jsonField tool_input.file_path)"
root="$(repoRoot)"
[ -z "$file" ] || [ ! -f "$file" ] && exit 0
case "$file" in "$root"/*) ;; *) exit 0 ;; esac
case "$file" in */node_modules/* | */dist/* | */.turbo/*) exit 0 ;; esac

bin="$root/node_modules/.bin"
[ -x "$bin/prettier" ] || exit 0 # dependencies not installed yet

"$bin/prettier" --write --ignore-unknown --log-level=warn "$file" >/dev/null 2>&1

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) ;;
  *) exit 0 ;;
esac

# Run ESLint from the nearest workspace that has its own config, so its rules (and ADR 0005 import
# boundaries for apps/web) apply.
dir="$(dirname "$file")"
while [ "$dir" != "$root" ] && [ ! -f "$dir/eslint.config.js" ]; do dir="$(dirname "$dir")"; done
[ -f "$dir/eslint.config.js" ] || exit 0

if ! output="$(cd "$dir" && "$bin/eslint" --fix --no-warn-ignored "$file" 2>&1)"; then
  block "ESLint found problems in ${file#"$root"/} that need fixing:
$output"
fi

exit 0
