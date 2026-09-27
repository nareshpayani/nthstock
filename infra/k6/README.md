# k6 smoke tests (local only)

Load scripts for [k6](https://grafana.com/docs/k6/latest/). k6 is a standalone binary (or the
`grafana/k6` Docker image), not an npm package, so nothing here is installed by `npm ci` and none
of it runs in CI. The large load tests (1 lakh to 10 lakh sockets, CLAUDE.md §4) come in Phase 6.

## `wsSmoke.js`: 1,000 live-price sockets (T-172)

Opens 1,000 WebSocket connections to apps/realtime (spread over a 20 s ramp), subscribes each to
10 of 20 large caps, holds them for 60 s, and reports:

- **quote frames per second** received across all sockets (and quotes per second);
- **p95 delivery latency**: receive time minus each quote's tick time (`ts`, carried in the binary
  frame), so tick to client, before the browser's paint;
- the share of sockets that upgraded, and any server `error` messages or 4401 closes.

Thresholds (the run exits non-zero if one fails): p95 delivery under 500 ms, at least 99% of
sockets connected, at least one frame received.

### Run it

1. Start the backends with a **known** `JWT_SECRET` (the script signs access tokens with it, as
   apps/api does) and the mock market forced open:

   ```bash
   export JWT_SECRET="$(openssl rand -base64 48)"   # generated per run; never commit it
   MOCK_MARKET_ALWAYS_OPEN=true npm run dev:api
   ```

2. In another shell with the same `JWT_SECRET` exported:

   ```bash
   k6 run infra/k6/wsSmoke.js
   # or, without installing k6:
   docker run --rm -i --network host -e JWT_SECRET grafana/k6 run - < infra/k6/wsSmoke.js
   ```

Example output (a laptop, 1,000 sockets, 10 s ramp, 20 s hold):

```text
nthstock realtime smoke (infra/k6/wsSmoke.js)
  sockets           1000 (connected 100.0%)
  duration          30.0 s
  quote frames      19866 (662.0 frames/s)
  quotes            198660 (6619.8 quotes/s)
  delivery latency  p95 170.0 ms, p99 188.0 ms (tick to client)
  server errors     0
  thresholds        all passed
```

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `JWT_SECRET` | (required) | The key apps/api and apps/realtime run with, 32+ characters. |
| `K6_WS_URL` | `ws://127.0.0.1:8081/ws` | apps/realtime's WebSocket endpoint. |
| `K6_SOCKETS` | `1000` | Concurrent sockets (one k6 VU each). |
| `K6_RAMP_S` | `20` | Seconds over which the sockets connect. |
| `K6_HOLD_S` | `60` | Seconds each socket stays subscribed. |
| `K6_SYMBOLS_PER_SOCKET` | `10` | Symbols per socket (at most 20). |

Each socket is a different synthetic user (`usr_k6_<n>`); no real account or real data is used.
If every socket closes at once with 4401, the `JWT_SECRET` differs from the one apps/realtime has.
Above about 1,000 sockets, raise the open-files limit first (`ulimit -n 65536`).
