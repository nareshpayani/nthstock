# 0003. Agent team on GitHub Actions

- Status: Accepted
- Date: 2026-09-25

## Context
The owner wants a fully automatic workflow: agents plan, build, review and fix; the owner only
approves specs and merges. The workflow must be reusable and must be safe on a public repository.

## Decision
Run four agents (Planner, Developer, Reviewer, Fixer) as GitHub Actions workflows using
`anthropics/claude-code-action@v1`, authenticated with the owner's Claude subscription token
(`CLAUDE_CODE_OAUTH_TOKEN`). Labels form the state machine. Role instructions live in
`.claude/agents/*.md`, so the same roles work in interactive Claude sessions.

Review findings inside a PR are fixed on the same PR; only out-of-scope bugs become new issues.

## Consequences
- Everything is versioned in the repo and can be copied to other repos.
- The Claude GitHub App token is used (not `GITHUB_TOKEN`), so agent PRs and pushes trigger the
  next workflow. Where `GITHUB_TOKEN` must be used, `workflow_dispatch` hands off instead.
- Usage counts against the owner's Claude plan; turn limits, timeouts and the 3-round loop limit bound it.
- Public-repo safety depends on the actor checks in each workflow; changes to those checks need owner review.

## Amendment (2026-09-26): auto-merge

The owner asked for agent PRs to merge automatically once CI is green, instead of waiting for a manual
merge. `agent-automerge.yml` squash-merges one owner or agent PR per run when every check on its head
commit is green and it has no `spec`, `needs-human`, `agent:fix-needed` or `do-not-merge` label.
Spec PRs still need the owner, because merging a spec is what approves it. Setting the repository
variable `AGENT_AUTOMERGE=false` turns it off. If `main`'s branch protection requires an approving
review, the merge step fails until that requirement is relaxed.
