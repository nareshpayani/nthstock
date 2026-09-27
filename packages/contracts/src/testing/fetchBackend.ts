import type { BackendRequest, BackendResponse, ScenarioBackend } from './harness.js';

/** The slice of `fetch` the backend needs, so this package stays free of DOM types. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  text(): Promise<string>;
  headers?: { getSetCookie?(): string[] };
}>;

export type FetchBackendOptions = {
  onClose?: () => void | Promise<void>;
  /** The origin scenario `index` talks to, e.g. its own subdomain for its own cookie store. */
  scopeOrigin?: (index: number) => string;
  /** Moves the backend's auth clock forward. */
  advanceTime?: (ms: number) => void | Promise<void>;
  /** Sets the backend's clock (`ScenarioBackend.setTime`). */
  setTime?: (at: string) => void | Promise<void>;
  /** A scripted tick (`ScenarioBackend.setPrice`). */
  setPrice?: (token: number, ltp: number) => void | Promise<void>;
};

/**
 * A backend that sends real `fetch` requests to `origin`. Point it at the MSW node server's origin
 * (MSW intercepts `fetch`) or at a listening server.
 */
export function fetchBackend(
  origin: string,
  fetchImpl: FetchLike,
  onCloseOrOptions?: (() => void | Promise<void>) | FetchBackendOptions,
): ScenarioBackend {
  const options: FetchBackendOptions =
    typeof onCloseOrOptions === 'function'
      ? { onClose: onCloseOrOptions }
      : (onCloseOrOptions ?? {});

  const at = (base: string): ScenarioBackend => ({
    async send({ method, url, body, headers: extra }: BackendRequest): Promise<BackendResponse> {
      const headers: Record<string, string> = { accept: 'application/json', ...extra };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const init =
        body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
      const response = await fetchImpl(`${base}${url}`, init);
      const text = await response.text();
      const setCookies = response.headers?.getSetCookie?.() ?? [];
      return {
        status: response.status,
        body: text === '' ? null : (JSON.parse(text) as unknown),
        ...(setCookies.length > 0 ? { setCookies } : {}),
      };
    },
    ...(options.advanceTime ? { advanceTime: options.advanceTime } : {}),
    ...(options.setTime ? { setTime: options.setTime } : {}),
    ...(options.setPrice ? { setPrice: options.setPrice } : {}),
  });

  const root = at(origin);
  const { scopeOrigin, onClose } = options;
  return {
    ...root,
    ...(scopeOrigin ? { scope: (index: number) => at(scopeOrigin(index)) } : {}),
    ...(onClose ? { close: onClose } : {}),
  };
}
