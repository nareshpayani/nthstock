# Release to production

How a change reaches the live site (https://nthstock-a13a5.web.app) under ADR 0010 (which amends
ADR 0009). `develop` is the development environment; `main` is production; a release is a PR from
`develop` into `main`. The owner asks in the project chat ("deploy X to production"); the agents do
every step below; the owner's part is to look at the development site and merge the release PR.
The agent's procedure is the `release` skill (`.claude/skills/release/SKILL.md`).

Production today is the msw-mode web build on Firebase Hosting (`docs/runbooks/web-hosting.md`).
The API, realtime server and databases are not hosted until the scalability phase. Environments:
[environments.md](environments.md).

## The flow

| # | Who | Step | Stops if |
|---|---|---|---|
| 1 | Agent | Build the change on a branch off `develop` with tests (unit, E2E, axe where it is UI); `npm run check` and `npm run e2e` locally. | anything is red |
| 2 | CI | On the PR into `develop`: lint, typecheck, tests, build, E2E (msw and api mode), Web Vitals, audit, secret scan, CodeQL, and a **preview channel** smoke-tested as a reviewer (demo login, a paper buy, the guide, axe). | any check is red: the agent fixes it, never skips a test |
| 3 | Agent / CI | Auto-merge squash-merges the PR into `develop` once the Reviewer has passed it (PRs touching `.github/`, `.claude/` or `CLAUDE.md` are merged by the owner). | Reviewer blocks: the Fixer runs, back to 2 |
| 4 | CI | CI runs on `develop`; when green, Web hosting deploys it to the **development** environment and smoke-tests it there. | red: the Fixer opens a fix PR into `develop`; nothing ships |
| 5 | Agent | Opens the **release PR** `develop` → `main` (title `chore(NSTOCK-NNNN): release <date> to production`, listing what it ships) and waits for its checks. | any check is red |
| 6 | Agent | Sends the owner the development site link, the release PR, what it ships and which checks passed. | |
| 7 | **Owner** | Opens the development site; if happy, merges the release PR with **Create a merge commit**. Changes wanted: say so, fixes go through PRs into `develop`, back to 4. | no merge: nothing ships |
| 8 | CI | CI runs on `main`; when green, Web hosting deploys that commit to **production**, checks the site serves the new build with its security headers, and runs the reviewer smoke test against the live site. | any step fails: the agent rolls back (below) |
| 9 | Agent | Reports to the owner: live link, commit, checks that ran. Closes the thread. | |

## Rules

- Nothing goes live without the owner having merged a release PR; the development site shows
  exactly what it ships.
- PRs target `develop`. Only release PRs (head `develop`) target `main`, and auto-merge never
  merges into `main`.
- Release PRs are merged with a merge commit, never squashed, so the next release PR only carries
  what is new on `develop`.
- Agents never push to `develop` or `main`, never skip or weaken a check, and never merge by hand.
  A dispatched live deploy only accepts commits on `main` with green CI.
- The `production` GitHub environment records every live deploy (Settings → Environments). The
  owner can add themselves as a required reviewer there; the live job then also waits for a click in
  GitHub.

## Rolling back

Run **Web hosting** with stage `live` and the last good commit on `main` (the previous production
deploy in Settings → Environments → production, or `git log --first-parent origin/main`). It passes
the same gates and smoke test. Or, instantly, Firebase console → Hosting → release history →
**Rollback**. Then fix forward through `develop` and a new release.

## Checking a release

- Actions → Web hosting → the run's summary gives the URL and commit.
- Settings → Environments → production lists every live deploy.
- The deployed smoke test: `E2E_BASE_URL=https://nthstock-a13a5.web.app npm run e2e:deployed -w
  @nthstock/web`.
