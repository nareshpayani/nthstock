# Release to production

How a change reaches the live site (https://nthstock-a13a5.web.app) under ADR 0011 (which amends
ADR 0010). `develop` is the development environment; `production` is the live site. A release
moves the `production` branch to develop's latest commit through the **Promote to production**
workflow. There is no release PR and no approval step: the owner asks in the project chat ("deploy
to production"), an agent runs the promotion, and the promotion's gate is the check. The agent's
procedure is the `release` skill (`.claude/skills/release/SKILL.md`).

Production today is the msw-mode web build on Firebase Hosting (`docs/runbooks/web-hosting.md`).
The API, realtime server and databases are not hosted until the scalability phase. Environments:
[environments.md](environments.md).

## The flow

| # | Who | Step | Stops if |
|---|---|---|---|
| 1 | Agent | Build the change on a branch off `develop` with tests (unit, E2E, axe where it is UI); `npm run check` and `npm run e2e` locally. | anything is red |
| 2 | CI | On the PR into `develop`: lint, typecheck, tests, build, E2E (msw and api mode), Web Vitals, audit, secret scan, dependency review, workflow lint and CodeQL (suites a PR cannot affect are skipped, `docs/ci-cd.md`), gated by **CI result**, and for app changes a **preview channel** smoke-tested as a reviewer (demo login, a paper buy, the guide, axe). | any check is red: the agent fixes it, never skips a test |
| 3 | Agent / CI | Auto-merge squash-merges the PR into `develop` once the Reviewer has passed it (PRs touching `.github/`, `.claude/` or `CLAUDE.md` are merged by the owner). | Reviewer blocks: the Fixer runs, back to 2 |
| 4 | CI | CI runs on `develop`; when green, Deploy: Web hosting deploys it to the **development** environment and smoke-tests it there. | red: the Fixer opens a fix PR into `develop`; nothing ships |
| 5 | Owner | Asks for a production deploy. | |
| 6 | Agent | Runs **Actions → Release: Promote to production**. It checks develop's latest commit has green CI (every test and E2E suite) and a green Security: CodeQL run, and is the commit the development site last deployed and smoke-tested, then moves `production` to it and tags it `prod-<UTC time>`. | any gate fails: nothing moves; the agent says why |
| 7 | CI | CI runs on `production`; when green, Deploy: Web hosting deploys that commit to the **live site**, checks it serves the new build with its security headers, and runs the reviewer smoke test against it. | any step fails: the agent rolls back (below) |
| 8 | Agent | Reports to the owner: live link, commit, checks that ran. | |

## Rules

- `production` only moves through Promote to production, and only to a commit on `develop` that
  passed CI and the development smoke test. It fast-forwards, or gets one merge commit whose files
  are exactly develop's; never a force push.
- Every PR targets `develop`; nothing opens a PR into `production`, and auto-merge only merges into
  `develop`.
- Agents never push to `develop` or `production` themselves, never skip or weaken a check, and never
  merge by hand. A dispatched live deploy only accepts commits on `production` with green CI.
- The promotion pushes with the `PROMOTE_TOKEN` secret so the push starts CI and may carry workflow
  changes ([environments.md](environments.md) has the setup).
- The `production` GitHub environment records every live deploy (Settings → Environments). The
  owner can add themselves as a required reviewer there if they ever want a click before a deploy.

## Rolling back

Run **Deploy: Web hosting** with stage `live` and the last good commit on `production` (the promotion's
summary names the previous one; also Settings → Environments → production, or
`git log --first-parent origin/production`). It passes the same gates and smoke test. Or,
instantly, Firebase console → Hosting → release history → **Rollback**. Then fix forward through
`develop` and promote again.

## Checking a release

- Actions → Promote to production → the run's summary gives the old and new production commits.
- Actions → Deploy: Web hosting → the live run's summary gives the URL and commit.
- Settings → Environments → production lists every live deploy.
- The deployed smoke test: `E2E_BASE_URL=https://nthstock-a13a5.web.app npm run e2e:deployed -w
  @nthstock/web`.
