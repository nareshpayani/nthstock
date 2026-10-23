# Web hosting (free reviewer link)

The web app in msw mode needs no backend: MSW, the mock market and the paper engine all run in the
browser. So the static build is a full working demo, hosted free on **Firebase Hosting** (Spark
plan, no card). `.github/workflows/web-hosting.yml` deploys it:

- **Development environment**, the long-lived `dev` channel: every green CI run on `develop`
  deploys there, so merged work is always on a shared link that is not the live site
  ([environments.md](environments.md)).
- **Production environment**, the live site `https://<project id>.web.app`: every green CI run on
  `production`, which only moves when an agent runs Promote to production
  ([release.md](release.md), ADR 0011).
- **PR previews**: a channel per PR from this repo, its URL commented on the PR, smoke-tested as a
  reviewer would use it (`npm run e2e:deployed`). A channel is deleted when its PR closes, or after
  7 days. The site's channel quota is small, so each preview deploy first deletes the channels of
  closed PRs ([`sweepPreviewChannels.sh`](../../tools/github/sweepPreviewChannels.sh)); if a
  preview still fails with "channel quota reached", too many PRs are open at once.

`firebase.json` sets the SPA rewrite, the same security headers as `vite preview`
(`securityHeaders.test.ts` keeps them in step), and caching (hashed `/assets` for a year,
everything else revalidated). The build ticks the mock market at any hour (`VITE_MOCK_MARKET_OPEN`).

The API, realtime server, Postgres and Redis are not hosted: Firebase runs servers only on the paid
Blaze plan. That waits for the scalability phase (AWS Mumbai).

## One-time setup (owner)

1. In the [Firebase console](https://console.firebase.google.com), **Create a project** (any
   name; Google Analytics off). Note its **project ID**, for example `nthstock-demo`.
2. In the project, **Build → Hosting → Get started**, and click through (no CLI steps needed).
3. **Project settings → Service accounts → Generate new private key**. A JSON file downloads.
4. In GitHub, **Settings → Secrets and variables → Actions**:
   - **Secrets** tab: new secret `FIREBASE_SERVICE_ACCOUNT`, value = the whole JSON file.
   - **Variables** tab: new variable `FIREBASE_PROJECT_ID`, value = the project ID.

   Then delete the downloaded JSON file.

5. Run **Actions → Web hosting → Run workflow** with stage `live` and ref `production` (CI must be green
   on that commit). Later releases follow [release.md](release.md). The development environment
   fills itself on the next green CI run on `develop`.

Until both values are set, the Web hosting jobs are skipped, not failed.

## Sharing with a reviewer

Send `https://<project id>.web.app/dashboard?demo=1`. The reviewer logs in with mobile
**9000000001** and OTP **123456**, then "Skip for now" on the PIN step (see
[local-demo.md](local-demo.md) for what the demo account holds). Use Chrome: the app needs a
service worker. Each browser tab keeps its own state; `?demo=1` resets it.

## Taking it down

Firebase console → Hosting → **Disable** the site, or delete the project. To stop deploys, delete
the `FIREBASE_PROJECT_ID` variable.
