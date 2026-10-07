# Git, PRs and issues

- Branch from `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…` (agents: `claude/issue-<n>-<slug>`).
- Issues are keyed: `NSTOCK-0001 : create login flow` (one sequence for epics, stories and bugs).
  Create them with `bash tools/github/issueKey.sh create` (agents) or the issue templates (people);
  `issue-keys.yml` keys template issues. A story always names its epic and becomes its sub-issue.
- PR titles and commits are Conventional Commits with the issue key as the scope:
  `feat(NSTOCK-0001): create login flow`, `fix(NSTOCK-0042): …`. The `PR title` check enforces it
  (Dependabot exempt). Squash merge makes the PR title the commit on `main`. One logical change per PR.
- Never push to `main`, force-push a shared branch, or skip checks (`--no-verify`). A Claude hook
  blocks these.
- Before opening a PR: `npm run check` passes (see the `run-checks` skill).
- PR body follows `.github/pull_request_template.md`: before/after, how it was tested, screenshots for
  UI, and one `Closes #N` line per issue the PR completes (`Refs #N` for issues it only touches).
- Spec PRs (`docs/specs/`) and PRs touching `.github/`, `.claude/` or `CLAUDE.md` wait for the owner;
  other green PRs labelled `ready-to-merge` auto-merge (ADR 0006).
- Never commit secrets, `.env` files or real user data (the repo is public, D9).
