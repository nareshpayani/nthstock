#!/bin/bash
# PostToolUse (Edit|Write|MultiEdit): formats the edited file with Prettier and lints it with the
# workspace's ESLint config, the same checks CI runs. Lint errors go back to Claude (exit 2) so it
# fixes them before moving on.
set -uo pipefail
. "$(dirname "$0")/lib/common.sh"

file=$(jq -r '.tool_input.file_path // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0
deps_installed || exit 0
use_node22

rel="${file#"$ROOT"/}"
[ "$rel" != "$file" ] || exit 0 # outside the repo
cd "$ROOT" || exit 0

# Prettier honours .prettierignore (Markdown, generated files) and skips unknown types.
npx --no-install prettier --write --ignore-unknown --log-level warn "$rel" >/dev/null 2>&1 || true

case "$rel" in
  *.ts | *.tsx | *.js | *.mjs | *.cjs) ;;
  *) exit 0 ;;
esac
ws=$(workspace_of "$rel")
[ -n "$ws" ] && [ -f "$ws/eslint.config.js" ] || exit 0

out=$(cd "$ws" && npx --no-install eslint --no-warn-ignored --max-warnings 0 "${rel#"$ws"/}" 2>&1)
if [ $? -ne 0 ]; then
  echo "ESLint found problems in $rel (CI will fail on these):" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
