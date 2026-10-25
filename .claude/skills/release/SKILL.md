---
name: release
description: Take what is on develop all the way to nthstock's live site (Firebase Hosting) by running the Promote to production workflow, with every check and a smoke-tested live deploy. Use when the owner asks to deploy, release, ship or "move to production".
---

# Release to production

`develop` is the development environment; `production` is the live site (ADR 0010, 0011). A
release moves the `production` branch to develop's latest commit with the **Promote to production**
workflow. The owner asks; you do every step; there is no release PR and no approval to wait for.
Full flow and rules: `docs/runbooks/release.md`. Never skip a check, never merge by hand, never
push to `develop` or `production` yourself.

## 1. Get the change onto develop
1. Not on `develop` yet: build it the normal way. Branch off `develop` (`feat|fix|chore/…`), tests
   included (UI: unit tests, an E2E in `apps/web/e2e/`, axe on the new screen), `run-checks` skill,
   PR into `develop`. Auto-merge merges it when the Reviewer passes it and checks are green
   (`.github/`, `.claude/` or `CLAUDE.md` changes wait for the owner's merge: tell the owner).
2. Wait for **CI** on the `develop` head commit to finish green, then for **Deploy: Web hosting / Deploy the
   development environment** on it, which deploys that commit to the development site and
   smoke-tests it. Red: the Fixer opens a fix PR into `develop`; the release waits for it.

## 2. Promote
3. Dispatch **Release: Promote to production** (`release-promote-to-production.yml`, on `develop`; no inputs):
   `gh workflow run release-promote-to-production.yml --ref develop`, or the GitHub MCP
   `actions_run_trigger` with `run_workflow`.
4. It refuses unless develop's head has green CI and a green **Security: CodeQL** run and is what the
   development site last deployed and smoke-tested. A refusal means nothing moved: read its error, wait or fix through `develop`, then
   run it again. Note the previous production commit and the
   `prod-*` release tag from its summary.

## 3. Live
5. The move starts CI on `production`; when it is green, **Deploy: Web hosting / Deploy the live site**
   deploys that commit, checks the site serves the new build, and runs the reviewer smoke test on
   the live site. Watch both runs.
6. Failed after the deploy step: roll back at once by dispatching **Deploy: Web hosting** with `stage=live`
   and `ref=<previous production commit>`, then tell the owner what failed. CI red on `production`
   means nothing was deployed: fix on `develop` and promote again.
7. Green: tell the owner it is live, with https://nthstock-a13a5.web.app/dashboard?demo=1 (demo
   login 9000000001, OTP 123456), the commit and the checks.

Redeploying production without a change (for example after a Firebase incident): dispatch
**Deploy: Web hosting** with `stage=live` and `ref=production`.
