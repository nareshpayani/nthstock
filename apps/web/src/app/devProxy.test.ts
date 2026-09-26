import { describe, expect, it } from 'vitest';
import { DEFAULT_API_PROXY_TARGET, DEFAULT_REALTIME_PROXY_TARGET, devProxy } from './devProxy';

describe('devProxy', () => {
  it('has no proxy in msw mode', () => {
    expect(devProxy('msw')).toBeUndefined();
  });

  it('proxies REST to apps/api and the WebSocket to apps/realtime on the same origin', () => {
    expect(devProxy('api')).toEqual({
      '/v1': {
        target: DEFAULT_API_PROXY_TARGET,
        changeOrigin: false,
        cookieDomainRewrite: { '*': '' },
      },
      '/ws': { target: DEFAULT_REALTIME_PROXY_TARGET, changeOrigin: false, ws: true },
    });
  });

  it('takes other targets from the environment', () => {
    const proxy = devProxy('api', {
      API_PROXY_TARGET: 'http://api.local:9000',
      REALTIME_PROXY_TARGET: 'ws://rt.local:9001',
    });
    expect(proxy?.['/v1']?.target).toBe('http://api.local:9000');
    expect(proxy?.['/ws']?.target).toBe('ws://rt.local:9001');
  });
});
