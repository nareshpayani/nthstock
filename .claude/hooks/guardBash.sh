#!/bin/bash
# PreToolUse(Bash): blocks commands CLAUDE.md §8 forbids agents from running.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

command="$(jsonField tool_input.command)"
[ -z "$command" ] && exit 0

# Pushing to main, or force-pushing without a lease, is never allowed (main is protected; squash merge only).
if printf '%s' "$command" | grep -Eq 'git[[:space:]]+push'; then
  if printf '%s' "$command" | grep -Eq '(^|[[:space:]:])(refs/heads/)?main([[:space:]]|$)'; then
    block "Blocked: agents never push to main. Push a feat/, fix/, chore/ or docs/ branch and open a PR."
  fi
  if printf '%s' "$command" | grep -Eq '(--force([[:space:]]|$)|[[:space:]]-f([[:space:]]|$))'; then
    block "Blocked: plain force-push. Use --force-with-lease, and only on a branch you created."
  fi
fi

# Merging PRs by hand is reserved for agent-automerge.yml and the owner (ADR 0006).
if printf '%s' "$command" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge'; then
  block "Blocked: agents never merge PRs by hand. agent-automerge.yml or the owner merges."
fi

# New dependencies need the owner's approval (CLAUDE.md §8.6). Plain `npm install` / `npm ci` is fine.
if printf '%s' "$command" | grep -Eq 'npm[[:space:]]+(install|i|add)[[:space:]]+[^-[:space:]]'; then
  block "Blocked: adding a dependency needs the owner's approval (CLAUDE.md §8). Ask first; if approved, the owner runs the install."
fi

exit 0
