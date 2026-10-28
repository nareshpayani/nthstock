# Recording: the mobile Trade from Charts flow in under two minutes

The shot list and script for the phone recording (SPEC-CR-1 §11 item 3, CR-T24). One take on a
real iPhone, portrait unless a beat says otherwise, from a cold load of the live site. Target
length 1:45, hard limit 2:00.

## Before you record

| Step | Why |
|---|---|
| Clear the site's data: Settings → Safari → Advanced → Website Data → remove `nthstock-a13a5.web.app` | The take starts from a true cold load |
| Do Not Disturb on, battery above 20%, brightness high | No banners; no low-power throttling |
| Settings → Accessibility → Motion → Reduce Motion **off** | The take shows the motion; beat 9 turns it on |
| Settings → Sounds & Haptics → System Haptics **on** | The drag ticks are felt (the viewer sees the thumb settle on each tick) |
| Add Screen Recording to Control Centre; turn the microphone off | Haptics are the feedback; no voice-over in the take (captions are added after) |
| Open `https://nthstock-a13a5.web.app/dashboard?demo=1` once, then close the tab | Warms DNS only; site data stays clear |

Demo login if asked: mobile `9000000001`, OTP `123456`. The demo opens signed in.

## Shot list

| # | Time | Beat | What to do | Caption (added after) |
|---|---|---|---|---|
| 1 | 0:00–0:08 | Cold load | Start recording, open the link, wait for the dashboard | "Cold load on a phone: no layout shift" |
| 2 | 0:08–0:18 | Instrument page | Tap INFY in the watchlist. Hold still for 2 s: price, chart and Sell / Buy all above the fold | "Price, chart and the actions in one screen" |
| 3 | 0:18–0:30 | Short ticket | Tap **Buy**. Switch to **Limit**, drag nothing, tap the quantity +. Note the pinned **Buy INFY** button. Place the order | "A shorter sheet; the button never leaves the thumb" |
| 4 | 0:30–0:40 | Arrival | The new buy line slides in from the price rail; the order value rolls | "The order arrives where it lives: on the chart" |
| 5 | 0:40–0:58 | The drag | Press on the line's tab, hold, drag up slowly across three or four ticks, then down past the last price, release | "The drag owns the gesture: no crosshair, a tick you can feel, a loupe that flips at LTP" |
| 6 | 0:58–1:05 | Near miss | Press the empty chart a finger-width above the line and drag | "Off the line, the chart is the chart" |
| 7 | 1:05–1:22 | Trailing stop | Open **Demo simulator**, tap **Rally +1%** twice. Watch the marigold trailing-stop line glide up and leave a fading trace. Tap the position chip: it presses in | "A ratchet you can see: it glides, it never jumps" |
| 8 | 1:22–1:32 | Offline | Control Centre → Aeroplane mode on. Price says Stale, the chart says Paused, lines show a lock, Buy says you're offline. Aeroplane mode off: it all comes back | "Every state designed, including the bad ones" |
| 9 | 1:32–1:42 | Landscape | Turn the phone sideways: one-line price, the chart fills the height, the dock stays. Turn back | "Every screen size, from 320 px to a tablet" |
| 10 | 1:42–1:48 | Out | Stop on the instrument page with the line in view; stop recording | "nthstock · paper trading, virtual cash" |

Record on a weekday between 9:15 AM and 3:30 PM IST: the demo follows NSE hours, and outside them
the order in beat 3 becomes an after-market order with no line to drag. If a beat goes wrong, carry on: a single take reads as honest, and beats 5
and 7 matter most.

## After

1. Trim the head and tail in Photos; keep it under 2:00.
2. Add the captions above (iMovie or CapCut, white on a dark bar, bottom third clear of the dock).
3. Export 1080p, save as `docs/design/flow-recording.mp4` if under 25 MB, otherwise attach it to the
   submission and link it from DESIGN.md.
