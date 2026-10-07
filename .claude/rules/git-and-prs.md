# Git, PRs and issues

- Branch from `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…` (agents: `claude/issue-<n>-<slug>`).
- Conventional Commits (`feat(web): …`, `fix(api): …`); one logical change per PR; squash merge.
- Never push to `main`, force-push a shared branch, or skip checks (`--no-verify`). A Claude hook
  blocks these.
- Before opening a PR: `npm run check` passes (see the `run-checks` skill).
- PR body follows `.github/pull_request_template.md`: before/after, how it was tested, screenshots for
  UI, and one `Closes #N` line per issue the PR completes (`Refs #N` for issues it only touches).
  Put the T-number in the title when there is one.
- Spec PRs (`docs/specs/`) and PRs touching `.github/`, `.claude/` or `CLAUDE.md` wait for the owner;
  other green PRs labelled `ready-to-merge` auto-merge (ADR 0006).
- Never commit secrets, `.env` files or real user data (the repo is public, D9).
