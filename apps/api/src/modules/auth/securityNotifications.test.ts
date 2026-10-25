import { CONSENT_POLICY_VERSION, DEV_OTP, type Notification } from '@nthstock/contracts';
import { createScenarioClient, type ScenarioClient } from '@nthstock/contracts/testing';
import { base32Decode, deviceLabel, formatIstDate, formatIstTime, totpCode } from '@nthstock/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { injectBackend } from '../../test/injectBackend.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { raiseSecurityNotice, securityNotification } from '../notifications/index.js';

// Security notifications (NSTOCK-0382): a sign-in on a new device, two-factor on and off, and
// logging out the other devices each raise one SECURITY notification, with no mobile number,
// name or IP address in it.

const MOBILE = '9876543210';
const OTHER_MOBILE = '9876543211';
const PIN = '482105';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let clock: ManualClock;
let app: App;

beforeEach(() => {
  clock = manualClock('2026-11-02T04:00:00.000Z');
  app = buildApp({ deps: { clock } });
});

afterEach(async () => {
  await app.close();
});

const client = (scope: number) => {
  const backend = injectBackend(app, { advanceTime: (ms) => clock.advance(ms) });
  return createScenarioClient(backend.scope?.(scope) ?? backend);
};

async function login(c: ScenarioClient, mobile = MOBILE) {
  const { requestId } = await c.call('otpRequest', { body: { mobile } });
  return c.call('otpVerify', {
    body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
  });
}

const security = async (c: ScenarioClient): Promise<Notification[]> =>
  (await c.call('notificationsList')).items.filter((n) => n.kind === 'SECURITY');

/** Waits for the notifications raised in the background after the action answered. */
const settled = (c: ScenarioClient, count: number) =>
  vi.waitFor(async () => {
    expect(await security(c)).toHaveLength(count);
  });

const expectNoPersonalData = (items: Notification[]) => {
  for (const item of items) {
    const text = `${item.title} ${item.body}`;
    expect(text).not.toContain(MOBILE);
    expect(text).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  }
};

