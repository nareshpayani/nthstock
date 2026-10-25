// T-241 (NSTOCK-0241): apps/api for the api-mode E2E run, under a small supervisor so a spec can
// restart it mid-test. Playwright's webServer starts this script instead of apps/api itself (a
// webServer cannot be restarted), and this script runs `apps/api/dist/server.js` as a child with
// its own env: the same PORT, JWT_SECRET, DATABASE_URL and REDIS_URL each time, so a session,
// and everything stored in Postgres, outlives the restart.
//
// `POST /restart` on API_SUPERVISOR_PORT (127.0.0.1 only) stops apps/api with SIGTERM (SIGKILL
// after 10 s), starts it again on the same port and answers 200 once /v1/health/ready does.
// Usage (playwright.config.ts): PORT=4100 API_SUPERVISOR_PORT=4101 node e2e/support/apiSupervisor.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../../api/dist/server.js', import.meta.url));
const API_PORT = process.env.PORT ?? '';
const CONTROL_PORT = Number(process.env.API_SUPERVISOR_PORT ?? '');
const READY_URL = `http://127.0.0.1:${API_PORT}/v1/health/ready`;
const READY_TIMEOUT_MS = 60_000;
const KILL_AFTER_MS = 10_000;

if (API_PORT === '' || !Number.isInteger(CONTROL_PORT) || CONTROL_PORT <= 0) {
  console.error('apiSupervisor: set PORT and API_SUPERVISOR_PORT');
  process.exit(1);
}

/** The running apps/api, or null while it is stopped. */
let child = null;
/** True while a restart or shutdown is stopping apps/api on purpose. */
let stopping = false;

function start() {
  const started = spawn(process.execPath, [SERVER], { env: process.env, stdio: 'inherit' });
  started.on('exit', (code, signal) => {
    if (child === started) child = null;
    if (stopping) return;
    // apps/api died on its own: end the run's backend loudly rather than serve nothing.
    console.error(`apiSupervisor: apps/api exited (${String(signal ?? code)})`);
    process.exit(code ?? 1);
  });
  child = started;
}

function stop() {
  const running = child;
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => running.kill('SIGKILL'), KILL_AFTER_MS);
    running.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    running.kill('SIGTERM');
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(READY_URL);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`apps/api was not ready within ${String(READY_TIMEOUT_MS)} ms`);
}

/** One restart at a time; a second request waits for the first. */
let restarting = Promise.resolve();

async function restart() {
  stopping = true;
  try {
    await stop();
  } finally {
    stopping = false;
  }
  start();
  await waitUntilReady();
}

const control = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/restart') {
    response.writeHead(404).end();
    return;
  }
  const at = Date.now();
  restarting = restarting.then(restart).then(
    () => {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ restartedInMs: Date.now() - at }));
    },
    (error) => {
      console.error(`apiSupervisor: restart failed: ${String(error)}`);
      response
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: String(error) }));
    },
  );
});

function shutDown() {
  stopping = true;
  control.close();
  void stop().then(() => process.exit(0));
}
process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

control.listen(CONTROL_PORT, '127.0.0.1', () => start());
