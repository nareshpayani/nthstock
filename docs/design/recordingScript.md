# Recording: the mobile Trade from Charts flow in under two minutes

The shot list and script for the phone recording (SPEC-CR-1 §11 item 3, CR-T24). One take on a
real phone, portrait unless a beat says otherwise, from a cold load of the live site. Target
length 1:50, hard limit 2:00.

## Before you record

On an iPhone (Safari) or an Android phone (Chrome), whichever is to hand. The steps differ only here.

| Step | iPhone | Android | Why |
|---|---|---|---|
| Clear the site's data | Settings → Safari → Advanced → Website Data → remove `nthstock-a13a5.web.app` | Chrome → ⋮ → Settings → Site settings → All sites → `nthstock-a13a5.web.app` → Delete data and reset permissions | The take starts from a true cold load |
| No interruptions | Focus → Do Not Disturb on | Swipe down → Do not disturb on | No banners mid-take |
| Motion on | Settings → Accessibility → Motion → Reduce Motion **off** | Settings → Accessibility → Remove animations **off** | The take shows the motion. Reduced motion is shown in DESIGN.md and the E2E suite |
| Haptics on | Settings → Sounds & Haptics → System Haptics **on** | Settings → Sound & vibration → Vibration & haptics → Touch feedback **on** | The drag ticks are felt (the viewer sees the thumb settle on each tick) |
| Screen recorder ready, no microphone | Settings → Control Centre → add Screen Recording. Long-press its button, Microphone **off** | Swipe down twice → Screen record (Android 11 and later; add it from the pencil if missing). Choose **No audio**, and turn **Show touches on screen** on | No voice-over in the take; captions are added after |
| Battery and brightness | Above 20%, Low Power Mode off, brightness high | Above 20%, Battery Saver off, brightness high | No throttling, a readable take |
| Warm DNS only | Open `https://nthstock-a13a5.web.app/dashboard?demo=1` once, close the tab, then clear the site data again | Same | The real take is still a cold load |

Demo login if asked: mobile `9000000001`, OTP `123456`. The `?demo=1` link opens signed in.

Record on a weekday between 9:15 AM and 3:30 PM IST: the demo follows NSE hours, and outside them
the order in beat 3 becomes an after-market order with no line to drag.

## Shot list

Below 768 px the site is a phone app: a tab bar (Home, Portfolio, a raised Trade button, Orders,
Account) at the bottom, and stock pages pushed over it with a back button.

| # | Time | Beat | What to do | Caption (added after) |
|---|---|---|---|---|
| 1 | 0:00–0:08 | Cold load | Start recording, open the link. Home paints: portfolio value and day P&L, the chart, Add funds and Place order | "Cold load on a phone: no layout shift" |
| 2 | 0:08–0:16 | Instrument page | In Home's Watchlist, tap INFY. Hold still for 2 s: price, chart and Sell / Buy all above the fold | "Price, chart and the actions in one screen" |
| 3 | 0:16–0:28 | Short ticket | Tap **Buy**. Switch to **Limit**, tap the quantity +. Note the pinned **Buy INFY** button. Place the order | "A shorter sheet; the button never leaves the thumb" |
| 4 | 0:28–0:36 | Arrival | The new buy line slides in from the price rail; the order value rolls | "The order arrives where it lives: on the chart" |
| 5 | 0:36–0:54 | The drag | Press on the line's tab, hold, drag up slowly across three or four ticks, then down past the last price, release | "The drag owns the gesture: no crosshair, a tick you can feel, a loupe that flips at LTP" |
| 6 | 0:54–1:00 | Near miss | Press the empty chart a finger-width above the line and drag | "Off the line, the chart is the chart" |
| 7 | 1:00–1:16 | Trailing stop | Open **Demo simulator**, tap **Rally +1%** twice. Watch the marigold trailing-stop line glide up and leave a fading trace | "A ratchet you can see: it glides, it never jumps" |
| 8 | 1:16–1:32 | Chart tools | Tap **Indicators**, pick SMA 20. Tap **Draw**: the chart opens full screen with the tool rail. Draw a horizontal line at a recent high; the IST clock ticks beside the controls. Tap the camera: the Share sheet opens with the chart image; cancel it. Close full screen | "A trader's toolkit on a phone: indicators, drawings, a chart you can share" |
| 9 | 1:32–1:42 | Offline | Aeroplane mode on (Control Centre, or Quick Settings on Android). Price says Stale, the chart says Paused, lines show a lock, Buy says you're offline. Aeroplane mode off: it all comes back | "Every state designed, including the bad ones" |
| 10 | 1:42–1:50 | Out | Tap back to Home, then stop on it with the portfolio value in view; stop recording | "nthstock · paper trading, virtual cash" |

Landscape is out of this take to stay under two minutes; DESIGN.md shows it. If a beat goes wrong,
carry on: a single take reads as honest, and beats 5, 7 and 8 matter most.

## After

1. Trim the head and tail (Photos on iPhone, Google Photos on Android); keep it under 2:00.
2. Add the captions above (iMovie or CapCut, white on a dark bar, bottom third clear of the dock).
3. Export 1080p, save as `docs/design/flow-recording.mp4` if under 25 MB, otherwise attach it to the
   submission and link it from DESIGN.md.
