# 0009. Agent-driven releases with an owner-confirmed preview

- Status: Accepted
- Date: 2026-10-21
- Amends: [0006](0006-auto-merge-and-self-healing.md) (agents may now deploy, through this flow only)

## Context

Since PR #365 the msw-mode web build is hosted on Firebase Hosting, and every green CI run on `main`
deployed it to the live site. With auto-merge (ADR 0006), that meant any merged agent or Dependabot
PR went live without anyone looking at it, and CLAUDE.md §8 said agents never deploy, so a release
the owner asked for still needed manual steps.

On 2026-10-21 the owner asked for a different balance: on a request for a production deployment, the
agents run all the checks and tests and deploy end to end on their own, except that the owner
confirms the preview link before it goes live.

## Decision

- **Merging no longer deploys.** The live site changes only when `web-hosting.yml` is dispatched
  with `stage=live`. `LIVE_DEPLOY=auto` (repo variable) restores deploy-on-green-main.
- **Gates in the workflow, not in the agent's memory.** Both dispatch stages refuse a commit that is
  not on `main` or whose latest CI run on it is not green (`tools/github/checkReleaseCommit.sh`).
- **Smoke tests on what reviewers get.** Every preview channel and every live deploy runs
  `e2e:deployed` (demo login, a paper buy, the guide, axe) against the deployed URL; the live job
  also checks the site serves the new build with its security headers
  (`tools/github/smokeTestSite.sh`).
- **The owner's OK is the only manual step.** The agent opens the PR with `do-not-merge`, sends the
  preview link, and after the owner's OK in chat removes the label, lets auto-merge merge, and
  dispatches the live deploy. The `release` skill and `docs/runbooks/release.md` are the procedure.
- **Rollback is a release** of the previous commit through the same gates, or Firebase's own
  rollback for speed.
- Live deploys run in the `production` GitHub environment, which records them and lets the owner add
  a required reviewer later without changing the workflow.

## Amendment (2026-10-21): development and production environments

At the owner's request there are two GitHub environments. **development** is the default: every
green CI run on `main` deploys to the long-lived Firebase `dev` channel and smoke-tests it, so merged
work is visible on a shared link without a release. **production** is the live site and is reached
only through the release flow above. Details: `docs/runbooks/environments.md`.

## Consequences

- Nothing reaches the live site without the owner having seen a preview of it; merged PRs wait on
  `main` until the next release.
- Agents can now deploy, but only `main` commits with green CI, only via the dispatch, and only after
  the owner's OK. A broken deploy is caught by the smoke tests within minutes and rolled back.
- Previews take about a minute longer (Chromium install and the smoke test), and a red preview smoke
  test blocks auto-merge like any other check.
- When the API and realtime servers are hosted (scalability phase), the same dispatch gains their
  deploy jobs; the flow does not change.
