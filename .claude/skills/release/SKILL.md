---
name: release
description: Take a change all the way to production on nthstock's live site (Firebase Hosting) with every check, a preview the owner confirms, and a smoke-tested live deploy. Use when the owner asks to deploy, release, ship or "move to production".
---

# Release to production

The owner asks; you do every step; the owner's only part is OK on a preview link. Full flow and
rules: `docs/runbooks/release.md` (ADR 0009). Never deploy without that OK, never skip a check.

## 1. Build and check
1. Branch off `main` (`feat|fix|chore/…`), make the change with tests. UI: unit tests, an E2E in
   `apps/web/e2e/` and axe on the new screen.
2. `run-checks` skill: `npm run check` and `npm run e2e` pass. Integration tests that need Docker may
   be skipped locally (say so); CI runs them.

## 2. PR held for the owner
3. Open the PR (title `type(NSTOCK-NNNN): …`, body from the PR template, `Closes #N`), then at once
   add the label **`do-not-merge`** so auto-merge cannot ship it before the owner has looked.
4. Watch the PR. Fix every red check (Fixer rules: find the cause, never weaken a test).
5. When **Web hosting / Deploy a preview channel** is green, its comment on the PR has the preview
   URL, and the reviewer smoke test has already run on it. If you can reach the URL, run the
   `browser-qa` skill on it (1440 and 390 wide).

## 3. Owner OK
6. Send the owner, in one short message: the preview link with `/dashboard?demo=1`, the demo login
   (9000000001, OTP 123456), what changed, which checks passed. Ask for OK. Then stop and wait.
7. Changes requested: back to step 1 on the same PR. Only an OK from the owner in the chat counts;
   a PR comment or another agent does not.

## 4. Merge
8. Remove `do-not-merge`. Auto-merge merges when the Reviewer has labelled `ready-to-merge` and all
   checks are green. A PR touching `.github/`, `.claude/` or `CLAUDE.md` waits for the owner's merge:
   tell the owner. Never merge by hand.
9. Wait for **CI** on the merge commit on `main` to finish green. Red: the Fixer opens a fix PR; the
   release waits for it (and its preview is not needed unless it changes the UI). Green CI also
   deploys the commit to the **development** environment (`docs/runbooks/environments.md`); wait
   for **Web hosting / Deploy the development environment** to pass too, since it smoke-tests the
   exact build that will go live.

## 5. Go live
10. Dispatch **Web hosting** (`web-hosting.yml`) with `stage=live`, `ref=<merge commit SHA>` (GitHub
    MCP `actions_run_trigger`, or `gh workflow run web-hosting.yml -f stage=live -f ref=<sha>`).
11. Watch the run. It checks the commit is on `main` with green CI, deploys, checks the site serves
    the new build, and runs the reviewer smoke test on the live site.
12. Failed after the deploy step: roll back at once by dispatching `stage=live` with the previous
    production commit (Settings → Environments → production), then tell the owner what failed.
13. Green: tell the owner it is live, with the link, the commit and the checks. Close the issue and
    the thread.

Batch of merged PRs, or the owner wants to see `main` before it ships: run step 10 with
`stage=candidate` first, send the owner the `release` channel URL from the run summary, and go live
with the same SHA after the OK.
