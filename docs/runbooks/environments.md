# Branches and environments: develop and main

`develop` is the default branch and the **development** environment; `main` is the **production**
environment (ADR 0010). Every PR targets `develop`. Production only moves when the owner merges a
release PR from `develop` into `main` ([release.md](release.md)).

```
feature branch ──PR──► develop ──green CI──► development (dev channel)
                          │
                          └──release PR, owner merges──► main ──green CI──► production (live site)
```

Both environments are deployed by `.github/workflows/web-hosting.yml` and listed under
**Settings → Environments**, each with its deploy history and current URL.

| | development (default) | production |
|---|---|---|
| Branch | `develop` | `main` |
| URL | The Firebase `dev` channel, `https://nthstock-a13a5--dev-<hash>.web.app` (the environment page and each run summary show it) | https://nthstock-a13a5.web.app |
| Deploys | Automatically after every green CI run on `develop` (merges and the scheduled health checks), or Run workflow with stage `development` | Automatically after a green CI run on `main`, which only happens when the owner merges a release PR; Run workflow with stage `live` redeploys or rolls back |
| Gates | CI green on the commit; a dispatch also checks the commit is on `develop` | Owner's merge, CI green; a dispatch also checks the commit is on `main` |
| After deploy | Site check (new build, security headers) and the reviewer smoke test | The same; a failure is rolled back |
| Expires | 30 days after the last deploy; the daily CI run on `develop` keeps renewing it | Never |

PR previews (7 days, one per PR) are not environments: they are short-lived previews of one change.

Both environments use the same Firebase project and the repository-level `FIREBASE_PROJECT_ID`
variable and `FIREBASE_SERVICE_ACCOUNT` secret, because PR previews need them too. There is no
separate database or API per environment yet; the msw-mode app keeps its state in the browser.
When the API is hosted (scalability phase), each environment gets its own variables and secrets.

## Opening the development site

Settings → Environments → **development** → the deployment URL, or the latest **Web hosting** run
on `develop` (its summary has the link). Add `/dashboard?demo=1`; demo login 9000000001, OTP 123456.

## One-time owner setup (GitHub settings)

Agents can't change repository settings, so these are the owner's:

1. **Settings → General → Default branch** → switch to `develop`. New PRs, Dependabot, the scheduled
   health checks and "Closes #N" auto-closing then use `develop`.
2. **Settings → General → Pull Requests**: keep **Allow merge commits** on (release PRs use it) and
   **Allow squash merging** on (everything else).
3. **Settings → Rules → Rulesets** (or Branches): protect `develop` and `main` with **Require a pull
   request before merging** (no required approvals, or auto-merge stops), **Block force pushes** and
   **Restrict deletions**. Optionally, on `main`, **Require status checks to pass** with the CI jobs.
4. Leave **Deployment branches** on both environments at "No restriction". The automatic deploys
   start from a finished CI run, and GitHub runs those in the context of the default branch
   (`develop`) even when they deploy `main`, so restricting production to `main` would block every
   release. The deploy job checks the branch itself. Optionally, **Settings → Environments →
   production → Required reviewers → yourself** adds a click in GitHub before each live deploy.

## Moving to a fixed development URL

The `dev` channel's address has a random suffix, and changes only if the channel lapses (30 days
with no green CI on `develop`). For a fixed address such as `nthstock-dev.web.app`, create a second
site in the Firebase console (Hosting → Add another site, free on Spark), set a `FIREBASE_SITE`
variable on the development environment, and change the development job to deploy to that site's
live channel.
