# 0010. develop and main branches, development and production environments

- Status: Accepted; amended by [0011](0011-agent-promoted-releases.md) (`main` is renamed
  `production`, and releases are promoted by an agent without a release PR)
- Date: 2026-10-21
- Amends: [0006](0006-auto-merge-and-self-healing.md) (auto-merge, conflicts and the Fixer work on
  `develop`) and [0009](0009-agent-driven-releases.md) (how a release reaches the live site)

## Context

Until now every PR merged into `main`, and the live site changed only when an agent dispatched a
live deploy after the owner's OK on a preview (ADR 0009). There was no shared place to see
everything merged so far without releasing it. On 2026-10-21 the owner asked for two environments,
development (the default, never live) and production (live), and for the branches to match: all PRs
go to development, and a production deployment goes from `develop` to `main`.

## Decision

- **`develop` is the default branch and the development environment.** Every PR (owner, agent,
  Dependabot) targets `develop`. Auto-merge, the conflict resolver, the Fixer's red-branch PRs
  (`agent/fix-develop-*`), the issue-closing job and the scheduled health checks all work on
  `develop`. Every green CI run on `develop` deploys to the `development` GitHub environment, the
  long-lived Firebase `dev` channel (free on Spark), and smoke-tests it.
- **`main` is production.** It moves only through a **release PR** from `develop` into `main`, opened
  by an agent with the `release` skill and merged by the owner with a merge commit (squash would
  make the next release PR repeat what is already live). Every green CI run on `main` deploys to the
  `production` environment, the live site, with the same site check and smoke test.
- **The owner's merge of the release PR is the go-ahead** that ADR 0009 asked for as an OK on a
  preview. The development site is that preview: it runs the exact commit the release PR ships.
  Auto-merge never merges into `main`.
- Agents never push to `develop` or `main`; pre-push hooks in every agent job and the Claude Code
  hook block both. Release PRs are never checked out or fixed by agents; fixes go through PRs into
  `develop`, which update the open release PR.
- A dispatch of **Web hosting** with stage `development` or `live` redeploys an environment from a
  commit on its branch with green CI; `live` with an older commit is the rollback.
- The candidate stage and the `LIVE_DEPLOY=auto` switch from ADR 0009 are removed: the development
  environment replaces the first, and the release PR replaces the second.

## Consequences

- Merged work is on the development site minutes after it merges; the live site only changes when
  the owner merges a release PR.
- The owner's part of a release is one merge after looking at the development site (before: an OK
  in chat). Agents still do everything else, including watching the live deploy and rolling back.
- Repository settings the agents cannot change: the default branch (`develop`), branch protection on
  both branches, and merge commits staying allowed (`docs/runbooks/environments.md`).
- The automatic live deploy runs from a finished CI run, which GitHub executes in the context of the
  default branch, so the `production` environment cannot be restricted to the `main` branch; the
  workflow checks the branch itself.
- There is no hotfix lane: an urgent fix goes through `develop` and a release like any other change.
