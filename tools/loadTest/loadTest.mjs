#!/usr/bin/env node
// Load test for apps/api and apps/realtime (NSTOCK-0341). Development only: it logs users in with
// the development OTP, which production never accepts. Method and results:
// docs/runbooks/load-test.md.
//
//   node tools/loadTest/loadTest.mjs --users 1000 --duration 60
//
// Every virtual user is a real account: it logs in through POST /v1/auth/otp/request and
// /v1/auth/otp/verify, holds a WebSocket on apps/realtime with its access cookie, and calls the
// API with a page-load mix every few seconds (one in ten calls places a paper order). Each user
// sends from its own loopback address (127.x.y.z), so the per-IP rate limits apply to each user
// as they would behind a load balancer, instead of throttling the whole test as one client.
import { fork } from 'node:child_process';
import { request as httpRequest, Agent } from 'node:http';
import { cpus, totalmem } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const SYMBOLS = [
  'RELIANCE',
  'HDFCBANK',
  'BHARTIARTL',
  'TCS',
  'ICICIBANK',
  'SBIN',
  'INFY',
  'HINDUNILVR',
  'ITC',
  'LT',
  'BAJFINANCE',
  'KOTAKBANK',
  'AXISBANK',
  'MARUTI',
  'SUNPHARMA',
  'HCLTECH',
  'TITAN',
  'ULTRACEMCO',
  'NTPC',
  'ASIANPAINT',
];

function parseArgs(argv) {
  const args = {
    users: 1000,
    duration: 60,
    think: 5000,
    loginConcurrency: 200,
    workers: Math.max(1, Math.min(4, cpus().length)),
    api: 'http://127.0.0.1:4000',
    ws: 'ws://127.0.0.1:8081/ws',
    out: '',
    orderShare: 0.1,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    args[key] = typeof args[key] === 'number' ? Number(value) : value;
  }
  return args;
}

/** 127.x.y.z for user n (0-based), skipping .0 and .255 in the last octet. */
function addressOf(n) {
  const host = 1 + (n % 254);
  const block = Math.floor(n / 254);
  return `127.${String(1 + Math.floor(block / 256))}.${String(block % 256)}.${String(host)}`;
}

const mobileOf = (n) => String(9_100_000_000 + n);

function call(agent, base, { method, path, body, token, cookie, localAddress }) {
  const url = new URL(path, base);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve) => {
    const started = performance.now();
    const req = httpRequest(
      {
        method,
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        agent,
        localAddress,
        headers: {
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'x-csrf-token': 'load-test' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const ms = performance.now() - started;
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // Not JSON: kept as null; the status code says what happened.
          }
          resolve({ status: res.statusCode ?? 0, ms, json, headers: res.headers });
        });
      },
    );
    req.on('error', (error) => resolve({ status: 0, ms: performance.now() - started, error }));
    req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One worker process: logs in its slice of users, then runs their sessions. */
