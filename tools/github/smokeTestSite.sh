#!/usr/bin/env bash
# Smoke test after a live deploy: the site and an in-app route answer 200 with the security headers,
# and serve the index.html this run built (so the new build, not a cached old one, is live), and the
# entry script it names loads. Retries for a minute while the CDN catches up.
#   smokeTestSite.sh https://<project>.web.app apps/web/dist/index.html
set -euo pipefail

site="${1:?site URL}"
built="${2:?built index.html}"
entry=$(grep -oE 'src="/assets/[^"]+\.js"' "$built" | head -1 | sed -E 's/src="([^"]+)"/\1/')
[ -n "$entry" ] || { echo "::error::no entry script in $built"; exit 1; }

check() {
  local page status
  for path in / /dashboard /guide; do
    page=$(curl -fsS --max-time 20 -D /tmp/smoke-headers "$site$path") || { echo "$path: request failed"; return 1; }
    grep -qi '^content-security-policy:' /tmp/smoke-headers || { echo "$path: no CSP header"; return 1; }
    grep -qF "$entry" <<<"$page" || { echo "$path: still serves an older build (no $entry)"; return 1; }
  done
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$site$entry")
  [ "$status" = 200 ] || { echo "$entry: HTTP $status"; return 1; }
}

for attempt in 1 2 3 4 5 6; do
  if out=$(check 2>&1); then
    echo "Live site OK: $site serves the new build ($entry)."
    exit 0
  fi
  echo "Attempt $attempt: $out"
  sleep 10
done
echo "::error title=Live smoke test failed::$site: $out. Roll back by releasing the previous commit (docs/runbooks/release.md)."
exit 1
