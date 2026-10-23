# Demo walkthrough: shot list

The TFC-1 walkthrough video (SPEC-TFC-1 §16, TFC-17, REQ-DEL-04) is three minutes or less, recorded
on a phone from the production build. It shows the five journeys the brief asks for, in one take.
Each step below is also an automated check in
[`e2e/journeys.spec.ts`](../../apps/web/e2e/journeys.spec.ts), so the take can be rehearsed with a
known result.

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
