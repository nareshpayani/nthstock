// @vitest-environment node
import { AUTH_CSRF_HEADER, AUTH_COOKIES, DEV_OTP, routes } from '@nthstock/contracts';
import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { setMockLatency } from '../handlerKit';
import { AUTH_MOCK_STORAGE_KEY, createAuthMock, MSW_SESSION_COOKIE } from './auth';

setMockLatency(0);
const ORIGIN = 'http://persist.test';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

/** One browser against one page load of the mock: a cookie map and a CSRF token. */
function browser(handlers: ReturnType<ReturnType<typeof createAuthMock>['handlers']>) {
  const cookies = new Map<string, string>();
  let csrf = 'pre-session';
  async function call(path: string, body?: unknown) {
    const headers = new Headers({ 'content-type': 'application/json', [AUTH_CSRF_HEADER]: csrf });
    headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await getResponse(
      handlers,
      new Request(`${ORIGIN}${path}`, {
        method: 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (!response) throw new Error(`no handler for ${path}`);
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const [name = '', value = ''] = pair.split('=');
      cookies.set(name, value);
    }
    const json = (await response.json()) as Record<string, unknown>;
    if (typeof json.csrfToken === 'string') csrf = json.csrfToken;
    return { status: response.status, json };
  }
  return { cookies, call };
}

describe('auth mock persistence (msw mode reloads)', () => {
  it('keeps the user, PIN and trusted device across page loads', async () => {
    const storage = memoryStorage();
    const first = browser(createAuthMock({ storage }).handlers());
    const mobile = '9876543210';
    const sent = await first.call(routes.otpRequest.path, { mobile });
    const requestId = sent.json.requestId as string;
    expect(
      (await first.call(routes.otpVerify.path, { mobile, requestId, otp: DEV_OTP })).status,
    ).toBe(200);
    expect((await first.call(routes.pinSet.path, { pin: '4821', confirmPin: '4821' })).status).toBe(
      200,
    );
    expect(storage.data.has(AUTH_MOCK_STORAGE_KEY)).toBe(true);

    // A reload: a new mock over the same storage, the same cookies.
    const second = browser(createAuthMock({ storage }).handlers());
    second.cookies.set(AUTH_COOKIES.device, first.cookies.get(AUTH_COOKIES.device) ?? '');
    const login = await second.call(routes.pinVerify.path, { pin: '4821' });
    expect(login.status).toBe(200);
    expect(second.cookies.get(MSW_SESSION_COOKIE)).toBeTruthy();
  });

  it('starts fresh when the stored state is unreadable or storage throws', async () => {
    const broken = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    };
    const client = browser(createAuthMock({ storage: broken }).handlers());
    const sent = await client.call(routes.otpRequest.path, { mobile: '9876543210' });
    expect(sent.status).toBe(200);
  });
});
