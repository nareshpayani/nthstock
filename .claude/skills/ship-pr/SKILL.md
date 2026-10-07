---
name: ship-pr
description: Branch, commit and open an nthstock pull request the way the repo expects (branch names, Conventional Commits, PR template, Closes lines, protected paths). Use when work is ready to push.
---

# Ship a pull request

1. **Branch** off `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…` (agents on Actions use
   `claude/issue-<n>-<slug>`). Never push to `main`; never force-push without `--force-with-lease`.
2. **Check**: run the `quality-checks` skill. Push only when everything passes.
3. **Commit** with Conventional Commits: `feat(api): …`, `fix(web): …`, `chore(deps): …`. Put the
   story's T-number in the subject when there is one (`… (T-197)`).
4. **Open the PR** with `.github/pull_request_template.md`: a Before and After paragraph, how it was
   tested, and screenshots for UI changes.
5. **Link the issues**: one `Closes #<n>` line per story or bug the PR completes, `Refs #<n>` for one
   it only touches. `agent-close-issues.yml` closes them, and their epic, when the PR merges.
6. **Merging**: green non-spec PRs auto-merge once the Reviewer adds `ready-to-merge` (ADR 0006).
   The owner merges spec PRs and any PR touching `.github/`, `.claude/` or `CLAUDE.md`. Never merge by hand.
7. **Follow through**: fix red CI and review findings on the same PR until it is green.
