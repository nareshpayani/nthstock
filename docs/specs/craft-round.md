# Craft round: mobile Trade from Charts, design and interaction

| | |
|---|---|
| Document | SPEC-CR-1 |
| Version | 1.0 (draft for owner approval) |
| Date | 2026-10-28 |
| Product owner and approver | Naresh Payani |
| Decisions | [Q&A log, Round 10](../requirements-qa.md) (CR-01 to CR-17) |
| Delivery plan | [PLAN-CR-1](craft-round-tasks.md) |
| Builds on | [SPEC-TFC-1](trade-from-charts.md) (the features this round polishes) |
| Target | 2026-10-30, end of day IST |

## 1. Summary

Paytm Money's follow-up exercise asks for craft, not features: take the mobile flow from the
instrument page to the order ticket to the on-chart order, position and trailing-stop lines, and
make it distinctive and production-grade. Reviewers will judge feel, detail and taste on a real
phone from a cold load.

This round gives nthstock a visual identity called **Instrument**: a precision tool held in the
hand. Its two signature elements are the **price rail**, a ruler along the price axis that every
line's handle rides on, and the **loupe**, a magnified readout above the thumb while a line is
dragged. The drag owns the gesture from first contact, so the chart's crosshair can no longer wake
mid-drag. The order sheet shortens to its essentials with the primary button pinned. Every screen
size from a 320 px phone to a tablet works without breaking.

No trading behaviour changes: no new order types, engine rules, endpoints or contracts.

## 2. Goals and non-goals

| Goals | Non-goals |
|---|---|
| A deliberate identity: type scale, colour roles, spacing rhythm, two signature elements | New order types, engine changes, new endpoints or contracts |
| Line drags that feel physical: grab, track, settle, live labels, haptics | Dark mode (CLAUDE.md D4) |
| The drag owns the gesture: no crosshair, pan, pinch or page scroll while a line is held | Re-designing screens outside this flow (they only inherit tokens) |
| Price, chart and action above the fold at 360 × 740 | Offline cold load (service worker) |
| A shorter order sheet with a fixed primary button | A motion library dependency |
| A complete state set: loading, empty, error, offline | Real-money trading (D2) |
| Works on every common screen size and orientation (CR-17) | |
| Accessibility kept at WCAG 2.2 AA; reduced motion respected | |

## 3. Baseline (measured 2026-10-28)

Measured on the develop build in Chromium with touch events at 360 × 740, 390 × 844 and 414 × 896.
Screenshots: `/mnt/project-files/nthstock/screenshots/craftRound/` (project files).

| Finding | Evidence |
|---|---|
| Crosshair wakes during a drag | Only the line's label (a 44 px button) is a hit target. A press on the line, or 6 px off the label, reaches the chart, whose 240 ms long-press starts crosshair tracking; the line does not move. |
| Primary button below the fold | "Buy INFY" in the order sheet sits at y ≈ 1,209 px on a 740 px screen; the sheet scrolls 992 px of content. |
| Chart below the fold | At 360 × 740 the chart starts at y = 562 px; the trade bar covers its lower half. |
| Ticker clips | SENSEX is cut at 360, 390 and 414 px. |
| Inconsistent Buy colour | Green in the trade bar, blue on the chart's ghost line. |
| Missing states | No offline state; no empty state for a chart with no orders; ticket skeleton does not match its layout. |
| No haptics | No vibration hooks; iOS Safari has no Vibration API. |

## 4. Visual identity: Instrument

