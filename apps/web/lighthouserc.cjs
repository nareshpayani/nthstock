// Lighthouse CI budgets (T-169, CLAUDE.md §3) for the dashboard and stock detail, run by the "Web
// vitals and render budgets (Chrome)" CI job and by `npm run lhci -w @nthstock/web`.
//
// @lhci/cli is not a devDependency: its dependency tree fails `npm audit --audit-level=high` with
// no fixed version, so it runs as a pinned `npx --yes @lhci/cli@0.15.1` (owner approved 2026-09-27).
//
// What it audits: the production msw-mode build (the mock market forced open, as in the E2E and
// perf jobs, but without the E2E test controls) in its own dist-lhci folder, served by `vite
// preview` with the strict CSP and security headers (T-173). Lighthouse drives the page over CDP,
// which CSP does not restrict, so the policy stays as shipped.
//
// Chrome: CHROME_PATH, else PW_CHROMIUM_PATH (the preinstalled Chromium in sandboxes, e.g.
// /opt/pw-browsers/chromium), else whatever chrome-launcher finds. CI points CHROME_PATH at the
// Chromium that `npx playwright install chromium` put in place.
//
// Reports go to the local filesystem only (lighthouse-report/): never temporary public storage,
// never an LHCI server.

const PORT = 4175;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;
const OUT_DIR = 'dist-lhci';
const chromePath = process.env.CHROME_PATH || process.env.PW_CHROMIUM_PATH || undefined;

// Every budget is checked against the median of the 3 runs per URL, not the best one.

/** An error-level `maxNumericValue` assertion. */
const below = (maxNumericValue) => ['error', { maxNumericValue, aggregationMethod: 'median-run' }];
/** An error-level `minScore` assertion. */
const atLeast = (minScore) => ['error', { minScore, aggregationMethod: 'median-run' }];

module.exports = {
  ci: {
    collect: {
      startServerCommand: `VITE_API_MODE=msw VITE_MOCK_MARKET_OPEN=true npx vite build --outDir ${OUT_DIR} --emptyOutDir --logLevel warn && npx vite preview --outDir ${OUT_DIR} --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
      startServerReadyPattern: 'Local',
      startServerReadyTimeout: 180_000,
      // `/` redirects to /dashboard on the client; both land on the dashboard.
      url: [`${ORIGIN}/`, `${ORIGIN}/stocks/INFY`],
      numberOfRuns: 3,
      ...(chromePath ? { chromePath } : {}),
      settings: {
        preset: 'desktop',
        // CI runners and containers have no user namespace sandbox for Chrome.
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': atLeast(0.9),
        'categories:accessibility': atLeast(0.9),
        'largest-contentful-paint': below(2_000),
        'cumulative-layout-shift': below(0.05),
        // TBT is the lab proxy for INP (< 150 ms).
        'total-blocking-time': below(150),
        // Initial JS < 200 KB gzipped: a warning here, enforced by scripts/checkBuild.mjs on every
        // build. Lighthouse sums every script fetched while the page settles, so in msw mode it
        // counts the lazy MSW + mock-market chunk (about 350 KB, never shipped in api mode) and
        // misses the chunks the MSW service worker passes through (0 bytes transferred).
        'resource-summary:script:size': [
          'warn',
          { maxNumericValue: 200 * 1024, aggregationMethod: 'median-run' },
        ],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: 'lighthouse-report',
    },
  },
};
