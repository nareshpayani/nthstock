import { describe, expect, it, vi } from 'vitest';
import { raiseSecurityNotice } from './security.js';

const AT = new Date('2026-11-02T04:00:00.000Z');
const EVENT = { type: 'TOTP_DISABLED' } as const;

// A failed notification never fails the sign-in or the change that raised it (NSTOCK-0382).
describe('raiseSecurityNotice', () => {
  it('reports a rejected raise to onError and does not throw', async () => {
    const failure = new Error('outbox down');
    const onError = vi.fn();
    const notifier = { raise: vi.fn(() => Promise.reject(failure)) };

    expect(() => raiseSecurityNotice({ notifier, onError }, 'usr_a', EVENT, AT)).not.toThrow();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure, { event: 'TOTP_DISABLED', userId: 'usr_a' });
    });
  });

  it('reports a synchronous throw from the notifier too', async () => {
    const failure = new Error('boom');
    const onError = vi.fn();
    const notifier = {
      raise: vi.fn((): Promise<never[]> => {
        throw failure;
      }),
    };

    expect(() => raiseSecurityNotice({ notifier, onError }, 'usr_a', EVENT, AT)).not.toThrow();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure, expect.anything());
    });
  });

  it('swallows an onError that throws', async () => {
    const onError = vi.fn(() => {
      throw new Error('logger down');
    });
    const notifier = { raise: vi.fn(() => Promise.reject(new Error('x'))) };

    raiseSecurityNotice({ notifier, onError }, 'usr_a', EVENT, AT);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });

  it('does nothing without notices', () => {
    expect(() => raiseSecurityNotice(undefined, 'usr_a', EVENT, AT)).not.toThrow();
  });
});
