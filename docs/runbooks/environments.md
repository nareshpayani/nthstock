# Environments: development and production

The hosted web app (the msw-mode build on Firebase Hosting, [web-hosting.md](web-hosting.md)) runs
in two GitHub environments. Both are deployed by `.github/workflows/web-hosting.yml` and listed under
**Settings → Environments**, each with its deploy history and current URL.

| | development (default) | production |
|---|---|---|
| What | Everything merged to `main` | What the owner approved for release |
| URL | The Firebase `dev` channel, `https://nthstock-a13a5--dev-<hash>.web.app` (the environment page and each run summary show it) | https://nthstock-a13a5.web.app |
| Deploys | Automatically after every green CI run on `main` (merges and the scheduled health checks), or Run workflow with stage `development` | Only a release: Run workflow with stage `live`, after the owner's OK on a preview ([release.md](release.md), ADR 0009) |
| Gates | CI green on the commit; a dispatch also checks the commit is on `main` | On `main`, CI green, owner's OK |
| After deploy | Site check (new build, security headers) and the reviewer smoke test | The same, plus rollback on failure |
| Expires | 30 days after the last deploy; the daily CI run on `main` keeps renewing it | Never |

PR previews (7 days, one per PR) and release candidates (the `release` channel) are not
environments: they are short-lived previews of one change or one release.

Both environments use the same Firebase project and the repository-level `FIREBASE_PROJECT_ID`
variable and `FIREBASE_SERVICE_ACCOUNT` secret, because PR previews need them too. There is no
separate database or API per environment yet; the msw-mode app keeps its state in the browser.
When the API is hosted (scalability phase), each environment gets its own variables and secrets.

## Opening the development site

Settings → Environments → **development** → the deployment URL, or the latest **Web hosting** run
on `main` (its summary has the link). Add `/dashboard?demo=1`; demo login 9000000001, OTP 123456.

## Owner settings (optional, in GitHub)

Settings → Environments → **production**:

- **Deployment branches and tags → Selected branches → `main`**. A live deploy can then only be
  started from the workflow on `main`, never from a branch's copy of it.
- **Required reviewers → yourself**, if you also want a click in GitHub before each live deploy (on
  top of your OK in chat).

The `development` environment needs no protection rules.

## Moving to a fixed development URL

The `dev` channel's address has a random suffix, and changes only if the channel lapses (30 days
with no green CI on `main`). For a fixed address such as `nthstock-dev.web.app`, create a second
site in the Firebase console (Hosting → Add another site, free on Spark), set a `FIREBASE_SITE`
variable on the development environment, and change the development job to deploy to that site's
live channel.
