# Release to production

How a change reaches the live site (https://nthstock-a13a5.web.app) under ADR 0009. The owner asks
in the project chat ("deploy X to production"); the agents do every step below; the owner's only
part is to open the preview link and say OK. The agent's procedure is the `release` skill
(`.claude/skills/release/SKILL.md`).

Production today is the msw-mode web build on Firebase Hosting (`docs/runbooks/web-hosting.md`).
It is the `production` GitHub environment; merged work lands first in the `development` environment
(`docs/runbooks/environments.md`), which every green CI run on `main` updates on its own.
The API, realtime server and databases are not hosted until the scalability phase.

## The flow

| # | Who | Step | Stops if |
|---|---|---|---|
| 1 | Agent | Build the change on a branch with tests (unit, E2E, axe where it is UI). | |
| 2 | Agent | `npm run check` and `npm run e2e` locally. | anything is red |
| 3 | Agent | Open the PR with **`do-not-merge`**, so auto-merge holds it whatever the Reviewer says. | |
| 4 | CI | Lint, typecheck, tests, build, E2E (msw and api mode), Web Vitals, audit, secret scan, CodeQL. | any check is red: the agent fixes it, never skips a test |
| 5 | CI | Web hosting deploys the PR's **preview channel**, then logs in as the demo user, places a paper buy, opens the guide and runs axe on it (`npm run e2e:deployed`). | the preview smoke test fails |
| 6 | Agent | Browser QA on the preview (the `browser-qa` skill) when it can reach it, and sends the owner the preview link with what changed and what was checked. | |
| 7 | **Owner** | Opens the preview, replies OK (or asks for changes: back to 1). | no OK: nothing ships |
| 8 | Agent | Removes `do-not-merge`. Auto-merge squash-merges once the Reviewer has passed it and every check is green. PRs touching `.github/`, `.claude/` or `CLAUDE.md` are merged by the owner. | Reviewer blocks: the Fixer runs, back to 4 |
| 9 | CI | CI runs on `main` again with the merged code; when green, Web hosting deploys it to the **development** environment and smoke-tests it there. | red: the Fixer opens a fix PR; nothing ships |
| 10 | Agent | Runs **Actions → Web hosting → Run workflow**, stage `live`, ref = the merge commit. | |
| 11 | CI | The live job refuses a commit that is not on `main` or has no green CI run, builds, deploys to `live`, checks the site serves the new build with its security headers, and runs the reviewer smoke test against the live site. | any step fails: the agent rolls back (below) |
| 12 | Agent | Reports to the owner: live link, commit, checks that ran. Closes the thread. | |

Several merged PRs can go out in one release: step 10 with the newest commit on `main`. When the
owner wants to see a batch before it goes live, step 10 first runs with stage `candidate`: the same
gates, deployed to the `release` preview channel (7 days), and the owner's OK on that link is step 7.

## Rules

- Nothing goes live without the owner's OK on a preview of exactly what will ship (the PR preview
  when the release is one PR on top of the current live commit, otherwise a candidate).
- Agents never deploy from a branch, never skip or weaken a check, never push to `main`, and never
  merge by hand. The live job only accepts commits on `main` with green CI.
- Merging to `main` deploys only to the development environment. The live site changes only
  through step 10. Setting the repo
  variable `LIVE_DEPLOY=auto` brings back the old behaviour (every green CI on `main` goes live).
- The `production` GitHub environment records every live deploy (Settings → Environments). The
  owner can add themselves as a required reviewer there; the live job then also waits for a click in
  GitHub.

## Rolling back

Run **Web hosting** with stage `live` and the last good commit (the previous production deploy in
Settings → Environments → production). It passes the same gates and smoke test. Or, instantly,
Firebase console → Hosting → release history → **Rollback**. Then fix forward through the flow.

## Checking a release

- Actions → Web hosting → the run's summary gives the URL and commit.
- Settings → Environments → production lists every live deploy.
- The deployed smoke test: `E2E_BASE_URL=https://nthstock-a13a5.web.app npm run e2e:deployed -w
  @nthstock/web`.
