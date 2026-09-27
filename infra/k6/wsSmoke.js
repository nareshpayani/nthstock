// k6 smoke test for apps/realtime (T-172): 1,000 concurrent WebSocket clients subscribe to live
// prices and hold for a while; the run reports quote frames per second and the p95 delivery
// latency (tick → client). Local only, never in CI. How to run: infra/k6/README.md.
//
// k6 is a standalone binary (or the grafana/k6 Docker image), not an npm package, so this file is
// plain k6 JavaScript and is not part of any workspace build.
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';

const env = (name, fallback) =>
  __ENV[name] === undefined || __ENV[name] === '' ? fallback : __ENV[name];

/** apps/realtime's WebSocket endpoint (npm run dev:api serves it on 8081). */
const WS_URL = env('K6_WS_URL', 'ws://127.0.0.1:8081/ws');
/** The same JWT_SECRET apps/api and apps/realtime run with. Never commit one. */
const JWT_SECRET = env('JWT_SECRET', '');
const SOCKETS = Number(env('K6_SOCKETS', '1000'));
/** Seconds over which the sockets connect, so the server is not hit by 1,000 upgrades at once. */
const RAMP_S = Number(env('K6_RAMP_S', '20'));
/** Seconds each socket stays subscribed. */
const HOLD_S = Number(env('K6_HOLD_S', '60'));
const SYMBOLS_PER_SOCKET = Number(env('K6_SYMBOLS_PER_SOCKET', '10'));

// Well-known symbols of the mock symbol master; each socket takes a rotating slice.
const SYMBOLS = [
  'RELIANCE',
  'HDFCBANK',
  'BHARTIARTL',
  'TCS',
  'ICICIBANK',
  'SBIN',
  'INFY',
  'BAJFINANCE',
  'HINDUNILVR',
  'ITC',
  'LT',
  'MARUTI',
  'HCLTECH',
  'SUNPHARMA',
  'KOTAKBANK',
  'AXISBANK',
  'ULTRACEMCO',
  'NTPC',
  'BAJAJFINSV',
  'M&M',
];

// Wire format (packages/contracts/src/quoteFrame.ts): a 12-byte header (magic 0x51, version,
// u16 count, f64 base time = newest quote's ts) then 24-byte records whose last u16 is the age of
// that quote relative to the base time. Control messages (JSON) are protocol version 1.
const WS_PROTOCOL_VERSION = 1;
const QUOTE_FRAME_MAGIC = 0x51;
const HEADER_BYTES = 12;
const RECORD_BYTES = 24;
const AGE_OFFSET = 22;

// Access tokens as apps/api signs them (HS256; iss nthstock-api, aud nthstock), cookie nth_at.
const ACCESS_COOKIE = 'nth_at';
const TOKEN_TTL_S = 15 * 60;

export const options = {
  scenarios: {
    sockets: {
      executor: 'per-vu-iterations',
      vus: SOCKETS,
      iterations: 1,
      maxDuration: `${RAMP_S + HOLD_S + 60}s`,
    },
  },
  thresholds: {
    // CLAUDE.md §3: tick → screen under 500 ms; the socket leg must leave room for the paint.
    ws_delivery_ms: ['p(95)<500'],
    ws_connect_ok: ['rate>0.99'],
    ws_quote_frames: ['count>0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const frames = new Counter('ws_quote_frames');
const quotes = new Counter('ws_quotes');
const delivery = new Trend('ws_delivery_ms', true);
const connected = new Rate('ws_connect_ok');
const serverErrors = new Counter('ws_server_errors');

const b64url = (text) => encoding.b64encode(text, 'rawurl');

function accessToken(subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: subject,
      sid: `ses_k6_${subject}`,
      iss: 'nthstock-api',
      aud: 'nthstock',
      iat: now,
      exp: now + TOKEN_TTL_S,
    }),
  );
  const signature = crypto.hmac('sha256', JWT_SECRET, `${header}.${payload}`, 'base64rawurl');
  return `${header}.${payload}.${signature}`;
}

