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
