# CI/CD pipeline

How nthstock builds, checks, deploys and releases, and why each part runs when it does. Decision
record: [ADR 0014](adr/0014-ci-cd-tiers-and-naming.md). The agent team that drives the PRs is in
[agent-workflow.md](agent-workflow.md); environments in [runbooks/environments.md](runbooks/environments.md);
releases in [runbooks/release.md](runbooks/release.md).

## Principles

1. **One gate, many jobs.** Branch rules require one check, **CI result**, which passes only when
   every CI job passed or was skipped on purpose. Adding a job never means editing the rules.
2. **Pay for what a change can break.** A PR runs only the suites its files can affect. `develop`,
   `production` and the scheduled health runs always run everything, so nothing reaches a deploy
   untested.
3. **Every merged commit gets a verdict.** PR runs cancel when a newer push replaces them; runs on
   `develop` and `production` are never cancelled, because the release gate and the PR fixer read them.
4. **Deploy only what was tested.** Development deploys the exact commit CI passed; production moves
   only through the promotion gate, and every promotion is tagged so rollback has a name.
5. **Least privilege, pinned supply chain.** Workflows default to `contents: read`; jobs ask for more
   only where they write. Third-party actions that see secrets (`claude-code-action`, the Firebase
   deploy) are pinned to a commit; Dependabot moves the pins weekly.
6. **Names say what runs.** `<area>-<what it does>.yml`, shown as `<Area>: <What it does>`.

## Workflows

| Area | Workflow (file) | Runs on | What it does | Blocks a merge? |
|---|---|---|---|---|
| CI | CI (`ci.yml`) | PR, push to develop/production, dispatch, 3 health runs a day | Quality checks, tests, E2E, budgets, scans; **CI result** gate | Yes (CI result) |
| Security | Security: CodeQL (`security-codeql.yml`) | PRs that change code, push, weekly | Static analysis, security-extended queries | No, but the release gate requires it |
| PR | PR: Title check (`pr-title-check.yml`) | PR opened, edited, pushed | `<type>(NSTOCK-0001): <subject>` naming a real issue | Yes |
| PR | PR: Screenshots (`pr-screenshots.yml`) | PRs that change the UI | Before/after screenshots in the PR body | No |
| PR | PR: Auto-merge (`pr-auto-merge.yml`) | after CI/CodeQL, label changes, hourly | Squash-merges approved, green PRs into develop | — |
| PR | PR: Clear needs-human (`pr-clear-needs-human.yml`) | PR pushed | Removes `needs-human` so agents resume | — |
| Deploy | Deploy: Web hosting (`deploy-web-hosting.yml`) | PRs that change the app, green CI on develop/production, dispatch | Preview channel per PR; development; live site; smoke tests | No |
| Release | Release: Promote to production (`release-promote-to-production.yml`) | dispatch only | Gate, then moves `production` to develop's head and tags it | — |
| Agent | Agent: Spec planner, Story developer, PR reviewer, PR fixer, Merge conflict resolver (`agent-*.yml`) | labels, PR events, CI results, pushes to develop | The LLM agents ([agent-workflow.md](agent-workflow.md)) | PR reviewer's label gates auto-merge |
| Issues | Issues: Assign NSTOCK key, Release spec stories, Close completed (`issues-*.yml`) | issue opened, PR merged, daily | Issue keys, story release, closing done work | — |
| Repo | Repo: Sync labels, Delete merged branches (`repo-*.yml`) | label file change, PR merged, daily | Housekeeping | — |

## CI tiers

`Detect changed areas` (the `changes` job) reads the PR's file list. Pushes, dispatches and
scheduled runs skip the detection and run everything.

| Job | Docs-only PR | Backend-only PR | Any other PR | develop, production, schedule |
|---|---|---|---|---|
| Lint, typecheck, test, build (with Postgres; OpenAPI drift) | runs | runs | runs | runs |
| Storybook build and a11y | skipped | skipped | runs | runs |
| Playwright smoke (Chrome, plus WebKit iPhone) | skipped | skipped | runs | runs |
| Web vitals and render budgets (Chrome, Lighthouse CI) | skipped | skipped | runs | runs |
| Playwright golden path (api mode), tick latency, perf smoke | skipped | runs | runs | runs |
| Dependency audit (`npm audit --audit-level=high`) | runs | runs | runs | runs |
| Secret scan (gitleaks, full history) | runs | runs | runs | runs |
| Dependency review (new deps: high advisories, GPL/AGPL; once enabled, see Branch rules) | runs | runs | runs | — |
| Workflow lint (actionlint + shellcheck) | runs | runs | runs | runs |
| **CI result** | runs | runs | runs | runs |