Mock-ups (approved before code, CR-03):
[nthstock Instrument mock-ups](https://claude.ai/artifact/SwYwm31TapSxKD3TFQpcvZ): instrument
page at 390 × 844, mid-drag, order sheet, 360 × 740 and tablet at 820 × 1180.

### 4.1 Tokens (v2)

Token changes go through `packages/tokens` (one source for CSS variables and Tailwind). Brand
blue, up, down and marigold keep their values (CR-04).

| Role | Value | Change |
|---|---|---|
| `ink` (text, position line) | #0B1526 | from #0E2240, darker for contrast and a more precise feel |
| `ink-muted` (secondary text) | #4A5568 | from #5A6B80, 7.4:1 on white |
| `canvas` (ground strips, inputs) | #F5F7FA | from #F3F6FA, cooler and quieter |
| `line` (hairlines) | #E4E8EE | from #DCE3ED, finer |
| `brand` (actions, Buy) | #1463D8 | unchanged |
| `up` / `down` | #0B7A52 / #C0392B | unchanged; price direction only |
| `marigold` (trailing stop, fill only) | #F2B632 | unchanged; never text |
| `marigold-ink` (trailing line stroke) | #A86B00 | new; 3:1 or better on white for a non-text line |

Type: IBM Plex Sans for words, IBM Plex Mono with tabular figures for every number. Scale 1.2:
12 / 14 / 16 / 20 / 24 / 40 px, with the price as a 40 px mono display (32 px below 360 px wide,
48 px on tablets) whose rupee sign is set at 65% and paise in `ink-muted`.

Spacing: 4 px grid with an 8 px rhythm. Cards give way to full-bleed sections divided by hairlines
on phones. Radii: 4 px chips, 12 px controls, 20 px sheet corners.

Motion tokens: `--nth-ease-out` cubic-bezier(0.2, 0, 0, 1), `--nth-ease-in` cubic-bezier(0.4, 0, 1, 1),
durations 120 / 180 / 280 ms, and one critically damped spring for drags and sheets.

### 4.2 Signature elements

- **Price rail.** The price axis becomes a ruler: minor ticks every price step, major ticks with
  labels, and each line's handle a notched tab sitting on the rail. Draggable tabs carry a grip
  (three short bars); the position tab carries none.
- **Loupe.** While a line is held, a dark card above the thumb shows the price at 24 px, the
  distance from LTP, and the order value (or estimated P&L for a stop). The thumb never hides the
  number it is setting.

## 5. Interaction

### 5.1 Gesture ownership (fixes the crosshair defect)

1. Each draggable line has a transparent grab band 44 px tall across the full plot width, in
   addition to its tab. The band is the hit target; the line itself is what the thumb reaches for.
2. On `pointerdown` in a band or tab, the overlay captures the pointer and, for the duration of the
   gesture, sets the chart's crosshair to hidden and turns off its scroll and scale handling. Page
   scroll and overscroll (pull-to-refresh, rubber-band) are blocked with `touch-action: none` and
   `overscroll-behavior: contain` on the chart.
3. Release, cancel, a second finger or Escape restores the chart options.
4. A press outside every band keeps today's chart behaviour (pan, pinch, long-press crosshair).
5. Where two bands overlap, the line nearer the finger wins; ties go to the line drawn on top.

### 5.2 Drag lifecycle

| Step | What the user sees and feels |
|---|---|
| At rest | Grip on draggable tabs; band invisible |
| Grab | Line 1 → 2 px, tab lifts (scale 1.04, raised shadow), band tints at 7%, other lines dim to 45%, loupe fades in (120 ms), light haptic |
| Track | Line follows the finger 1:1 using transforms only (no React render per move); price snaps to the tick; a selection haptic per tick step; a stronger one on crossing LTP, where the loupe flips side |
| Release | Line settles on its snapped price (spring, 180 ms, no overshoot past the tick), tab drops, loupe fades, label shows "Saving…" then the price, success haptic |
| Cancel | Released within 6 px of start, a second finger or Escape: the line springs back; nothing is sent |
| Rejected | The line springs back, error haptic, and the existing error toast explains why |

Keyboard drag stays as today (arrows, Shift for 10 ticks, Enter, Escape). The live region also
announces drag start, the committed price and a cancel.

### 5.3 Line labels

| Line | Left chip | Rail tab | Line style |
|---|---|---|---|
| Buy or sell order | "BUY 4 · LIMIT" outlined in its side colour | Filled tab with grip and price | Dashed, side colour |
| Position | "4 SH" plus live P&L on ink | Ink tab, no grip; tap opens the position editor | Solid ink |
| Trailing stop | "TRAILING STOP · 2%" on marigold-soft | Marigold tab with grip | Dashed `marigold-ink`; a ratchet glides 240 ms and leaves a short fading trace |
| LTP | none | Direction-coloured tab | Dotted |

### 5.4 Haptics

Haptics follow Apple's three meanings so they read as native on both platforms. They never carry
meaning alone, and a setting turns them off.

| Event | Pattern | Android (`navigator.vibrate`) | iPhone |
|---|---|---|---|
| Grab a line | Impact, light | 10 ms | Native-switch haptic, behind a flag (CR-09) |
| Each tick step while dragging | Selection | 4 ms, throttled to 1 per 40 ms | Same, throttled |
| Cross LTP | Impact, medium | 18 ms | Same |
| Commit | Success | 12, 40, 12 ms | Same |
| Rejected or cancel | Error / none | 30, 30, 30 ms on reject | Same |

### 5.5 Order sheet

- Two detents: **compact** (side, quantity, price with Market/Limit, order value, primary button)
  and **expanded** (adds product, validity, trailing stop and depth behind "More options").
- The primary button is pinned to the sheet foot, above the safe area and above the on-screen
  keyboard (sized from `visualViewport`), and never moves while the user edits.
- Opens with a 280 ms decelerating rise; closes in 200 ms. Follows the finger when dragged by its
  grabber; dismisses past 30% of its height or on a fast flick; otherwise springs back.
- Buy is filled brand blue, Sell outlined in down red, everywhere (CR-05).

### 5.6 Value and tick transitions

- Changed digits roll (160 ms); unchanged digits stay still.
- Price ticks keep "no colour flash" (PR #231); changed digits get a 1 px underline that fades in
  400 ms.
- Skeletons cross-fade into content in 160 ms with no layout shift.

### 5.7 Moments

- **Order flies to the chart.** On Confirm, the sheet folds away and the new order line draws in
  from the rail at its price (X1).
- **First-run hint.** The first time a chart shows a draggable line, its tab nudges twice and a
  one-line hint says "Drag the line to change the price". It is dismissed by any drag or tap and
  not shown again (X2).

### 5.8 Reduced motion

With `prefers-reduced-motion: reduce`: springs and slides become instant or a 120 ms fade, digit
rolls become swaps, the hint does not nudge, and the ratchet jumps without a trace. Haptics are
unaffected (they have their own setting).

## 6. Layout and screen sizes

### 6.1 Phone budget (360 × 740 and up)

| Band | Height |
|---|---|
| App bar (back, symbol, alert, watchlist) | 48 px |
| Index ticker | 32 px |
| Price block | 72 to 110 px |
| Chart | clamp(220 px, 40% of the viewport height, 480 px) |
| Range row | 48 to 52 px |
| Dock (position strip, Sell, Buy, Scalp) | 100 to 112 px plus the safe area |

Acceptance: at 360 × 740 the price, the whole chart plot and the Buy and Sell buttons are visible
without scrolling.

### 6.2 Breakpoints

| Width | Layout |
|---|---|
| Under 360 px | Compact: 32 px price, ticker becomes a scroll strip with edge fades, chips and labels shorten; nothing clips or scrolls sideways (down to 320 px; 280 px still usable) |
| 360 to 599 px | Phone layout above; the order ticket is a bottom sheet |
| 600 to 1023 px | Tablet and unfolded foldable: full-width chart, details and a docked order panel side by side; no sheet |
| 1024 px and up | Existing desktop layout, with the new tokens |
| Landscape phone (height under 500 px) | Chart fills the height between app bar and dock; price block collapses to one line; the sheet becomes full height with its button pinned |

### 6.3 Device and viewport matrix (CR-17)

Every viewport below runs in the automated suite (Playwright projects) and passes four checks: no
horizontal page scroll, no clipped or overlapping text in the flow, every touch target at least
44 px, and the primary action visible without scrolling. Rows marked "device" are also checked by
hand on a real phone before release.

| Class | Viewport (CSS px) | Examples | Engine |
|---|---|---|---|
| Very small | 320 × 640 | iPhone SE (1st gen), small Android | Chromium |
| Foldable, closed | 344 × 882 | Galaxy Z Fold cover screen | Chromium |
| Small Android | 360 × 740 | Galaxy A and M series (most common in India) | Chromium; device |
| Small iPhone | 375 × 667 | iPhone SE (2nd, 3rd gen) | WebKit |
| Standard iPhone | 390 × 844 | iPhone 12 to 15 | WebKit; device (owner's iPhone) |
| Standard Android | 393 × 873 | Pixel 7 to 9 | Chromium |
| Large Android | 412 × 915 | Galaxy S Ultra, Pixel Pro | Chromium |
| Large iPhone | 430 × 932 | iPhone Pro Max and Plus | WebKit |
| Phone landscape | 844 × 390 | Any phone turned sideways | WebKit and Chromium |
| Foldable, open | 673 × 841 | Galaxy Z Fold inner screen | Chromium |
| Tablet portrait | 820 × 1180 | iPad Air, Android tablets | WebKit |
| Tablet landscape | 1180 × 820 | iPad Air sideways | WebKit |
| Desktop (regression) | 1440 × 900 | Chrome desktop | Chromium |

Browsers checked by hand: iPhone Safari, Android Chrome and Samsung Internet (common on Indian
Android phones). Browser zoom at 200% and system font size "large" must not break the flow.

## 7. States

| Part | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| Price block | Skeleton in the final shape | n/a | "Price unavailable" with retry | Last price, marked "Stale" with its time |
| Chart | Skeleton plot and rail | "No trades yet today" | Error state with retry | Last candles, "Paused: offline" over the plot |
| Lines | n/a | First-run hint (5.7) | A failed save springs back with a toast | Lines locked; tabs show a lock and say why |
| Order sheet | Skeleton matching the compact detent | n/a | Inline message above the button | Button disabled: "You're offline. Orders resume when you reconnect." |
| Ticker | Skeleton per index | n/a | Index hidden | Marked stale |

Offline means the browser reports offline or the realtime socket is down for more than 3 seconds.
In demo mode, a "States" row in the Simulator shows each state on demand (CR-11).

## 8. Accessibility

Everything in SPEC-TFC-1 §13 stays: skip link, ARIA names on handles, keyboard drag, the
trailing-stop announcer and 44 px targets. This round adds: announcements for drag start, commit
and cancel; text contrast checked against the new tokens (4.5:1 text, 3:1 lines and borders); the
loupe and haptics duplicate information that is also in the handle's name; and reduced motion as in
§5.8. axe runs clean on the flow at every matrix viewport.

## 9. Performance and cold load

- Drag runs at 60 fps on a mid-range Android (no long tasks over 16 ms during a drag), measured with
  a Performance trace and reported in DESIGN.md (X6).
- Cold load on a throttled 4G profile meets CLAUDE.md §3: LCP under 2.0 s, CLS under 0.05; the
  initial JS budget (200 KB gzipped) is unchanged or smaller (G4).
- Fonts are preloaded with matching fallback metrics so text does not jump; `theme-color`,
  `viewport-fit=cover` and a home-screen icon are set (X3).

## 10. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-01 | A press anywhere within 22 px of a draggable line, held and moved, moves that line; the crosshair never shows during or after it (automated touch test on Chromium and WebKit) |
| AC-02 | During a drag the chart does not pan or zoom and the page does not scroll |
| AC-03 | The loupe shows price, distance from LTP and value; it stays fully on screen at every matrix width |
| AC-04 | Release settles the line on a tick-snapped price; cancel and reject spring back with no request or a rolled-back one |
| AC-05 | Haptics fire as in §5.4 where supported and never when turned off |
| AC-06 | At 360 × 740, price, chart plot and Buy/Sell are visible without scrolling |
| AC-07 | The order sheet's primary button is visible without scrolling in the compact detent at every phone viewport, including with the keyboard open |
| AC-08 | The ticker never clips; under 360 px it scrolls inside its strip only |
| AC-09 | Every state in §7 can be shown in demo mode and matches its skeleton or message |
| AC-10 | With reduced motion on, nothing slides, springs or rolls |
| AC-11 | Every matrix viewport passes the four layout checks in §6.3 |
| AC-12 | Existing accessibility, unit and E2E tests stay green; axe clean on the flow |
| AC-13 | No change to contracts, engine behaviour or endpoints (diff check on `packages/contracts` and `packages/paperEngine`) |
| AC-14 | Deliverables in §11 are complete and linked from the submission |

## 11. Deliverables

1. Live on the existing production URL, from a cold load.
2. `DESIGN.md` at the repository root: decisions, references, what is distinctive now, before/after
   pairs captured before the first change (G3) and after the last, frame-time and cold-load numbers.
3. A phone recording of 2 minutes or less, from a shot list and script (CR-15).
4. A one-line note on AI usage in `DESIGN.md` and the submission.

## 12. Risks

| Risk | Mitigation |
|---|---|
| iPhone haptic workaround stops working | Behind a flag; Android haptics and visual feedback carry the experience |
| Toggling chart options mid-gesture causes a frame of jank | Options switched once on grab and once on release; measured in the frame-time trace |
| Small screens with a large system font overflow | Matrix runs at 200% zoom; text wraps rather than clips |
| Token changes ripple to other screens | CR-02 limits polish to this flow; PR screenshots cover every listed route |
| Two days is tight | Plan order puts the drag first; descoping order in PLAN-CR-1 §4 |

## 13. Open questions

None. Round 10 is settled.
