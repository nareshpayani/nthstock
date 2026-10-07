#!/bin/bash
# PreToolUse (Bash): blocks git commands that break the repo rules (CLAUDE.md §8, D9):
# pushing to main, force-pushing, skipping hooks/checks, printing secrets, merging PRs by hand
# and adding dependencies without approval.
set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

deny() { echo "Blocked by .claude/hooks/guard-bash.sh: $1" >&2; exit 2; }

# Only the `git push …` segments are checked, so "main" in a commit message or a heredoc in the same
# command doesn't trip the rule.
pushes=$(grep -oE '(^|[;&|(])[[:space:]]*git[[:space:]]+push[^;&|]*' <<< "$cmd" || true)
if [ -n "$pushes" ]; then
  grep -qE '[[:space:]](origin[[:space:]]+)?(HEAD:)?(refs/heads/)?main([[:space:]]|$)|:main([[:space:]]|$)' <<< "$pushes" \
    && deny "never push to main; open a PR from a branch."
  grep -qE '[[:space:]](--force|-f)([[:space:]]|$)' <<< "$pushes" \
    && deny "no force-push; use --force-with-lease on your own branch if you must."
fi
grep -qE -- '--no-verify' <<< "$cmd" && deny "do not skip checks with --no-verify."
grep -qE '(cat|less|more|head|tail|bat)[[:space:]]+[^|;&]*\.env([[:space:]]|$|\.local|\.production)' <<< "$cmd" \
  && deny "do not print .env files; they hold secrets. Use .env.example for the variable list."
grep -qE '(^|[;&|(])[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge' <<< "$cmd" \
  && deny "agents never merge PRs by hand; agent-automerge.yml or the owner merges (ADR 0006)."
grep -qE '(^|[;&|(])[[:space:]]*npm[[:space:]]+(install|i|add)[[:space:]]+[^-[:space:]]' <<< "$cmd" \
  && deny "a new dependency needs the owner's approval (CLAUDE.md §8); ask first."
exit 0