- **Docs-only:** every file is under `docs/` or `.claude/`, is a `.md` file, `LICENSE`, the issue or
  PR templates or `CODEOWNERS`.
- **Backend-only:** every other file is under `apps/api/`, `apps/realtime/`, `apps/quotes/` or
  `infra/`. The web app, Storybook and the msw-mode suites never import these.
- Anything else, including `.github/**`, `package.json`, `package-lock.json` and `packages/**`, runs
  every suite.
- The scheduled health runs (09:20 and 12:30 IST on weekdays while NSE is open, 20:00 IST daily
  while it is closed) catch breakage that shows only at some hours or without a new commit. A red
  one starts the PR fixer, and the daily one renews the development channel's 30-day expiry.

### Speed

- `setup-workspace` (`.github/actions/`) is Node from `.nvmrc` with the npm cache and `npm ci`.
- `setup-playwright` caches the Playwright browsers by `@playwright/test` version; a cache hit
  installs only the OS packages.
- Jobs run in parallel; the slowest (Web vitals, api-mode E2E) set the wall clock. PR previews and
  screenshots run only for app changes.

## What moved, and why

| Change | Before | After | Why |
|---|---|---|---|
| Change detection | every suite on every PR | suites the PR can affect | docs and backend PRs stop paying for browser suites |
| Required check | eight job names, kept by hand | **CI result** | one stable name; skipped jobs count as passed |
| develop runs | cancelled by the next merge | always finish | every merged commit gets a verdict for the release gate |
| CodeQL on PRs | every PR | PRs that change code | nothing to analyse in docs |
| Preview deploys | every PR | PRs that change the app | a Firebase deploy and smoke test per docs push was waste |
| PR fixer on label events | a runner for every label | only `agent:fix-needed` starts it | fewer empty runs per PR |
| Merged-branch sweep | hourly | daily | auto-merge already deletes its branches |
| Release gate | CI | CI and Security: CodeQL | no release with an open static-analysis finding |
| Releases | untagged | `prod-<UTC time>` tag per promotion | each release has a name and a rollback target |
| Added | — | dependency review, actionlint, browser cache, pinned agent action | supply chain and workflow correctness |
| Unchanged | | | PR fixer's no-progress safeguard, PR reviewer rounds, auto-merge rules, the promotion gate's dev smoke test, health schedule |

## Branch rules

Owner step (cloud sessions cannot change repository settings). Settings → Rules → New branch
ruleset:

- **develop:** require a pull request; squash merge only; block force pushes and deletion; required
  status checks **CI result** and **PR title has an NSTOCK key**; no required approvals (auto-merge
  works by the PR reviewer's label, ADR 0006). Bypass: none, so agents and the owner follow the same path.
- **production:** block force pushes and deletion; restrict updates to the `PROMOTE_TOKEN` identity
  (Promote to production is the only writer).
- Settings → General → Pull requests: allow squash merging only; tick "Automatically delete head
  branches".
- Settings → Code security: turn on **Dependency graph**, then Settings → Secrets and variables →
  Actions → Variables: `DEPENDENCY_REVIEW` = `true`. Until then the Dependency review job is skipped
  (it errors on a repository without the dependency graph).

## Release flow

```
PR ─► CI (tiered) + CodeQL + Title check + PR reviewer ─► ready-to-merge + CI result green ─► auto-merge (squash)
develop push ─► CI (full) + CodeQL ─► Deploy: Web hosting ─► development, smoke-tested
owner asks to release ─► Release: Promote to production
   gate: CI green, CodeQL green, development deployed and smoke-tested on develop's head
   ─► production fast-forwards ─► tag prod-<time> ─► CI on production ─► live deploy, smoke-tested
rollback ─► Deploy: Web hosting, stage live, the previous commit or prod-* tag
```

## Later, when the project grows

- A merge queue on develop, once several people merge at once: add the `merge_group` trigger to CI
  and let the queue replace auto-merge's one-merge-per-run rule.
- Remote Turborepo cache, once build time dominates.
- OpenSSF Scorecard and SBOM attestations for the release artifacts, with the Phase 6 AWS deploys.
- Required approvals from CODEOWNERS when there is a second maintainer.
