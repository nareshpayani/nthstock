import {
  AUTH_COOKIES,
  AUTH_CSRF_HEADER,
  DEV_OTP,
  OtpRequestResponse,
  Session,
  routes,
} from '@nthstock/contracts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/** Name → value of every Set-Cookie on a response (an empty value means "deleted"). */
export function setCookies(response: LightMyRequestResponse): Record<string, string> {
  const header = response.headers['set-cookie'];
  const list = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return Object.fromEntries(
    list.map((cookie) => {
      const [pair = ''] = cookie.split(';');
      const eq = pair.indexOf('=');
      return [pair.slice(0, eq), pair.slice(eq + 1)];
    }),
  );
}

/** The raw Set-Cookie line for `name`. */
export function setCookieLine(response: LightMyRequestResponse, name: string): string | undefined {
  const header = response.headers['set-cookie'];
  const list = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return list.find((cookie) => cookie.startsWith(`${name}=`));
}

export const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

/** The CSRF header for requests before a session exists (any non-empty value). */
export const PRE_SESSION_CSRF = { [AUTH_CSRF_HEADER]: 'pre-session' } as const;

/** The CSRF header for a session. */
export const csrfHeader = (csrf: string) => ({ [AUTH_CSRF_HEADER]: csrf });

export type LoggedIn = {
  session: Session;
  /** The session's CSRF token. */
  csrf: string;
  access: string;
  refresh: string;
  response: LightMyRequestResponse;
};

/** Requests and verifies the dev OTP for `mobile`; returns the session and its cookies. */
export async function loginWithOtp(
  app: FastifyInstance,
  mobile: string,
  extraHeaders: Record<string, string> = {},
): Promise<LoggedIn> {
  const headers = { ...PRE_SESSION_CSRF, ...extraHeaders };
  const requested = await app.inject({
    method: 'POST',
    url: routes.otpRequest.path,
    headers,
    payload: { mobile },
  });
  const { requestId } = OtpRequestResponse.parse(requested.json());
  const response = await app.inject({
    method: 'POST',
    url: routes.otpVerify.path,
    headers,
    payload: { requestId, mobile, otp: DEV_OTP },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
  const cookies = setCookies(response);
  const session = Session.parse(response.json());
  return {
    session,
    csrf: session.csrfToken,
    access: cookies[AUTH_COOKIES.access] ?? '',
    refresh: cookies[AUTH_COOKIES.refresh] ?? '',
    response,
  };
}