async function runWorker(config) {
  const { first, count, api, ws: wsUrl, think, duration, loginConcurrency, orderShare } = config;
  const stats = {
    login: [],
    loginErrors: {},
    api: {},
    apiErrors: {},
    wsConnectMs: [],
    wsOpened: 0,
    wsFailed: 0,
    wsClosedEarly: 0,
    wsFrames: 0,
    wsTickAgeMs: [],
  };
  const countError = (bucket, key) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  const users = Array.from({ length: count }, (_, i) => {
    const n = first + i;
    const localAddress = addressOf(n);
    return {
      n,
      localAddress,
      agent: new Agent({ keepAlive: true, maxSockets: 1, localAddress }),
    };
  });

  // Phase 1: log in, loginConcurrency users at a time per worker.
  let next = 0;
  const loginOne = async (user) => {
    const started = performance.now();
    const otp = await call(user.agent, api, {
      method: 'POST',
      path: '/v1/auth/otp/request',
      body: { mobile: mobileOf(user.n) },
      localAddress: user.localAddress,
    });
    if (otp.status !== 200) {
      countError(stats.loginErrors, `otp ${String(otp.status)}`);
      return;
    }
    const verify = await call(user.agent, api, {
      method: 'POST',
      path: '/v1/auth/otp/verify',
      body: {
        mobile: mobileOf(user.n),
        requestId: otp.json.requestId,
        otp: '123456',
        // CONSENT_POLICY_VERSION in packages/contracts: a new mobile needs it (NSTOCK-0228).
        consentVersion: '2026-09-25',
      },
      localAddress: user.localAddress,
    });
    if (verify.status !== 200) {
      countError(stats.loginErrors, `verify ${String(verify.status)}`);
      return;
    }
    user.token = verify.json.accessToken;
    stats.login.push(performance.now() - started);
  };
  const loginStarted = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(loginConcurrency, users.length) }, async () => {
      while (next < users.length) await loginOne(users[next++]);
    }),
  );
  const loginWallMs = performance.now() - loginStarted;
  process.send?.({ type: 'loggedIn' });
  await new Promise((resolve) => process.once('message', resolve));

  // Phase 2: every logged-in user holds a WebSocket and loads pages until the clock runs out.
  const live = users.filter((user) => user.token);
  const endAt = Date.now() + duration * 1000;
  const openSocket = (user) =>
    new Promise((resolve) => {
      const started = performance.now();
      const socket = new WebSocket(wsUrl, {
        headers: { cookie: `nth_at=${user.token}` },
        localAddress: user.localAddress,
        perMessageDeflate: false,
      });
      let opened = false;
      socket.binaryType = 'arraybuffer';
      socket.on('open', () => {
        opened = true;
        stats.wsOpened += 1;
        stats.wsConnectMs.push(performance.now() - started);
        const symbols = [...SYMBOLS].sort(() => Math.random() - 0.5).slice(0, 10);
        socket.send(JSON.stringify({ v: 1, type: 'subscribe', symbols }));
        user.ping = setInterval(() => {
          socket.send(JSON.stringify({ v: 1, type: 'ping', id: Date.now() }));
        }, 20_000);
        resolve();
      });
      socket.on('message', (data, isBinary) => {
        stats.wsFrames += 1;
        if (isBinary && stats.wsFrames % 10 === 0) {
          const view = new DataView(data);
          if (view.getUint8(0) === 0x51)
            stats.wsTickAgeMs.push(Date.now() - view.getFloat64(4, true));
        }
      });
      socket.on('error', () => {
        if (!opened) {
          stats.wsFailed += 1;
          resolve();
        }
      });
      socket.on('close', () => {
        clearInterval(user.ping);
        if (opened && Date.now() < endAt - 1000) stats.wsClosedEarly += 1;
      });
      user.socket = socket;
    });
  // Connections open 50 at a time, like users arriving, not one SYN flood.
  for (let i = 0; i < live.length; i += 50) {
    await Promise.all(live.slice(i, i + 50).map(openSocket));
  }

  const MIX = [
    [
      'quotes',
      0.3,
      () => ({
        method: 'GET',
        path: `/v1/market/quotes?symbols=${SYMBOLS.slice(0, 10).join(',')}`,
      }),
    ],
    ['positions', 0.15, () => ({ method: 'GET', path: '/v1/positions' })],
    ['portfolio', 0.15, () => ({ method: 'GET', path: '/v1/portfolio/summary' })],
    ['orders', 0.15, () => ({ method: 'GET', path: '/v1/orders' })],
    [
      'depth',
      0.15 - orderShare / 2,
      () => ({
        method: 'GET',
        path: `/v1/market/instruments/${SYMBOLS[Math.floor(Math.random() * 10)]}/depth`,
      }),
    ],
    ['funds', 0.1 - orderShare / 2, () => ({ method: 'GET', path: '/v1/funds' })],
    [
      'placeOrder',
      orderShare,
      () => ({
        method: 'POST',
        path: '/v1/orders',
        body: {
          token: 1 + Math.floor(Math.random() * 10),
          side: 'BUY',
          type: 'MARKET',
          product: 'DELIVERY',
          qty: 1,
        },
      }),
    ],
  ];
  const pick = () => {
    let roll = Math.random();
    for (const entry of MIX) {
      roll -= entry[1];
      if (roll <= 0) return entry;
    }
    return MIX[0];
  };
  const session = async (user) => {
    // Spread the first page loads over one think time so the users do not fire in lockstep.
    await sleep(Math.random() * think);
    while (Date.now() < endAt) {
      const [name, , build] = pick();
      const result = await call(user.agent, api, {
        ...build(),
        token: user.token,
        localAddress: user.localAddress,
      });
      (stats.api[name] ??= []).push(result.ms);
      if (result.status < 200 || result.status >= 300)
        countError(stats.apiErrors, `${name} ${String(result.status)}`);
      await sleep(think * (0.5 + Math.random()));
    }
  };
  const sessionStarted = performance.now();
  await Promise.all(live.map(session));
  const sessionWallMs = performance.now() - sessionStarted;
  for (const user of live) {
    clearInterval(user.ping);
    user.socket?.close();
    user.agent.destroy();
  }
  return { ...stats, loginWallMs, sessionWallMs, liveUsers: live.length };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? null),
  };
}

const lastCpu = new Map();

/** CPU % (of one core, since the last sample) and RSS MB of the API and realtime processes. */
function sampleServers(pids) {
  const out = {};
  for (const [name, pid] of Object.entries(pids)) {
    if (!pid) continue;
    try {
      const fields = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
        .split(') ')[1]
        .split(' ');
      const ticks = Number(fields[11]) + Number(fields[12]);
      const rssMb = Math.round((Number(fields[21]) * 4096) / 2 ** 20);
      const now = Date.now();
      const last = lastCpu.get(pid);
      lastCpu.set(pid, { ticks, now });
      const cpu = last
        ? Math.round(((ticks - last.ticks) / 100 / ((now - last.now) / 1000)) * 100)
        : 0;
      out[name] = { cpu, rssMb };
    } catch {
      out[name] = null;
    }
  }
  return out;
}

