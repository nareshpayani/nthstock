#!/usr/bin/env bash
# Refuses to release a commit unless it is on main and its latest CI run on that commit passed.
# Run from the checked-out commit by web-hosting.yml's release stages (docs/runbooks/release.md).
# Needs gh with GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail

sha=$(git rev-parse HEAD)
git fetch --quiet origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "::error title=Not on main::$sha is not on main. Merge its PR first; only main is released."
  exit 1
fi

run=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=20" \
  --jq '[.workflow_runs[] | select(.status == "completed")] | sort_by(.created_at) | last
        | if . == null then "none" else "\(.conclusion) \(.html_url)" end')
case "$run" in
  success\ *) echo "CI passed on $sha: ${run#success }" ;;
  none)
    echo "::error title=No CI run::No finished CI run on $sha yet. Wait for CI (or dispatch it on main), then release again."
    exit 1 ;;
  *)
    echo "::error title=CI not green::The latest CI run on $sha ended '${run%% *}': ${run#* }"
    exit 1 ;;
esac