describe('security notifications (NSTOCK-0382)', () => {
  it('notifies a sign-in on a new device, naming the device type and IST time only', async () => {
    const c = client(1);
    await login(c);
    await settled(c, 1);

    const [note] = await security(c);
    expect(note).toMatchObject({
      kind: 'SECURITY',
      title: 'New sign-in to your account',
      symbol: null,
      exchange: null,
      read: false,
    });
    expect(note?.body).toContain('IST');
    expectNoPersonalData(await security(c));
  });

  it('names the browser and system for a known user agent', async () => {
    expect(
      securityNotification(
        'usr_a',
        { type: 'NEW_DEVICE', deviceLabel: deviceLabel(CHROME_MAC), sessionId: 'ses_1' },
        new Date('2026-11-02T04:00:00.000Z'),
      ),
    ).toEqual({
      userId: 'usr_a',
      kind: 'SECURITY',
      refId: 'ses_1',
      title: 'New sign-in to your account',
      body: `${deviceLabel(CHROME_MAC)} · ${formatIstDate(new Date('2026-11-02T04:00:00.000Z'))}, ${formatIstTime(new Date('2026-11-02T04:00:00.000Z'))} IST · Not you? Change your PIN.`,
      symbol: null,
      exchange: null,
    });
  });

  it('notifies two-factor turned on and off, and the other devices logged out', async () => {
    const c = client(2);
    await login(c);
    await c.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
    await c.call('stepUp', { body: { pin: PIN } });

    const { setupKey } = await c.call('totpEnrol');
    const secret = base32Decode(setupKey);
    await c.call('totpEnrolConfirm', {
      body: { code: await totpCode(secret, clock.now().getTime()) },
    });
    await settled(c, 2);
    expect((await security(c))[0]?.title).toBe('Two-factor authentication turned on');

    clock.advance(31_000); // a new TOTP step, so the code is not a replay
    await c.call('totpDisable', { body: { code: await totpCode(secret, clock.now().getTime()) } });
    await settled(c, 3);
    expect((await security(c))[0]?.title).toBe('Two-factor authentication turned off');

    // A second device signs in, then the first logs it out.
    clock.advance(31_000);
    const other = client(3);
    await login(other);
    await settled(c, 4);
    await c.call('stepUp', { body: { pin: PIN } });
    expect(await c.call('sessionsRevokeOthers')).toMatchObject({ revoked: 1 });
    await settled(c, 5);
    const [ended] = await security(c);
    expect(ended).toMatchObject({ title: 'Other devices logged out' });
    expect(ended?.body).toContain('1 session ended');
    expectNoPersonalData(await security(c));
  });

  it('raises nothing for logging out the others when there are none', async () => {
    const c = client(4);
    await login(c);
    await c.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
    await c.call('stepUp', { body: { pin: PIN } });
    await settled(c, 1);
    const raise = vi.spyOn(app.deps.notifier, 'raise');
    expect(await c.call('sessionsRevokeOthers')).toMatchObject({ revoked: 0 });
    expect(raise).not.toHaveBeenCalled();
  });

  it('raises nothing for a sign-in from a device the user already trusts', async () => {
    const c = client(5);
    await login(c);
    // Setting a PIN trusts this browser for this user.
    await c.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
    await settled(c, 1);
    const raise = vi.spyOn(app.deps.notifier, 'raise');
    clock.advance(60_000);
    await login(c);
    expect(raise).not.toHaveBeenCalled();
    expect(await security(c)).toHaveLength(1);
  });

  it('notifies a sign-in on a device another user trusts, as new for this user', async () => {
    const c = client(6);
    await login(c);
    await c.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
    await settled(c, 1);
    clock.advance(60_000);
    // The same browser, so the same device cookie, now signing in as someone else.
    await login(c, OTHER_MOBILE);
    await settled(c, 1);
    expect((await security(c))[0]?.title).toBe('New sign-in to your account');
  });

  it('still signs in, turns on two-factor and logs out the others when notices fail', async () => {
    const raise = vi
      .spyOn(app.deps.notifier, 'raise')
      .mockRejectedValue(new Error('notifications store down'));
    const c = client(7);
    await expect(login(c)).resolves.toMatchObject({ user: expect.anything() as unknown });
    await c.call('pinSet', { body: { pin: PIN, confirmPin: PIN } });
    clock.advance(31_000); // past the OTP resend wait
    await login(client(8));
    await c.call('stepUp', { body: { pin: PIN } });
    const { setupKey } = await c.call('totpEnrol');
    const secret = base32Decode(setupKey);
    await c.call('totpEnrolConfirm', {
      body: { code: await totpCode(secret, clock.now().getTime()) },
    });
    expect(await c.call('sessionsRevokeOthers')).toMatchObject({ revoked: 1 });
    // New device (twice), two-factor on, others logged out: each attempted, none stored.
    expect(raise.mock.calls.map(([entries]) => entries[0]?.title)).toEqual([
      'New sign-in to your account',
      'New sign-in to your account',
      'Two-factor authentication turned on',
      'Other devices logged out',
    ]);
  });
});

describe('raiseSecurityNotice (NSTOCK-0382)', () => {
  const at = new Date('2026-11-02T04:00:00.000Z');
  const event = { type: 'TOTP_ENABLED' } as const;

  it('reports a rejected store with the user and event, and never throws', async () => {
    const onError = vi.fn();
    const failure = new Error('down');
    expect(() => {
      raiseSecurityNotice(
        { notifier: { raise: () => Promise.reject(failure) }, onError },
        'usr_a',
        event,
        at,
      );
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure, { userId: 'usr_a', event: 'TOTP_ENABLED' });
    });
  });

  it('keeps a synchronous throw and a throwing reporter away from the caller', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const onError = vi.fn(() => {
        throw new Error('logger down');
      });
      expect(() => {
        raiseSecurityNotice(
          {
            notifier: {
              raise: () => {
                throw new Error('sync');
              },
            },
            onError,
          },
          'usr_a',
          event,
          at,
        );
      }).not.toThrow();
      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does nothing without notices', () => {
    expect(() => {
      raiseSecurityNotice(undefined, 'usr_a', event, at);
    }).not.toThrow();
  });
});
