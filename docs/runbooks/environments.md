# Branches and environments: develop and production

`develop` is the default branch and the **development** environment; `production` is the branch and
environment of the live site (ADR 0010, 0011). Every PR targets `develop`. `production` only moves
when an agent runs **Promote to production**, which checks develop is fully tested first
([release.md](release.md)).

```
feature branch ──PR──► develop ──green CI──► development (dev channel)
                          │
                          └──Promote to production (CI green + dev smoke test)──► production ──green CI──► live site
```

Both environments are deployed by `.github/workflows/deploy-web-hosting.yml` and listed under
**Settings → Environments**, each with its deploy history and current URL.

| | development (default) | production |
|---|---|---|
| Branch | `develop` | `production` |
| URL | The Firebase `dev` channel, `https://nthstock-a13a5--dev-<hash>.web.app` (the environment page and each run summary show it) | https://nthstock-a13a5.web.app |
| Deploys | Automatically after every green CI run on `develop` (merges and the scheduled health checks), or Run workflow with stage `development` | Automatically after a green CI run on `production`, which only happens after a promotion; Run workflow with stage `live` redeploys or rolls back |
| Gates | CI green on the commit; a dispatch also checks the commit is on `develop` | Promotion: CI green on develop's commit and the development smoke test passed on it; then CI green again on `production`; a dispatch also checks the commit is on `production` |
| After deploy | Site check (new build, security headers) and the reviewer smoke test | The same; a failure is rolled back |
| Expires | 30 days after the last deploy; the daily CI run on `develop` keeps renewing it | Never |

PR previews (7 days, one per PR) are not environments: they are short-lived previews of one change.

Both environments use the same Firebase project and the repository-level `FIREBASE_PROJECT_ID`
variable and `FIREBASE_SERVICE_ACCOUNT` secret, because PR previews need them too. There is no
separate database or API per environment yet; the msw-mode app keeps its state in the browser.
When the API is hosted (scalability phase), each environment gets its own variables and secrets.

## Opening the development site

Settings → Environments → **development** → the deployment URL, or the latest **Deploy: Web hosting** run
on `develop` (its summary has the link). Add `/dashboard?demo=1`; demo login 9000000001, OTP 123456.

## One-time owner setup (GitHub settings)

Agents can't change repository settings, so these are the owner's:

1. **Default branch:** Settings → General → Default branch → `develop` (done 2026-10-21).
2. **Rename `main` to `production`:** Settings → Branches (or the Branches page, `…/branches`) →
   the pencil next to `main` → `production` → **Rename branch**. GitHub moves its rules and keeps
   redirects from the old name. Local clones then run
   `git branch -m main production && git fetch origin && git branch -u origin/production production && git remote set-head origin -a`.
3. **Promotion token:** create a fine-grained personal access token (GitHub → Settings → Developer
   settings → Fine-grained tokens → Generate new token), Repository access: only `nthstock`,
   Permissions: **Contents: Read and write** and **Workflows: Read and write**, expiry up to a year.
   Save it as the repository secret `PROMOTE_TOKEN` (Settings → Secrets and variables → Actions).
   Without it a promotion still works when no workflow file changed, but a release that changes
   `.github/workflows` is refused. Renew it before it expires.
4. **Protection (Settings → Rules → Rulesets):** on `develop`, **Require a pull request before
   merging** (no required approvals, or auto-merge stops), **Block force pushes**, **Restrict
   deletions**. On `production`, only **Block force pushes** and **Restrict deletions**: no "Require
   a pull request", because the promotion pushes to it directly (or add yourself, the token's owner,
   to the ruleset's bypass list).
5. **Pull requests:** Settings → General → Pull Requests: keep **Allow squash merging** on.
6. Leave **Deployment branches** on both environments at "No restriction". The automatic deploys
   start from a finished CI run, and GitHub runs those in the context of the default branch
   (`develop`) even when they deploy `production`, so restricting the environment to its branch
   would block every release. The deploy job checks the branch itself.

## Moving to a fixed development URL

The `dev` channel's address has a random suffix, and changes only if the channel lapses (30 days
with no green CI on `develop`). For a fixed address such as `nthstock-dev.web.app`, create a second
site in the Firebase console (Hosting → Add another site, free on Spark), set a `FIREBASE_SITE`
variable on the development environment, and change the development job to deploy to that site's
live channel.