export function setup() {
  if (JWT_SECRET.length < 32) {
    throw new Error(
      'Set JWT_SECRET (32+ characters) to the key apps/api and apps/realtime run with; see infra/k6/README.md.',
    );
  }
  return { startedAt: Date.now() };
}

/** Reads one binary quote frame: counts it and records each quote's tick-to-client latency. */
export function readFrame(buffer, receivedAt) {
  const view = new DataView(buffer);
  if (view.byteLength < HEADER_BYTES || view.getUint8(0) !== QUOTE_FRAME_MAGIC) return 0;
  const count = view.getUint16(2, true);
  const base = view.getFloat64(4, true);
  for (let i = 0; i < count; i += 1) {
    const at = HEADER_BYTES + i * RECORD_BYTES;
    if (at + RECORD_BYTES > view.byteLength) break;
    const age = view.getUint16(at + AGE_OFFSET, true);
    delivery.add(receivedAt - (base - age));
  }
  frames.add(1);
  quotes.add(count);
  return count;
}

export default function socket() {
  // Spread the upgrades over the ramp.
  sleep((RAMP_S * (__VU - 1)) / Math.max(1, SOCKETS));
  const first = ((__VU - 1) * 3) % SYMBOLS.length;
  const symbols = Array.from(
    { length: Math.min(SYMBOLS_PER_SOCKET, SYMBOLS.length) },
    (_, i) => SYMBOLS[(first + i) % SYMBOLS.length],
  );
  const params = { headers: { Cookie: `${ACCESS_COOKIE}=${accessToken(`usr_k6_${__VU}`)}` } };

  const response = ws.connect(WS_URL, params, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols }));
      socket.setTimeout(() => socket.close(), HOLD_S * 1000);
    });
    socket.on('binaryMessage', (buffer) => {
      readFrame(buffer, Date.now());
    });
    socket.on('message', (text) => {
      const message = JSON.parse(text);
      if (message.type === 'error') serverErrors.add(1);
    });
    socket.on('close', (code) => {
      // 4401: the token did not verify (wrong JWT_SECRET?).
      if (code === 4401) serverErrors.add(1);
    });
  });
  const ok = check(response, { 'upgraded (101)': (r) => r && r.status === 101 });
  connected.add(ok);
}

const metric = (data, name, stat) => data.metrics[name]?.values?.[stat];

export function handleSummary(data) {
  const seconds = Math.max(1, data.state.testRunDurationMs / 1000);
  const frameCount = metric(data, 'ws_quote_frames', 'count') ?? 0;
  const quoteCount = metric(data, 'ws_quotes', 'count') ?? 0;
  const p95 = metric(data, 'ws_delivery_ms', 'p(95)');
  const p99 = metric(data, 'ws_delivery_ms', 'p(99)');
  const okRate = metric(data, 'ws_connect_ok', 'rate') ?? 0;
  const failed = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok))
    .map(([name]) => name);
  const fmt = (value) => (value === undefined ? 'n/a' : value.toFixed(1));
  const lines = [
    '',
    'nthstock realtime smoke (infra/k6/wsSmoke.js)',
    `  sockets           ${String(SOCKETS)} (connected ${(okRate * 100).toFixed(1)}%)`,
    `  duration          ${seconds.toFixed(1)} s`,
    `  quote frames      ${String(frameCount)} (${(frameCount / seconds).toFixed(1)} frames/s)`,
    `  quotes            ${String(quoteCount)} (${(quoteCount / seconds).toFixed(1)} quotes/s)`,
    `  delivery latency  p95 ${fmt(p95)} ms, p99 ${fmt(p99)} ms (tick to client)`,
    `  server errors     ${String(metric(data, 'ws_server_errors', 'count') ?? 0)}`,
    `  thresholds        ${failed.length === 0 ? 'all passed' : `FAILED: ${failed.join(', ')}`}`,
    '',
  ];
  return { stdout: lines.join('\n') };
}
