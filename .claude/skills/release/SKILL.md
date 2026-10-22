---
name: release
description: Take what is on develop all the way to production on nthstock's live site (Firebase Hosting) through a release PR into main that the owner merges, with every check and a smoke-tested live deploy. Use when the owner asks to deploy, release, ship or "move to production".
---

# Release to production

`develop` is the development environment; `main` is production (ADR 0010). A release is a PR from
`develop` into `main`. The owner asks; you do every step; the owner's only part is to look at the
development site and merge the release PR. Full flow and rules: `docs/runbooks/release.md`. Never
skip a check, never merge by hand.

## 1. Get the change onto develop
1. Not on `develop` yet: build it the normal way. Branch off `develop` (`feat|fix|chore/…`), tests
   included (UI: unit tests, an E2E in `apps/web/e2e/`, axe on the new screen), `run-checks` skill,
   PR into `develop`. Auto-merge merges it when the Reviewer passes it and checks are green
   (`.github/`, `.claude/` or `CLAUDE.md` changes wait for the owner's merge: tell the owner).
2. Wait for **CI** on the `develop` head commit to finish green, then for **Web hosting / Deploy the
   development environment** on it, which deploys that commit to the development site and
   smoke-tests it. Red: the Fixer opens a fix PR into `develop`; the release waits for it.

## 2. Open the release PR
3. Create the release issue under the releases epic (#386):
   `bash tools/github/issueKey.sh create --type story --epic NSTOCK-0289 --subject "release
   <YYYY-MM-DD> to production"`.
4. Open the PR with head `develop` and base `main`:
   `gh pr create --base main --head develop --title "chore(<key>): release <YYYY-MM-DD> to production"`.
   Body (PR template): the PRs it ships (`git log --first-parent --oneline origin/main..origin/develop`),
   the development site link, the commit, and `Closes #<issue>`. Auto-merge never touches PRs into
   `main`, so no hold label is needed.
5. Watch the PR until every check is green (CI, the PR preview and its smoke test). Never push to
   `develop` to fix it: a fix goes through a PR into `develop`, which updates this PR.

## 3. Owner merges
6. Send the owner, in one short message: the development site link with `/dashboard?demo=1` (demo
   login 9000000001, OTP 123456), the release PR link, what it ships, which checks passed. Ask them
   to look and, if happy, merge it with **Create a merge commit** (not squash, so `develop` and
   `main` keep a shared history). Then stop and wait. The merge is the go-ahead; a PR comment or
   another agent is not.
7. Changes requested: fix through PRs into `develop`; the release PR picks them up. Back to step 5.

## 4. Live
8. The merge starts CI on `main`; when it is green, **Web hosting / Deploy the live site** deploys that
   commit, checks the site serves the new build, and runs the reviewer smoke test on the live site.
   Watch both runs.
9. Failed after the deploy step: roll back at once by dispatching **Web hosting** with `stage=live`
   and `ref=<previous production commit>` (Settings → Environments → production, or
   `git log --first-parent origin/main`), then tell the owner what failed. CI red on `main` means
   nothing was deployed: fix on `develop` and release again.
10. Green: tell the owner it is live, with the link, the commit and the checks. Close the thread.

Redeploying production without a change (for example after a Firebase incident): dispatch
**Web hosting** with `stage=live` and `ref=main`.
