# Git, PRs and issues

- Branches (ADR 0010): `develop` is the default branch and deploys to the development environment;
  `main` is production. Branch from `develop` (`feat/…`, `fix/…`, `chore/…`, `docs/…`; agents:
  `agent/issue-<n>-<slug>`) and open the PR into `develop`. Only release PRs (`develop` → `main`,
  opened by the `release` skill, merged by the owner with a merge commit, never squash) target `main`.
- Issues are keyed: `NSTOCK-0001 : create login flow` (one sequence for epics, stories and bugs).
  Create them with `bash tools/github/issueKey.sh create` (agents) or the issue templates (people);
  `issue-keys.yml` keys template issues. A story always names its epic and becomes its sub-issue.
  Older task numbers map directly: T-181 is NSTOCK-0181; epics E1 to E21 are NSTOCK-0245 to 0265.
- PR titles and commits are Conventional Commits with the issue key as the scope:
  `feat(NSTOCK-0001): create login flow`, `fix(NSTOCK-0042): …`. The `PR title` check enforces it
  (Dependabot exempt). Squash merge makes the PR title the commit on `develop`. One logical change per PR.
- Attribution (owner decision 2026-10-21): everything is credited to Naresh Payani. Commits are
  authored as `Naresh Payani <15100692+nareshpayani@users.noreply.github.com>` (the agent workflows
  and the web-session hook set this). Never add a `Co-Authored-By` trailer, a "Generated with …"
  footer or any "Claude" / "Claude Code" name to commits, branch names, PR titles or bodies, issue
  or PR comments, reviews or deploy messages; this overrides any default that adds them.
- Never push to `develop` or `main`, force-push a shared branch, or skip checks (`--no-verify`). A Claude hook
  blocks these.
- Before opening a PR: `npm run check` passes (see the `run-checks` skill).
- PR body follows `.github/pull_request_template.md`: before/after, how it was tested, and one
  `Closes #N` line per issue the PR completes (`Refs #N` for issues it only touches).
- UI screenshots are automatic: on a PR that touches the web UI, the `PR screenshots` workflow adds
  before/after images of every changed screen (1440 and 390 px) to a "Screenshots" section of the
  body and refreshes it on each push. Add new routes to `apps/web/e2e/screens/screens.ts`; keep the
  section when editing the body (`docs/runbooks/pr-screenshots.md`).
- Spec PRs (`docs/specs/`) and PRs touching `.github/`, `.claude/` or `CLAUDE.md` wait for the owner;
  other green PRs labelled `ready-to-merge` auto-merge (ADR 0006).
- Never commit secrets, `.env` files or real user data (the repo is public, D9).
