// Paytm Money equity research capture. Observe only: learning and design reference.
//
// Run on your own machine (the page needs your login):
//   npx -y -p playwright@1.58.0 node tools/research/paytmCapture.mjs
//
// A visible Chrome window opens. Log in yourself (credentials and OTP stay with you),
// then browse the stocks section. Every screen you visit is screenshotted, and API calls
// and WebSocket frames are recorded as redacted shapes. Press Enter in the terminal to finish.
//
// Guardrails built in:
// - Order placement, modification and cancellation requests are blocked before they leave the browser.
// - No cookies, headers or tokens are written. JSON values under sensitive keys, and anything that
//   looks like a token, email, phone number or long id, are replaced with "<redacted>".
// - The browser context is not persistent, so no session survives the run.
// - Output goes to research-output/ (git-ignored). Screenshots can show your name and holdings,
//   so review them before sharing.

import { chromium } from 'playwright';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

const START_URL = 'https://www.paytmmoney.com/stocks/dashboard';
const OUT = 'research-output';
const MAX_ARRAY_SAMPLES = 2;
const MAX_WS_FRAMES_PER_URL = 20;

const SENSITIVE_KEY =
  /token|auth|session|cookie|otp|pin|pass|secret|sign|phone|mobile|email|pan|aadhaar|account|acct|client|user_?id|uid|name|dob|birth|address|bank|ifsc|upi|vpa|device|imei|ip_?addr|nominee|demat|dp_?id|boid/i;
const ORDER_WRITE = /order|place|modify|cancel|basket|gtt|sip/i;

/** Redacts a single string value that looks like a secret or personal data. */
function redactString(value) {
  if (/^eyJ[\w-]+\.[\w-]+\./.test(value)) return '<redacted:jwt>';
  if (/@/.test(value) && /\.\w{2,}$/.test(value)) return '<redacted:email>';
  if (/^\+?\d[\d\s-]{9,}$/.test(value) && !/\./.test(value)) return '<redacted:number-like-id>';
  if (value.length > 40 && !/\s/.test(value)) return '<redacted:long-token>';
  return value;
}

/** Returns a redacted, size-limited copy of a JSON value that keeps its shape. */
function shape(value, key = '') {
  if (key && SENSITIVE_KEY.test(key)) return '<redacted>';
  if (Array.isArray(value)) {
    return {
      __array: true,
      length: value.length,
      samples: value.slice(0, MAX_ARRAY_SAMPLES).map((item) => shape(item)),
    };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, k)]));
  }
  if (typeof value === 'string') return redactString(value);
  return value;
}

/** Keeps the path and query keys of a URL; query values are dropped. */
function cleanUrl(raw) {
  try {
    const url = new URL(raw);
    const keys = [...url.searchParams.keys()];
    return `${url.origin}${url.pathname.replace(/\/\d{6,}(?=\/|$)/g, '/<id>')}${keys.length ? `?${keys.map((k) => `${k}=…`).join('&')}` : ''}`;
  } catch {
    return '<unparseable-url>';
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function main() {
  await mkdir(`${OUT}/screens`, { recursive: true });
  const network = `${OUT}/network.jsonl`;
  const sockets = `${OUT}/websocket.jsonl`;
  await writeFile(network, '');
  await writeFile(sockets, '');

  const browser = await chromium
    .launch({ headless: false, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: false }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Observe only: never let an order-changing request out.
  await context.route('**/*', (route) => {
    const request = route.request();
    if (request.method() !== 'GET' && ORDER_WRITE.test(new URL(request.url()).pathname)) {
      console.log(`Blocked ${request.method()} ${cleanUrl(request.url())} (observe only)`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  const page = await context.newPage();
  const seen = new Set();

  page.on('response', async (response) => {
    const request = response.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return;
    const url = cleanUrl(request.url());
    const body = parseJson(await response.text().catch(() => ''));
    const requestBody = parseJson(request.postData() ?? '');
    await appendFile(
      network,
      `${JSON.stringify({
        at: new Date().toISOString(),
        page: cleanUrl(page.url()),
        method: request.method(),
        url,
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        request: requestBody === undefined ? undefined : shape(requestBody),
        response: body === undefined ? '<non-json>' : shape(body),
      })}\n`,
    );
    if (!seen.has(`${request.method()} ${url}`)) {
      seen.add(`${request.method()} ${url}`);
      console.log(`API ${request.method()} ${url} → ${response.status()}`);
    }
  });

  page.on('websocket', (ws) => {
    const url = cleanUrl(ws.url());
    let count = 0;
    console.log(`WebSocket ${url}`);
    const record = (direction) => async (frame) => {
      if (count++ >= MAX_WS_FRAMES_PER_URL) return;
      const payload = frame.payload;
      const entry =
        typeof payload === 'string'
          ? { kind: 'text', data: shape(parseJson(payload) ?? redactString(payload)) }
          : {
              kind: 'binary',
              bytes: payload.length,
              firstBytesHex: payload.subarray(0, 32).toString('hex'),
            };
      await appendFile(
        sockets,
        `${JSON.stringify({ at: new Date().toISOString(), url, direction, ...entry })}\n`,
      );
    };
    ws.on('framesent', record('sent'));
    ws.on('framereceived', record('received'));
  });

  let shot = 0;
  page.on('framenavigated', async (frame) => {
    if (frame !== page.mainFrame()) return;
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const name = `${String(++shot).padStart(3, '0')}${new URL(page.url()).pathname.replace(/[^\w]+/g, '-')}.png`;
    await page
      .screenshot({ path: `${OUT}/screens/${name}`, fullPage: true })
      .catch(() => undefined);
    console.log(`Screen ${name}`);
  });

  await page.goto(START_URL);
  console.log('\nLog in yourself in the browser window, then browse the stocks section.');
  console.log('Blocked: any order placement, modification or cancellation.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Press Enter here when you are done…\n');
  rl.close();

  await context.close();
  await browser.close();
  console.log(`Done. ${seen.size} distinct API calls. Review ${OUT}/ before sharing it.`);
}

await main();
