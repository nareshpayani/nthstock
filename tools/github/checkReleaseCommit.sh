#!/usr/bin/env bash
# Refuses to deploy a commit unless it is on the environment's branch (develop for development,
# production for the live site, ADR 0010) and the latest run of each named workflow on that commit
# passed (default: CI only; Promote to production also requires Security: CodeQL, ADR 0014).
# Run from the checked-out commit by deploy-web-hosting.yml's dispatch stages (docs/runbooks/release.md).
# Needs gh with GH_TOKEN and GITHUB_REPOSITORY.
#   checkReleaseCommit.sh [branch] [workflow file...]   (defaults: production, ci.yml)
set -euo pipefail

branch="${1:-production}"
shift || true
workflows=("$@")
[ "${#workflows[@]}" -gt 0 ] || workflows=(ci.yml)
sha=$(git rev-parse HEAD)
git fetch --quiet origin "$branch"
if ! git merge-base --is-ancestor "$sha" "origin/$branch"; then
  echo "::error title=Not on $branch::$sha is not on $branch; only commits on $branch deploy here."
  exit 1
fi

for wf in "${workflows[@]}"; do
  run=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs?head_sha=$sha&per_page=20" \
    --jq '[.workflow_runs[] | select(.status == "completed")] | sort_by(.created_at) | last
          | if . == null then "none" else "\(.conclusion) \(.html_url)" end')
  case "$run" in
    success\ *) echo "$wf passed on $sha: ${run#success }" ;;
    none)
      echo "::error title=No $wf run::No finished $wf run on $sha yet. Wait for it (or dispatch it on $branch), then deploy again."
      exit 1 ;;
    *)
      echo "::error title=$wf not green::The latest $wf run on $sha ended '${run%% *}': ${run#* }"
      exit 1 ;;
  esac
done
