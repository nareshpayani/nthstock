# Before/after screenshots on UI pull requests

Every pull request that changes the web UI gets a **Screenshots** section in its body with the
screens it changed, before (the base branch) and after (the PR), at desktop (1440 px) and mobile
(390 px) width. Agents and people get it the same way; nobody has to take screenshots by hand
(NSTOCK-0285, owner request 2026-10-21).

## How it works

`.github/workflows/pr-screenshots.yml` runs on PRs that touch `apps/web/src`, `apps/web/public`,
`packages/ui/src` or `packages/tokens` (and on changes to the tool itself):

1. **Capture** (read-only token): builds the PR head and the base commit in msw mode with the
   market closed, serves both, and runs `apps/web/e2e/screens/capture.screens.ts`. Each screen in
   `apps/web/e2e/screens/screens.ts` is loaded on both builds with the page clock frozen at the same
   instant (Saturday 26 Sep 2026, 10:30 IST), seeded randomness and the demo user's data, so the
   two sides only differ where the PR changed the UI. Pixels are compared in the browser; a screen
   counts as changed above 0.05 % differing pixels.
2. **Publish** (write token, runs no PR-installed code): `tools/github/prScreenshots.mjs` commits the
   changed screens' images to the **`ci/pr-screenshots`** branch under `pr-<number>/<sha>/` and
   writes the section between the `<!-- pr-screenshots:start -->` and `<!-- pr-screenshots:end -->`
   markers in the PR body (appended at the end the first time). Unchanged screens are listed by
   name; a screen that could not load is reported with the error.

Each push replaces the section. The images are linked by commit, so older ones keep working after
the PR's next push.

It is informational: not a required check, it never blocks a merge. Fork PRs are skipped (no write
token).

## Adding a screen

Add a line to `SCREENS` in `apps/web/e2e/screens/screens.ts` (camelCase `name`, the `path`, and
`authed: true` for routes under `_authed`; those open as the demo user with `?demo=1` data). Do it
in the same PR that adds the route.

## Running it locally

```sh
cd apps/web
VITE_API_MODE=msw npx vite build --outDir dist-screens
npx vite preview --outDir dist-screens --port 4302 &
AFTER_URL=http://127.0.0.1:4302 npx playwright test -c e2e/screens/playwright.screens.config.ts
```

Add `BEFORE_URL` (another build on another port) to compare. Output lands in `screens-out/`.

## The `ci/pr-screenshots` branch

It holds images only and is written only by the workflow. Keep it when deleting old branches.
It grows by a few hundred KB per UI push; if it ever gets large, the owner can delete it (the
workflow recreates it on the next run). Screenshots in PRs from before the deletion then stop
loading.