async function healthOf(wsUrl) {
  const url = new URL(wsUrl);
  try {
    const res = await fetch(`http://${url.host}/health`);
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workers = Math.min(args.workers, args.users);
  const per = Math.ceil(args.users / workers);
  const pids = {
    api: args.apiPid ? Number(args.apiPid) : null,
    realtime: args.rtPid ? Number(args.rtPid) : null,
  };
  process.stdout.write(
    `Load test: ${String(args.users)} users, ${String(args.duration)} s, think ${String(args.think)} ms, ${String(workers)} workers\n`,
  );
  const children = [];
  const results = [];
  let loggedIn = 0;
  const allLoggedIn = new Promise((resolve) => {
    for (let w = 0; w < workers; w += 1) {
      const first = w * per;
      const count = Math.min(per, args.users - first);
      const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: 'inherit' });
      child.send({
        first,
        count,
        api: args.api,
        ws: args.ws,
        think: args.think,
        duration: args.duration,
        loginConcurrency: Math.ceil(args.loginConcurrency / workers),
        orderShare: args.orderShare,
      });
      child.on('message', (message) => {
        if (message.type === 'loggedIn' && ++loggedIn === workers) resolve();
        if (message.type === 'result') results.push(message.result);
      });
      children.push(child);
    }
  });
  const loginStarted = performance.now();
  await allLoggedIn;
  const loginWallMs = performance.now() - loginStarted;
  process.stdout.write(
    `Logged in after ${String(Math.round(loginWallMs))} ms; starting sessions\n`,
  );
  for (const child of children) child.send({ type: 'go' });

  const samples = [];
  const sampler = setInterval(async () => {
    samples.push({
      at: Date.now(),
      servers: sampleServers(pids),
      realtime: await healthOf(args.ws),
    });
  }, 5000);
  await Promise.all(children.map((child) => new Promise((resolve) => child.on('exit', resolve))));
  clearInterval(sampler);

  const merge = (key) => results.flatMap((r) => r[key]);
  const sum = (key) => results.reduce((total, r) => total + r[key], 0);
  const mergeCounts = (key) => {
    const out = {};
    for (const r of results)
      for (const [k, v] of Object.entries(r[key])) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const apiByRoute = {};
  for (const r of results)
    for (const [route, values] of Object.entries(r.api)) (apiByRoute[route] ??= []).push(...values);
  const allApi = Object.values(apiByRoute).flat();
  const sessionWallMs = Math.max(...results.map((r) => r.sessionWallMs));
  const peak = (name, field) => Math.max(0, ...samples.map((s) => s.servers[name]?.[field] ?? 0));
  const report = {
    at: new Date().toISOString(),
    machine: {
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model,
      memoryGb: Math.round(totalmem() / 2 ** 30),
    },
    settings: {
      users: args.users,
      durationSec: args.duration,
      thinkMs: args.think,
      orderShare: args.orderShare,
      workers,
    },
    login: {
      ...summarise(merge('login')),
      wallMs: Math.round(loginWallMs),
      perSecond: Math.round((merge('login').length / loginWallMs) * 1000),
      errors: mergeCounts('loginErrors'),
    },
    api: {
      ...summarise(allApi),
      perSecond: Math.round((allApi.length / sessionWallMs) * 1000),
      errors: mergeCounts('apiErrors'),
      byRoute: Object.fromEntries(Object.entries(apiByRoute).map(([k, v]) => [k, summarise(v)])),
    },
    ws: {
      opened: sum('wsOpened'),
      failed: sum('wsFailed'),
      closedEarly: sum('wsClosedEarly'),
      connectMs: summarise(merge('wsConnectMs')),
      framesPerSecond: Math.round((sum('wsFrames') / sessionWallMs) * 1000),
      tickAgeMs: summarise(merge('wsTickAgeMs')),
      peakConnections: Math.max(0, ...samples.map((s) => s.realtime?.connections ?? 0)),
      droppedFrames: samples.at(-1)?.realtime?.droppedFrames ?? null,
    },
    servers: {
      apiPeakCpu: peak('api', 'cpu'),
      apiPeakRssMb: peak('api', 'rssMb'),
      realtimePeakCpu: peak('realtime', 'cpu'),
      realtimePeakRssMb: peak('realtime', 'rssMb'),
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.out) writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv.includes('--worker')) {
  process.once('message', async (config) => {
    const result = await runWorker(config);
    // Disconnect only once the result is flushed: a large result is cut off otherwise.
    process.send({ type: 'result', result }, () => process.disconnect());
  });
} else {
  await main();
}
