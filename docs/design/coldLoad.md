# Cold load on a phone (CR-T19)

Measured 2026-10-28 on production builds (`vite build`, msw mode, as deployed) served locally, in
headless Chromium at 390 × 844 (DPR 3, touch), with a fresh profile per run (no cache, no service
worker). Median of three runs. Script: Chrome DevTools Protocol network and CPU throttling plus
`PerformanceObserver` for LCP and CLS.

| Profile | Network | CPU |
|---|---|---|
| Slow 4G (Lighthouse mobile) | 1.6 Mbps down, 750 kbps up, 150 ms RTT | 4× slowdown |
| 4G | 9 Mbps down, 1.5 Mbps up, 85 ms RTT | 4× slowdown |

## Results

| Screen | Profile | LCP before | LCP after | CLS after |
|---|---|---|---|---|
| `/login` (first visit) | Slow 4G | 5.05 s | **3.19 s** | 0 |
| `/login` (first visit) | 4G | 2.05 s | **1.81 s** | 0 |
| `/stocks/INFY` (signed out) | Slow 4G | 6.64 s | 6.31 s | 0.001 |
| `/stocks/INFY` (signed out) | 4G | 2.64 s | 2.71 s | 0.001 |
| `/dashboard?demo=1` (reviewer link) | Slow 4G | 4.79 s | 4.55 s | 0.001 |
| `/dashboard?demo=1` (reviewer link) | 4G | 2.06 s | 2.13 s | 0.001 |

Initial JS stays at 187 KB gzipped (budget 200 KB); self-hosted fonts 84 KB woff2 (budget 100 KB).
CLS is under 0.05 everywhere.

## What changed

- **No refresh on a first visit.** In msw mode the mock backend lives in the browser, so a session
  can only exist after this browser signed in, which leaves a session hint. With no hint, the app
  no longer asks `POST /v1/auth/refresh`, which waited for the 350 KB mock chunk only to answer 401.
  The login form paints about 1.9 s sooner on Slow 4G. `?demo=1` still refreshes, since it signs in
  that way.
- **One preloaded font.** Only IBM Plex Sans 400 (the body face, 22 KB) is preloaded; the other
  weights and Plex Mono load on use instead of competing with the entry script.
- **Metric-matched fallbacks.** `IBM Plex Sans Fallback` (Arial / Liberation Sans / Helvetica at
  `size-adjust: 101%`, ascent 101.5%, descent 27.2%) and `IBM Plex Mono Fallback` (Courier New /
  Liberation Mono / Menlo) sit second in the font stacks, so text set before Plex arrives takes the
  same box and the swap does not move anything. Values come from the woff2 files (fontTools).
- **Phone chrome.** `theme-color` matches the white header; `viewport-fit=cover` with safe-area
  padding on the body (landscape notch) and the header (status bar when launched from the home
  screen); a home-screen icon (`apple-touch-icon.png`, 180 px) and a web manifest with 192 / 512 px
  and maskable icons, opening at `/dashboard` standalone.

## What limits the rest

Every data screen in the demo waits for the lazy MSW + mock-market chunk (348 KB gzipped; before
compression about 510 KB is MSW with its interceptors and cookie store, 410 KB faker's locale data,
and 215 KB the paper engine and market data). On Slow 4G that file alone takes about 3 s, so the instrument page cannot reach 2.0 s
there while the backend runs in the browser. Two experiments were measured and dropped:

- A low-priority prefetch of the mock chunk from `index.html` brought `/stocks/INFY` to 2.36 s on 4G
  but slowed `/login` to 2.15 s, because the two downloads share the link.
- Dropping faker's generic `en` locale (identical output) saves nothing: faker's `en_IN` bundle
  imports it.

With the real API (`VITE_API_MODE=api`) the mock chunk is not built at all, and the same screens
are bound by the 187 KB entry plus one API round trip.
