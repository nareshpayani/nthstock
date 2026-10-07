#!/bin/bash
# Stop: type-checks every workspace with changed TypeScript before Claude finishes its turn, so a
# turn never ends with code CI would reject. Skipped in CI (agents run `npm run check` there) and when
# nothing TypeScript changed.
set -uo pipefail
. "$(dirname "$0")/lib/common.sh"

input=$(cat)
# Claude is already continuing because of this hook: let it stop rather than loop.
[ "$(jq -r '.stop_hook_active // false' <<< "$input")" = true ] && exit 0
[ "${CI:-}" = true ] && exit 0
deps_installed || exit 0
cd "$ROOT" || exit 0

changed=$( { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard; } \
  | grep -E '\.(ts|tsx)$' | sort -u)
[ -n "$changed" ] || exit 0

filters=""
for ws in $(for f in $changed; do workspace_of "$f"; done | sort -u); do
  [ -f "$ws/package.json" ] || continue
  name=$(jq -r .name "$ws/package.json")
  filters="$filters --filter=$name"
done
[ -n "$filters" ] || exit 0

use_node22
# shellcheck disable=SC2086
out=$(npx --no-install turbo run typecheck $filters --output-logs=errors-only 2>&1)
if [ $? -ne 0 ]; then
  echo "TypeScript errors in the workspaces you changed (CI will fail on these):" >&2
  echo "$out" | grep -E 'error TS|\.tsx?\(' | head -40 >&2
  exit 2
fi
exit 0
