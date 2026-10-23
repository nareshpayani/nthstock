#!/usr/bin/env bash
# Frees Firebase Hosting preview channels that closed pull requests leave behind (NSTOCK-0333).
# Each PR gets a channel named "pr<number>-<branch>" (web-hosting.yml). The site's channel quota is
# small, so a busy day of PRs fills it and every new preview fails with "channel quota reached".
# This deletes the channel of every PR that is no longer open, and of the PRs named on the command
# line, whatever their state. The `live` and `dev` channels are never touched.
#
#   sweepPreviewChannels.sh [<pr number>...]
#
# Needs firebase-tools (FIREBASE_TOOLS_VERSION, default 15.34.0), gh, jq, GH_TOKEN,
# FIREBASE_PROJECT_ID, and GOOGLE_APPLICATION_CREDENTIALS pointing at the deploy service account.
set -euo pipefail

: "${FIREBASE_PROJECT_ID:?Set FIREBASE_PROJECT_ID}"
REPO="${REPO:-${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY or REPO}}"
FIREBASE=(npx --yes "firebase-tools@${FIREBASE_TOOLS_VERSION:-15.34.0}")

declare -A forced=()
for number in "$@"; do forced["$number"]=1; done

channels=$("${FIREBASE[@]}" hosting:channel:list --project "$FIREBASE_PROJECT_ID" --json |
  jq -r '.result.channels[].name | split("/") | last | select(test("^pr[0-9]+-"))')

deleted=0
for channel in $channels; do
  number=${channel#pr}
  number=${number%%-*}
  if [[ -z "${forced[$number]:-}" ]]; then
    state=$(gh api "repos/$REPO/pulls/$number" --jq .state 2>/dev/null || echo unknown)
    [[ "$state" == "closed" ]] || continue
  fi
  echo "Deleting preview channel $channel (PR #$number)"
  "${FIREBASE[@]}" hosting:channel:delete "$channel" --project "$FIREBASE_PROJECT_ID" --force
  deleted=$((deleted + 1))
done
echo "Deleted $deleted preview channel(s)."
