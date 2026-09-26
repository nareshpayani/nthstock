import type { BackendRequest, BackendResponse, ScenarioBackend } from './harness.js';

/** The slice of `fetch` the backend needs, so this package stays free of DOM types. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * A backend that sends real `fetch` requests to `origin`. Point it at the MSW node server's origin
 * (MSW intercepts `fetch`) or at a listening server.
 */
export function fetchBackend(
  origin: string,
  fetchImpl: FetchLike,
  onClose?: () => void | Promise<void>,
): ScenarioBackend {
  return {
    async send({ method, url, body }: BackendRequest): Promise<BackendResponse> {
      const init =
        body === undefined
          ? { method, headers: { accept: 'application/json' } }
          : {
              method,
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify(body),
            };
      const response = await fetchImpl(`${origin}${url}`, init);
      const text = await response.text();
      return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
    },
    ...(onClose ? { close: onClose } : {}),
  };
}
