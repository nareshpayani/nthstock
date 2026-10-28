# Craft round (CR-1): delivery plan

| | |
|---|---|
| Document | PLAN-CR-1 |
| Version | 1.1 (issues created) |
| Date | 2026-10-28 |
| Product owner and approver | Naresh Payani |
| Specification | [SPEC-CR-1](craft-round.md) |
| Target | 2026-10-30, end of day IST |

## 1. Summary

Twenty-four stories in six epics deliver SPEC-CR-1 in about two working days. Development starts
only after the owner approves this plan, the epics and the stories (CR-16). Each story is one pull
request into `develop` with several focused commits (one per step, so the history reads as the
work progressed), reviewed automatically and squash-merged. Production is promoted after each epic,
so the live URL improves in steps and is never broken.

Story IDs map to GitHub issues as below (created 2026-10-28; the spec issue is NSTOCK-0397, #603).
Each story is a sub-issue of its epic. CR-T*nn* is NSTOCK-0(403 + *nn*), issue #(610 + *nn*).

| Epic | Issue | Stories |
|---|---|---|
| CR-A | NSTOCK-0398 #605 | CR-T01 NSTOCK-0404 #611, CR-T02 NSTOCK-0405 #612, CR-T03 NSTOCK-0406 #613, CR-T04 NSTOCK-0407 #614 |
| CR-B | NSTOCK-0399 #606 | CR-T05 NSTOCK-0408 #615, CR-T06 NSTOCK-0409 #616, CR-T07 NSTOCK-0410 #617, CR-T08 NSTOCK-0411 #618, CR-T09 NSTOCK-0412 #619 |
| CR-C | NSTOCK-0400 #607 | CR-T10 NSTOCK-0413 #620, CR-T11 NSTOCK-0414 #621, CR-T12 NSTOCK-0415 #622 |
| CR-D | NSTOCK-0401 #608 | CR-T13 NSTOCK-0416 #623, CR-T14 NSTOCK-0417 #624, CR-T15 NSTOCK-0418 #625, CR-T16 NSTOCK-0419 #626 |
| CR-E | NSTOCK-0402 #609 | CR-T17 NSTOCK-0420 #627, CR-T18 NSTOCK-0421 #628, CR-T19 NSTOCK-0422 #629, CR-T20 NSTOCK-0423 #630 |
| CR-F | NSTOCK-0403 #610 | CR-T21 NSTOCK-0424 #631, CR-T22 NSTOCK-0425 #632, CR-T23 NSTOCK-0426 #633, CR-T24 NSTOCK-0427 #634 |

## 2. Milestones

| Milestone | Target (IST) | Exit criteria |
|---|---|---|
| M0 Baseline and foundations | 28 Oct, 20:00 | "Before" set captured; tokens v2, motion and haptics primitives merged; viewport matrix running in CI |
| M1 The drag | 29 Oct, 13:00 | AC-01 to AC-05 pass on Chromium and WebKit; checked on the owner's iPhone; promoted |
| M2 Sheet and layout | 29 Oct, 22:00 | AC-06 to AC-08 pass at every matrix viewport; promoted |
| M3 States and cold load | 30 Oct, 12:00 | AC-09 and AC-10 pass; cold-load numbers recorded; promoted |
| M4 Quality and deliverables | 30 Oct, 20:00 | AC-11 to AC-14 pass; DESIGN.md, recording script and AI note done; final promotion |

## 3. Critical path

CR-T02 → CR-T03 → CR-T05 → CR-T06 → CR-T07 → CR-T11 → CR-T13 → CR-T21 → CR-T23

CR-T01 (before set) must merge before any UI change reaches `develop`. CR-T04 (matrix) runs
alongside the first epic so every later PR is checked at every size.

## 4. Descoping order

If a milestone slips, scope is removed in this order and DESIGN.md says so:

1. iPhone haptics flag (CR-T08; Android haptics stay).
2. Order flies to the chart (CR-T12; a plain close stays).
3. Ratchet trace on the trailing line (CR-T09; the glide stays).
4. Tablet landscape polish (CR-T15; portrait stays).

**Never descoped:** gesture ownership (CR-T05), the pinned primary button (CR-T11), the viewport
matrix (CR-T04), reduced motion and accessibility.

## 5. Stories

Sizes: S up to 2 hours, M 2 to 4 hours, L 4 to 8 hours. Every story's pull request passes
`npm run check`, adds or updates tests, and lists the acceptance criteria it meets.

### Epic CR-A: Baseline and foundations (M0)

| ID | Story | Size | Depends on | Done when |
|---|---|---|---|---|
| CR-T01 | Capture the "before" set: screenshots of the flow at every matrix viewport and a short phone recording of today's production | S | – | Files saved under `docs/design/before/`; referenced from DESIGN.md's draft |
| CR-T02 | Tokens v2: colour roles, `marigold-ink`, type scale with tabular mono, spacing, radii, motion tokens; Storybook token sheet | M | – | `packages/tokens` tests (contrast, generation) pass; Storybook shows the sheet; screenshots of changed screens in the PR |
| CR-T03 | Motion and haptics primitives: `useReducedMotion`, a small spring, digit-roll component, haptics service (Android vibrate, iPhone flag, off setting) | M | CR-T02 | Unit tests cover reduced motion, throttling and the off setting; no new dependency |
| CR-T04 | Viewport matrix in Playwright: the 13 viewports of SPEC-CR-1 §6.3 with the four layout checks, 200% zoom run | M | – | CI runs the matrix on the flow's routes; failures name the viewport and the element |

### Epic CR-B: The drag owns the gesture (M1)

| ID | Story | Size | Depends on | Done when |
|---|---|---|---|---|
| CR-T05 | Grab band and gesture ownership: full-width 44 px band per draggable line, pointer capture, chart crosshair, scroll and scale off during a drag, overscroll blocked | L | CR-T04 | AC-01 and AC-02 pass in an automated touch test on Chromium and WebKit, including the near-miss case from the audit |
| CR-T06 | Price rail and tabs: ruler ticks, notched tabs with grip, lift on grab, spring settle on release | M | CR-T02, CR-T05 | Matches the mock-ups; AC-04 passes; 60 fps trace attached |
| CR-T07 | Loupe and live labels: price, distance from LTP, value or estimated P&L; flips side at LTP and at screen edges | M | CR-T06 | AC-03 passes at every matrix width |
| CR-T08 | Drag haptics and announcements: §5.4 map; live region for start, commit and cancel | S | CR-T03, CR-T05 | AC-05 passes; screen-reader text covered by tests |
| CR-T09 | Position and trailing-stop lines: position chip with live P&L and press feedback; trailing-stop glide and fading ratchet trace | M | CR-T06 | Trailing-stop announcer unchanged and green; reduced motion jumps |

### Epic CR-C: Order sheet (M2)

| ID | Story | Size | Depends on | Done when |
|---|---|---|---|---|
| CR-T10 | Sheet physics: detents, drag to dismiss, open and close motion, reduced-motion fade | M | CR-T03 | Focus trap, Escape and return focus unchanged; reduced motion verified |
| CR-T11 | Compact sheet layout: essentials first, "More options" disclosure, pinned primary button above safe area and keyboard; Buy blue and Sell red outline everywhere | L | CR-T10 | AC-07 passes at every phone viewport, keyboard open included; existing ticket tests green |
| CR-T12 | Value transitions and the "order flies to the chart" moment | M | CR-T11, CR-T06 | Digit roll on changed digits; reduced motion swaps; works at every width |

### Epic CR-D: Identity and layout across screen sizes (M2)

| ID | Story | Size | Depends on | Done when |
|---|---|---|---|---|
| CR-T13 | Phone instrument page: compact app bar, price block, full-bleed chart, range row, dock | L | CR-T02 | AC-06 passes at 360 × 740 and every larger phone |
| CR-T14 | Index ticker fit: status dot, compact figures, scroll strip under 360 px | S | CR-T02 | AC-08 passes at 320, 344 and 360 px |
| CR-T15 | Tablet, foldable and landscape layouts: docked order panel from 600 px; landscape phone layout | L | CR-T11, CR-T13 | AC-11 passes for the tablet, foldable and landscape rows |
| CR-T16 | Microcopy pass across the flow, one voice | S | CR-T11, CR-T13 | Copy table in the PR; strings files updated |

### Epic CR-E: States and cold load (M3)

| ID | Story | Size | Depends on | Done when |
|---|---|---|---|---|
| CR-T17 | Skeletons in the final shape with cross-fade, no layout shift | M | CR-T13 | CLS under 0.05 on the flow |
| CR-T18 | Empty, error and offline states, and the demo "States" row | M | CR-T13, CR-T11 | AC-09 passes |
| CR-T19 | Cold-load polish and measurement: font preload with fallback metrics, theme colour, safe areas, home-screen icon; throttled 4G numbers | M | CR-T13 | LCP under 2.0 s and initial JS within budget on the throttled profile; numbers recorded |
| CR-T20 | First-run drag hint | S | CR-T06 | Shown once, dismissed by any drag or tap, silent under reduced motion |

### Epic CR-F: Quality and deliverables (M4)

| ID | Story | Size | Depends on | Done when |
|---|---|---|---|---|
| CR-T21 | Regression pass across the matrix: accessibility (axe, keyboard, screen-reader names), reduced motion, 200% zoom | M | all above | AC-10 to AC-13 pass |
| CR-T22 | Real-device QA: owner's iPhone, an Android phone (Chrome and Samsung Internet); frame-time trace | S (PO + agent) | CR-T21 | Checklist signed in the PR; issues fixed or descoped |
| CR-T23 | DESIGN.md: decisions, references, distinctive elements, before/after pairs and slider, numbers, AI note | M | CR-T22 | AC-14 passes |
| CR-T24 | Recording shot list and script, 2 minutes or less | S | CR-T22 | Script in `docs/design/`; owner records |

## 6. Go/no-go before the final promotion

- [ ] AC-01 to AC-14 pass
- [ ] Matrix green in CI; owner's iPhone and an Android phone checked by hand
- [ ] No change in `packages/contracts` or `packages/paperEngine`
- [ ] DESIGN.md, recording and AI note ready
- [ ] Production promoted and checked from a cold load on a phone
