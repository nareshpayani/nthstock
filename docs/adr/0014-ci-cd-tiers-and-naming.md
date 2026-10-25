# 0014. CI/CD tiers, one required check, and meaningful agent and workflow names

- Status: Accepted
- Date: 2026-10-25
- Amends: [0003](0003-agent-team-on-github-actions.md) and [0006](0006-auto-merge-and-self-healing.md)
  (names, the auto-merge gate), [0011](0011-agent-promoted-releases.md) (the release gate)

## Context

On 2026-10-25 the owner asked for two things before the next production release. First, every
agent, workflow and job should have a name that says what it does, as a corporate product would
("conflict" should be something like "merge conflict fix"). Second, the pipeline should be
reviewed like a professional one: what must run on every PR, what belongs on merge, on a schedule
or on demand, and what is missing.

What we had: 17 workflows named in three styles (`Agent: …`, `CI`, `Web hosting`), several of them
called "Agent" without being LLM agents (auto-merge, label sync, issue closing). The merge conflict
resolver had no role of its own; it borrowed a section of the Fixer's. Every PR ran every suite,
including three browser suites and a Firebase preview deploy for a one-line docs change. Required
checks were eight job names kept by hand. A merge to `develop` cancelled the previous `develop`
run, so a merged commit could end without a verdict. CodeQL was not part of the release gate.
`claude-code-action`, which holds the agent token, was used by a moving tag.

## Decision

1. **Naming.** Workflow files are `<area>-<what it does>.yml`, display names `<Area>: <What it does>`,
   with areas `CI`, `Security`, `PR`, `Deploy`, `Release`, `Agent`, `Issues` and `Repo`. `Agent`
   is used only for LLM agents. Roles: `spec-planner`, `story-developer`, `pr-reviewer`, `pr-fixer`,
   and a new `merge-conflict-resolver` split out of the Fixer; specialists
   `error-handling-reviewer`, `test-coverage-reviewer`, `e2e-test-author` (were
   `silent-failure-hunter`, `test-gap-analyzer`, `e2e-author`). The label `agent:conflict` becomes
   `agent:merge-conflict`; Repo: Sync labels renames it in place. Every job has a display name.
   `ci.yml` and `pr-screenshots.yml` keep their file names, which are already clear and widely cited.
2. **Tiers.** CI's `changes` job skips the browser suites on docs-only PRs and the web suites on
   backend-only PRs. Pushes, dispatches and scheduled runs always run everything. Previews and
   CodeQL on PRs use path filters; neither is a required check.
3. **One required check.** The `CI result` job needs every CI job and fails if any failed or was
   cancelled. Branch rules require it and the PR title check. Auto-merge also requires it.
4. **Verdict per merged commit.** Only PR runs cancel in progress.
5. **Release gate.** Promote to production requires green CI and green Security: CodeQL on
   develop's head (plus the development smoke test, unchanged) and tags each promotion
   `prod-<UTC time>`.
6. **Added checks.** Dependency review on PRs (high advisories, GPL/AGPL), actionlint with
   shellcheck at warning level, Playwright browser cache, shared setup actions, `claude-code-action`
   pinned to a commit. CodeQL uses the security-extended queries.
7. **Less noise.** The PR fixer's label trigger only starts a runner for `agent:fix-needed`; the
   merged-branch sweep is daily (auto-merge deletes its own branches).

Unchanged on purpose: the PR fixer's no-progress safeguard, the PR reviewer's no-round-limit rule,
auto-merge's skip rules and one merge per run, the promotion gate's development check, and the
three health runs a day (owner decision, PR #230).

## Consequences

- The Actions sidebar groups by area and says what each run does. Old run history stays under the
  old workflow names; renamed workflows start a new history. The PR fixer's no-progress check reads
  `ci.yml`, which kept its name, so its history carries on.
- Anything that dispatches a workflow by file name uses the new names, in particular
  `release-promote-to-production.yml` and `deploy-web-hosting.yml` (the `release` skill and runbooks
  are updated). ADRs before this one keep the old names as history.
- A docs-only PR finishes in a few minutes instead of half an hour; develop still runs every suite
  before anything deploys.
- Branch rulesets are an owner step (`docs/ci-cd.md#branch-rules`); until then the gates are the
  CI result check, auto-merge's rules and the promotion gate.
- The pinned agent action no longer updates by itself; Dependabot's weekly github-actions PR moves
  it, and the owner merges it (it changes `.github/`).
