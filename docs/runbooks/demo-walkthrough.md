# Demo walkthrough: shot list

The TFC-1 walkthrough video (SPEC-TFC-1 §16, TFC-17, REQ-DEL-04) is three minutes or less, recorded
on a phone from the production build. It shows the five journeys the brief asks for, in one take.
Each step below is also an automated check in
[`e2e/journeys.spec.ts`](../../apps/web/e2e/journeys.spec.ts), so the take can be rehearsed with a
known result.

## The scripted take

The published video (<https://nthstock-a13a5.web.app/demo/walkthrough.mp4>, about 70 seconds) is
this shot list played by
[`e2e/walkthrough/demoWalkthrough.walkthrough.ts`](../../apps/web/e2e/walkthrough/demoWalkthrough.walkthrough.ts)
on a 390 × 844 touch phone, with a caption per step and a dot where the finger lands. It uses only
what a visitor has: Try demo, the price-axis gutter, the ticket, the position chip, the Demo
simulator and the scalper, on RELIANCE (the Try demo instrument). To re-record it:

```bash
bash tools/demo/recordWalkthrough.sh -g 'walkthrough:'     # production build, served locally
bash tools/demo/recordWalkthrough.sh https://nthstock-a13a5.web.app -g 'walkthrough:'   # live site
```

Both write `apps/web/public/demo/walkthrough.mp4` (H.264, so iPhone Safari plays it) with its
captions (`.vtt`) and poster (`.jpg`); commit them and release, and the site serves the new take at
the same URL. A hand-held take on a phone, following
the steps below, can replace the file the same way.

## Before recording

- Phone in portrait, with Do Not Disturb on, the screen recorder ready and the browser zoom at 100%.
- Open the production URL in a **private tab**, so the demo starts from a cold load and a fresh
  account.
- Use INFY: it is in the demo watchlist, and its price is calm enough to ratchet visibly.

## Shot list

| Time      | Journey | Do                                                                                                                                                                                                            | Say (one line)                                                                                         |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0:00–0:15 | —       | Open `/login` and tap **Try demo**. Then search for and open **INFY**                                                                                                                                       | "Paper trading on a simulated NSE market, always open for the demo."                                   |
| 0:15–0:45 | US-01   | Tap the price axis on the right, a little under the price: a ghost line appears. Drag its handle to the price you want. Tap **Buy**                                                                          | "The axis places orders, the plot pans and zooms, and lines move only by their handles."               |
| 0:45–1:05 | US-02   | In the sheet, set quantity 4 and turn on **Add trailing stop** at 1%. Read out the preview line. Tap **Place**, then **Confirm**. The blue buy line appears                                                 | "The trailing stop rides along with the entry and arms on the fill."                                   |
| 1:05–1:30 | US-01   | Drag the buy line's handle up close to the price and release. Then use **Pull back −1%** in the Demo simulator, so it fills                                                                                 | "The price follows my finger everywhere, and one modify goes on release."                              |
| 1:30–1:50 | US-03   | The position chip appears at the average price, with live P&L. Tap the chip: the trailing-stop sheet opens. Change the trail to 1.5% and tap **Update trailing stop**                                                      | "Tapping the position opens its trailing stop. A drag from the chip still pans."                       |
| 1:50–2:20 | US-04   | Tap **Rally +1%** twice and point at the amber stop line moving up. Tap **Pull back −1%**: the line holds. Tap **Gap −3%**: "Trailing stop triggered" appears, and the position and the line are gone        | "The stop follows new highs, never moves back, and fires once, even on a gap."                         |
| 2:20–2:50 | US-05   | Turn on **Scalp**. Pick **5**, then turn on **Arm**. Tap **Buy at ask** and point at "Bought 5 @ ₹…" and the strip. Tap **Flatten**: "Closed: sold 5"                                                      | "One tap in, one tap out, only while armed. Reverse needs a hold."                                     |
| 2:50–3:00 | —       | Return to the chart                                                                                                                                                                                         | "Every surface reads one engine state, so the chart, ticket, depth and strip never disagree."          |

## If something goes off script

- **The buy fills before you drag it:** carry on from US-03; the drag is shown again in the scalp.
- **No "Demo simulator" panel:** you are not in demo mode. Open `/login` again and tap **Try demo**.
- **The take runs long:** cut the US-01 modify step (1:05–1:30). The placement drag already shows
  the gesture.

## After recording

Upload the video, add its link at the top of [`WRITEUP.md`](../../WRITEUP.md), and record the link
on the release issue (T29, T30).

## Feature walkthroughs (NSTOCK-0390)

Besides the T30 take, every feature has its own short clip, listed with a player on the
documentation page's **Walkthrough videos** tab (`/guide?tab=walkthroughs`). Each is one Playwright
test in [`apps/web/e2e/walkthrough`](../../apps/web/e2e/walkthrough): `desktop/` at 1440 × 900,
`phone/` at 390 × 844 with touch. The shared helpers in `support/` draw the caption bar and the
click or tap dots, and write each caption with its time to a WebVTT track, so every player has
English captions (WCAG 1.2.2) with the same words as the bar.

```bash
bash tools/demo/recordWalkthrough.sh                         # every clip, about 20 minutes
bash tools/demo/recordWalkthrough.sh -g 'orderTicket|funds'  # only the clips whose id matches
```

The script builds the production web app (msw mode, market open) with the invisible MSW test
controls, which only the after-market clip uses to move the clock to 9:15 the next morning. It
records one clip at a time, so a busy CPU never slows a clip down, and writes
`apps/web/public/demo/<id>.mp4` (H.264), `<id>.vtt` and `<id>.jpg` for each. A clip that fails is
reported, and the others are still encoded. After re-recording, update the clip's length in
`apps/web/src/features/guide/strings.ts`; a unit test checks that every listed clip has its three
files.

| Clip | Device | Length | Shows |
| ---- | ------ | ------ | ----- |
| [Trade from Charts on a phone](../../apps/web/public/demo/walkthrough.mp4) | Phone | 1:12 | The five assignment journeys in one take: Try demo, a ghost line on the price axis, a limit buy with a trailing stop, the stop ratcheting and triggering with the Demo simulator, and the scalper. |
| [Log in with OTP and PIN](../../apps/web/public/demo/login.mp4) | Desktop | 0:43 | Mobile number with DPDP consent, the mock OTP, setting a 4-digit PIN, the session surviving a reload, the profile menu, and logging back in with only the PIN on a trusted browser. |
| [Two-factor authentication](../../apps/web/public/demo/twoFactor.mp4) | Desktop | 0:51 | Turning on 2FA behind a PIN step-up: the QR code and setup key, confirming with an authenticator code, ten recovery codes, then a login that asks for the second factor. |
| [Where you are logged in](../../apps/web/public/demo/activeSessions.mp4) | Desktop | 0:27 | Every session with This device and Trusted badges; logging one device out behind a confirm and a step-up, then all the others at once. |
| [DPDP consent and account deletion](../../apps/web/public/demo/accountDeletion.mp4) | Desktop | 0:41 | Consent recorded at sign-up, deleting the account behind DELETE typed and a step-up, logged out everywhere, and the same mobile refused while its data is erased. |
| [Dashboard and live prices](../../apps/web/public/demo/dashboard.mp4) | Desktop | 0:36 | Header tickers and market status, the NIFTY 50 chart from 1 day to 5 years with its crosshair, market indices, stock lists and the top gainers and losers. |
| [Search](../../apps/web/public/demo/search.mp4) | Desktop | 0:28 | The / shortcut, matching by symbol or company name, keyboard selection, recent and popular searches. |
| [Watchlists](../../apps/web/public/demo/watchlists.mp4) | Desktop | 1:00 | Creating a list, adding stocks from search, live rows, reordering by drag and with Alt+arrows, sorting, removing, and everything surviving a reload. |
| [Stock page and charts](../../apps/web/public/demo/stockDetail.mp4) | Desktop | 0:48 | Every range (1D, 1W, 1M, 1Y, 5Y) and every bar size (1, 5, 15, 30 and 60 minutes), area and candles, the crosshair, key stats, live market depth and the company overview. |
| [Order ticket](../../apps/web/public/demo/orderTicket.mp4) | Desktop | 0:47 | Buy from a stock while logged out, back with the ticket open; a market order with review and confirm; an intraday limit picked from the depth; the circuit band refusing a price. |
| [After-market order (AMO)](../../apps/web/public/demo/afterMarketOrder.mp4) | Desktop | 0:43 | At 8 PM the market is closed, so the order goes in as an AMO, waits under Open, and is released and executed at 9:15 the next morning. |
| [Trailing stop-loss (TSLO)](../../apps/web/public/demo/trailingStop.mp4) | Desktop | 0:47 | A trailing stop from the ticket in percent, the amber stop line, the stop ratcheting up on a rally, holding on a pullback, and triggering once on a gap. |
| [Trade from Charts with a mouse](../../apps/web/public/demo/tradeFromCharts.mp4) | Desktop | 0:47 | Click the price axis for a ghost line, drag it, place a limit from the compact ticket, drag the order line to modify it, cancel with two clicks, and protect a position from its chip. |
| [Scalper](../../apps/web/public/demo/scalper.mp4) | Phone | 0:36 | The one-tap pad: size chips, Arm, Buy at ask, Flatten and the hold-to-Reverse, each with a plain acknowledgement. |
| [Order book](../../apps/web/public/demo/orders.mp4) | Desktop | 0:52 | Open, Executed and Cancelled tabs, modifying an open limit order, cancelling it, and the status timeline in IST. |
| [Positions and portfolio](../../apps/web/public/demo/positionsPortfolio.mp4) | Desktop | 0:33 | Demo holdings valued live, a new position with live P&L in Positions, and Exit at the market price. |
| [Funds](../../apps/web/public/demo/funds.mp4) | Desktop | 0:27 | ₹10,00,000 of virtual cash, invested and free amounts, the ledger of every block, debit and credit, and a reset behind RESET typed. |
| [Price alerts and notifications](../../apps/web/public/demo/priceAlerts.mp4) | Desktop | 0:32 | An alert from the bell on a stock with a quick level and a note, its dotted line on the chart, the toast when the price crosses, and the notification centre. |
| [Keyboard shortcuts](../../apps/web/public/demo/keyboard.mp4) | Desktop | 0:34 | The ? list, / to search, Shift+Enter to add to a watchlist, B to buy from a watchlist row, Enter to review and Esc to close, with focus always visible. |
| [Phone layout](../../apps/web/public/demo/phoneLayout.mp4) | Phone | 0:40 | The dashboard in one column, the menu drawer with search, the stock page tabs and sticky trade bar, the bottom-sheet ticket and the position strip. |
| [This documentation](../../apps/web/public/demo/guide.mp4) | Desktop | 0:27 | The documentation page from the login link: its tabs, diagrams and code links. |

The phone clips record on Chromium with touch. In a sandbox whose Playwright cannot find its own
ffmpeg build, point `/opt/pw-browsers/ffmpeg-<build>/ffmpeg-linux` at a system ffmpeg with VP9
(Playwright records WebM before the H.264 encode).
