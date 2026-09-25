# Research

Reference research for design and learning only. Nothing here is copied into the product:
nthstock's API follows its own contracts in `packages/contracts` (CLAUDE.md D3).

## Paytm Money equity capture

Run on your own machine, because the page needs your login:

```
npx -y -p playwright@1.58.0 node tools/research/paytmCapture.mjs
```

1. A visible browser opens on the Paytm Money stocks dashboard. Log in yourself: type your
   credentials and OTP. Never give them to Claude.
2. Browse the stocks section: watchlist, search, stock detail, charts, the buy/sell order
   ticket (don't submit it), order book, positions, holdings and funds.
3. Press Enter in the terminal to finish.

Output lands in `research-output/`, which is git-ignored:
- `screens/*.png`: one full-page screenshot per screen. These can show your name and holdings.
- `network.jsonl`: every API call as method, path, status and redacted request/response shapes.
- `websocket.jsonl`: the first frames of each live-price socket, redacted.

Guardrails: order placement, modification and cancellation requests are blocked in the browser.
Cookies, headers and tokens are never written. Values under sensitive keys, and anything that
looks like a token, email or phone number, are redacted. The browser session is not saved.

Document 1 (`paytm-money-equity.md`) is written from this output.
