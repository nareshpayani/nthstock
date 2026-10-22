# 0011. Agent-promoted releases to the production branch

- Status: Accepted
- Date: 2026-10-22
- Amends: [0010](0010-develop-and-main-branches.md) (how `develop` reaches production, and the
  branch's name)

## Context

ADR 0010 made releases a PR from `develop` into `main` that the owner merged. After the first
release (#389) the owner found the PR and their merge add nothing: whatever is on `develop` goes to
production anyway, and the tests decide whether it is fit to. On 2026-10-22 they asked that a
production deploy need no PR and no approval from them: the agents run the end-to-end tests and, if
everything passes, move `develop` to production. They also asked to rename `main` to `production`,
so the branch, the GitHub environment and the docs use one name.

## Decision

- **The production branch is `production`** (renamed from `main` by the owner in GitHub settings;
  GitHub keeps redirects from the old name). Every green CI run on it deploys the live site, as
  before.
- **Promote to production** (`.github/workflows/promote-to-production.yml`, dispatch only) is the only
  way `production` moves. When the owner asks for a production deploy, an agent runs it (the
  `release` skill). It checks that develop's latest commit:
  1. has a green CI run (lint, typecheck, unit and integration tests, build, every Playwright suite
     in msw and api mode, Web Vitals and render budgets, Storybook a11y, audit, secret scan), and
  2. is the commit the development environment last deployed and smoke-tested;
  then fast-forwards `production` to it. If `production` only holds merge commits `develop` lacks
  (the old release PR merges), it adds one merge commit and keeps it only if its files are exactly
  develop's. It never force-pushes and never ships anything not on `develop`.
- The push uses a fine-grained token (`PROMOTE_TOKEN`, Contents and Workflows write on this repo),
  because a `GITHUB_TOKEN` push starts no workflows and cannot carry `.github/workflows` changes.
  Without the token the workflow falls back to `GITHUB_TOKEN` and dispatches CI itself.
- CI then runs again on `production`, and its green run deploys and smoke-tests the live site. A
  failure after the deploy is rolled back with a live dispatch of the previous production commit.
- No release PRs: nothing opens a PR into `production`. Agents still never push to `develop` or
  `production` by hand; the workflow is the only writer.

## Consequences

- A release is one dispatch with no waiting on the owner. The owner's control is asking for it, and
  the tests and the development smoke test are the gate. The owner can add a required reviewer to
  the `production` environment if they ever want a click back.
- One owner setup: rename the branch, add `PROMOTE_TOKEN`, and keep `production` protected against
  force pushes and deletion without requiring a PR (or with the token's owner allowed to bypass), so
  the promotion can push (`docs/runbooks/environments.md`).
- Release stories under the releases epic (#386) are no longer needed per release.
